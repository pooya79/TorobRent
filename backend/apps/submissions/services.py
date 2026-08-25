import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import partial
from io import BytesIO
from typing import Any
from uuid import UUID

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile, File
from django.core.files.storage import Storage
from django.core.files.uploadedfile import UploadedFile
from django.core.mail import EmailMessage
from django.db import models, transaction
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User
from apps.catalog.models import Listing, ListingImage, Source
from apps.catalog.services import (
    DirectListingSpec,
    ListingImageSpec,
    ListingImageVariantSpec,
    materialize_direct_listing,
    replace_listing_images,
)

from .audit_serializers import validate_decision_correction
from .models import (
    MediaAsset,
    ReviewClaim,
    Submission,
    SubmissionDecisionNotification,
    SubmissionDecisionNotificationFailure,
    SubmissionDecisionNotificationStatus,
    SubmissionEvent,
    SubmissionEventType,
    SubmissionImage,
    SubmissionImageStatus,
    SubmissionImageVariant,
    SubmissionImageVariantKind,
    SubmissionState,
    SubmissionStep,
)

ALLOWED_IMAGE_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})
VARIANT_WIDTHS = {
    SubmissionImageVariantKind.SMALL: 480,
    SubmissionImageVariantKind.MEDIUM: 960,
    SubmissionImageVariantKind.LARGE: 1440,
}
MAX_SUBMISSION_IMAGES = 12
PROCESSING_FAILURE_REASON = "پردازش تصویر ناموفق بود. فایل را جایگزین و دوباره تلاش کنید."
REVIEW_CLAIM_DURATION = timedelta(minutes=15)

logger = logging.getLogger(__name__)

PROPERTY_FIELDS = (
    "city",
    "district",
    "neighborhood",
    "property_type",
    "area_sqm",
    "room_count",
    "construction_year",
    "floor",
    "total_floors",
    "units_per_floor",
    "parking",
    "elevator",
    "storage",
    "balcony",
    "furnished",
)
OPERATOR_PROPERTY_FIELDS = frozenset({*PROPERTY_FIELDS, "operator_location_notes"})


@dataclass(frozen=True)
class StepDefinition:
    section: str
    successor: SubmissionStep
    fields: tuple[str, ...] = ()


STEP_DEFINITIONS = {
    SubmissionStep.LOCATION: StepDefinition(
        "location",
        SubmissionStep.PROPERTY_FACTS,
        ("city", "district", "neighborhood", "address"),
    ),
    SubmissionStep.PROPERTY_FACTS: StepDefinition(
        "property_facts",
        SubmissionStep.RENTAL_TERMS,
        (
            "property_type",
            "area_sqm",
            "room_count",
            "construction_year",
            "floor",
            "total_floors",
            "units_per_floor",
        ),
    ),
    SubmissionStep.RENTAL_TERMS: StepDefinition(
        "rental_terms",
        SubmissionStep.FEATURES_DESCRIPTION,
        ("deposit_rial", "monthly_rent_rial", "is_negotiable", "is_convertible"),
    ),
    SubmissionStep.FEATURES_DESCRIPTION: StepDefinition(
        "features",
        SubmissionStep.IMAGES,
        ("parking", "elevator", "storage", "balcony", "furnished"),
    ),
    SubmissionStep.IMAGES: StepDefinition("images", SubmissionStep.CONTACT),
    SubmissionStep.CONTACT: StepDefinition("contact", SubmissionStep.REVIEW),
    SubmissionStep.REVIEW: StepDefinition("review", SubmissionStep.REVIEW),
}
STEP_ORDER = tuple(SubmissionStep.values)


def _record_transition(
    *,
    submission: Submission,
    actor: User,
    new_state: SubmissionState,
    reason: str = "",
    review_claim: ReviewClaim | None = None,
    normalized_corrections: dict[str, object] | None = None,
    publication_result: dict[str, object] | None = None,
) -> SubmissionEvent:
    prior_state = submission.state
    submission.state = new_state
    submission.save(update_fields=("state", "updated_at"))
    return SubmissionEvent.objects.create(
        submission=submission,
        actor=actor,
        review_claim=review_claim,
        revision=submission.revision,
        prior_state=prior_state,
        new_state=new_state,
        reason=reason,
        normalized_corrections=normalized_corrections or {},
        publication_result=publication_result or {},
    )


def _dispatch_decision_notification(notification_id: UUID) -> None:
    from .tasks import deliver_submission_decision_notification

    try:
        deliver_submission_decision_notification.delay(str(notification_id))
    except Exception as exc:
        with transaction.atomic():
            notification = SubmissionDecisionNotification.objects.select_for_update().get(
                id=notification_id
            )
            if notification.status != SubmissionDecisionNotificationStatus.DELIVERED:
                notification.status = SubmissionDecisionNotificationStatus.FAILED
                notification.failure_kind = SubmissionDecisionNotificationFailure.DISPATCH_FAILED
                notification.last_error = str(exc)[:500]
                notification.save(
                    update_fields=(
                        "status",
                        "failure_kind",
                        "last_error",
                        "updated_at",
                    )
                )
        logger.exception("Could not dispatch Submission decision notification")


def _schedule_decision_notification(decision: SubmissionEvent) -> None:
    notification = SubmissionDecisionNotification.objects.create(decision=decision)
    transaction.on_commit(partial(_dispatch_decision_notification, notification.id))


def dispatch_pending_decision_notifications() -> int:
    notification_ids = list(
        SubmissionDecisionNotification.objects.filter(
            models.Q(status=SubmissionDecisionNotificationStatus.PENDING)
            | models.Q(failure_kind=SubmissionDecisionNotificationFailure.DISPATCH_FAILED)
        ).values_list("id", flat=True)
    )
    for notification_id in notification_ids:
        _dispatch_decision_notification(notification_id)
    return len(notification_ids)


def deliver_decision_notification(notification_id: str) -> bool:
    failure: Exception | None = None
    with transaction.atomic():
        notification = (
            SubmissionDecisionNotification.objects
            .select_for_update()
            .select_related("decision__submission__submitter")
            .get(id=notification_id)
        )
        if notification.status == SubmissionDecisionNotificationStatus.DELIVERED:
            return False
        notification.attempt_count += 1
        submission = notification.decision.submission
        dashboard_url = f"{settings.FRONTEND_ORIGIN}/dashboard#submission-{submission.id}"
        try:
            sent_count = EmailMessage(
                subject="به‌روزرسانی وضعیت پیشنهاد در ترب‌رنت",
                body=(
                    "وضعیت پیشنهاد شما به‌روزرسانی شد. برای مشاهده جزئیات، "
                    f"وارد داشبورد امن خود شوید:\n{dashboard_url}"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[submission.submitter.email],
                headers={
                    "Message-ID": (f"<submission-decision-{notification.id}@torobrent.local>")
                },
            ).send()
            if sent_count != 1:
                raise OSError("The email backend did not accept the notification.")
        except Exception as exc:
            notification.status = SubmissionDecisionNotificationStatus.FAILED
            notification.failure_kind = SubmissionDecisionNotificationFailure.DELIVERY_FAILED
            notification.last_error = str(exc)[:500]
            notification.delivered_at = None
            failure = exc
        else:
            notification.status = SubmissionDecisionNotificationStatus.DELIVERED
            notification.failure_kind = ""
            notification.last_error = ""
            notification.delivered_at = timezone.now()
        notification.save(
            update_fields=(
                "status",
                "attempt_count",
                "failure_kind",
                "last_error",
                "delivered_at",
                "updated_at",
            )
        )
    if failure is not None:
        raise failure
    return True


@transaction.atomic
def retry_submission_decision_notification(
    *, submission: Submission, notification_id: UUID, actor: User
) -> None:
    ensure_operator_is_not_submitter(submission=submission, actor=actor)
    if not has_capability(actor, OperatorCapability.REVIEW_SUBMISSIONS):
        raise ValidationError("Only a Submission Reviewer may retry notification delivery.")
    notification = (
        SubmissionDecisionNotification.objects
        .select_for_update()
        .filter(id=notification_id, decision__submission=submission)
        .first()
    )
    if notification is None or notification.status != SubmissionDecisionNotificationStatus.FAILED:
        raise ValidationError("Only a failed Submission decision notification can be retried.")
    notification.status = SubmissionDecisionNotificationStatus.PENDING
    notification.failure_kind = ""
    notification.last_error = ""
    notification.save(update_fields=("status", "failure_kind", "last_error", "updated_at"))
    transaction.on_commit(partial(_dispatch_decision_notification, notification.id))


class ReviewWorkflowConflict(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _release_claim(
    claim: ReviewClaim,
    *,
    actor: User | None,
    reason: str,
    released_at: datetime | None = None,
) -> None:
    claim.released_at = released_at or timezone.now()
    claim.released_by = actor
    claim.release_reason = reason
    claim.save(update_fields=("released_at", "released_by", "release_reason"))


def _open_claim(submission: Submission) -> ReviewClaim | None:
    return (
        submission.review_claims.select_related("operator").filter(released_at__isnull=True).first()
    )


def _claim_is_available(claim: ReviewClaim, *, now: datetime) -> bool:
    return claim.expires_at > now and has_capability(
        claim.operator, OperatorCapability.REVIEW_SUBMISSIONS
    )


def _release_if_unavailable(claim: ReviewClaim | None, *, now: datetime) -> ReviewClaim | None:
    if claim is None or _claim_is_available(claim, now=now):
        return claim
    reason = (
        "Review Claim expired."
        if claim.expires_at <= now
        else "Operator capability or account access is no longer active."
    )
    _release_claim(claim, actor=None, reason=reason, released_at=now)
    return None


@transaction.atomic
def claim_submission_review(*, submission: Submission, actor: User) -> ReviewClaim:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    ensure_operator_is_not_submitter(submission=submission, actor=actor)
    if submission.state != SubmissionState.PENDING:
        raise ValidationError("Only a pending Submission can be claimed.")
    now = timezone.now()
    claim = _release_if_unavailable(_open_claim(submission), now=now)
    if claim is not None and claim.revision != submission.revision:
        _release_claim(
            claim, actor=None, reason="The Submission revision changed.", released_at=now
        )
        claim = None
    if claim is not None:
        if claim.operator_id == actor.id:
            return claim
        raise ReviewWorkflowConflict(
            "review_claim_conflict",
            "This Submission revision is already claimed by another Operator.",
        )
    return ReviewClaim.objects.create(
        submission=submission,
        operator=actor,
        revision=submission.revision,
        renewed_at=now,
        expires_at=now + REVIEW_CLAIM_DURATION,
    )


@transaction.atomic
def renew_submission_review_claim(*, submission: Submission, actor: User) -> ReviewClaim:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    now = timezone.now()
    claim = _release_if_unavailable(_open_claim(submission), now=now)
    if claim is not None and claim.revision != submission.revision:
        raise ReviewWorkflowConflict(
            "review_revision_conflict",
            "The Submission revision changed. Refresh and claim the current revision.",
        )
    if claim is None or claim.operator_id != actor.id:
        raise ReviewWorkflowConflict(
            "review_claim_required",
            "A current Review Claim owned by this Operator is required.",
        )
    claim.renewed_at = now
    claim.expires_at = now + REVIEW_CLAIM_DURATION
    claim.save(update_fields=("renewed_at", "expires_at"))
    return claim


@transaction.atomic
def release_submission_review_claim(*, submission: Submission, actor: User) -> None:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    claim = _release_if_unavailable(_open_claim(submission), now=timezone.now())
    if claim is None or claim.operator_id != actor.id:
        raise ReviewWorkflowConflict(
            "review_claim_required",
            "A current Review Claim owned by this Operator is required.",
        )
    _release_claim(claim, actor=actor, reason="Released by the reviewing Operator.")


@transaction.atomic
def force_release_submission_review_claim(
    *, submission: Submission, actor: User, reason: str
) -> None:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    claim = _release_if_unavailable(_open_claim(submission), now=timezone.now())
    if claim is None:
        raise ReviewWorkflowConflict("review_claim_required", "There is no active Review Claim.")
    _release_claim(claim, actor=actor, reason=reason)


def ensure_current_review_claim(
    *, submission: Submission, actor: User, reviewed_revision: int
) -> ReviewClaim:
    if submission.revision != reviewed_revision:
        raise ReviewWorkflowConflict(
            "review_revision_conflict",
            "The Submission revision changed. Refresh and claim the current revision.",
        )
    if submission.state != SubmissionState.PENDING:
        raise ReviewWorkflowConflict(
            "review_decision_conflict",
            "Another decision already changed this Submission. Refresh before continuing.",
        )
    now = timezone.now()
    claim = _open_claim(submission)
    if claim is not None and claim.revision != reviewed_revision:
        raise ReviewWorkflowConflict(
            "review_revision_conflict",
            "The Submission revision changed. Refresh and claim the current revision.",
        )
    if claim is not None and claim.operator_id != actor.id:
        raise ReviewWorkflowConflict(
            "review_claim_replaced",
            "Another Operator now owns the current Review Claim. Refresh before continuing.",
        )
    if claim is not None and claim.expires_at <= now:
        _release_claim(claim, actor=None, reason="Review Claim expired.", released_at=now)
        raise ReviewWorkflowConflict(
            "review_claim_expired",
            "The Review Claim expired. Refresh and claim the Submission again.",
        )
    claim = _release_if_unavailable(claim, now=now)
    if claim is None:
        previous_claim = (
            submission.review_claims
            .filter(operator=actor, revision=reviewed_revision)
            .order_by("-created_at")
            .first()
        )
        if (
            previous_claim is not None
            and previous_claim.release_reason == "Review Claim expired."
            and previous_claim.expires_at <= now
        ):
            raise ReviewWorkflowConflict(
                "review_claim_expired",
                "The Review Claim expired. Refresh and claim the Submission again.",
            )
        raise ReviewWorkflowConflict(
            "review_claim_required",
            "A current Review Claim owned by this Operator is required.",
        )
    return claim


def release_unavailable_review_claims() -> None:
    now = timezone.now()
    for claim in ReviewClaim.objects.select_related("operator").filter(released_at__isnull=True):
        _release_if_unavailable(claim, now=now)


def _validate_complete_submission(submission: Submission) -> None:
    required = {
        "city": submission.city_id,
        "district": submission.district_id,
        "neighborhood": submission.neighborhood_id,
        "address": submission.address,
        "property_type": submission.property_type,
        "area_sqm": submission.area_sqm,
        "room_count": submission.room_count,
        "deposit_rial": submission.deposit_rial,
        "monthly_rent_rial": submission.monthly_rent_rial,
        "contact_name": submission.contact_name,
        "contact_phone": submission.contact_phone,
    }
    missing = [field for field, value in required.items() if value is None or value == ""]
    if (
        missing
        or not submission.authorization_declared
        or not submission.review_data.get("accuracy_confirmed")
    ):
        raise ValidationError("Submission پیش از ارسال باید کامل و تأیید شده باشد.")
    ensure_submission_media_complete(submission=submission)


@transaction.atomic
def submit_for_review(*, submission: Submission, actor: User) -> Submission:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    if submission.submitter_id != actor.id:
        raise ValidationError("فقط ثبت‌کننده می‌تواند Submission را ارسال کند.")
    if submission.state != SubmissionState.DRAFT:
        raise ValidationError("این نسخه قبلاً ارسال شده یا دیگر قابل ارسال نیست.")
    _validate_complete_submission(submission)
    if submission.source_id is None:
        try:
            submission.source = Source.objects.get(is_builtin=True)
        except Source.DoesNotExist:
            raise ValidationError("منبع مستقیم TorobRent پیکربندی نشده است.") from None
        submission.save(update_fields=("source", "updated_at"))
    submission.pending_since = timezone.now()
    submission.save(update_fields=("pending_since", "updated_at"))
    _record_transition(submission=submission, actor=actor, new_state=SubmissionState.PENDING)
    return submission


@transaction.atomic
def prepare_submission_edit(*, submission: Submission, actor: User) -> Submission:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    if submission.submitter_id != actor.id:
        raise ValidationError("فقط ثبت‌کننده می‌تواند Submission را ویرایش کند.")
    if submission.state in (SubmissionState.PENDING, SubmissionState.REJECTED):
        raise ValidationError("Submission در وضعیت کنونی قابل ویرایش نیست.")
    if submission.state in (SubmissionState.CHANGES_REQUESTED, SubmissionState.PUBLISHED):
        prior_state = submission.state
        submission.revision += 1
        submission.state = SubmissionState.DRAFT
        submission.review_data = {}
        submission.save(update_fields=("revision", "state", "review_data", "updated_at"))
        SubmissionEvent.objects.create(
            submission=submission,
            actor=actor,
            revision=submission.revision,
            prior_state=prior_state,
            new_state=SubmissionState.DRAFT,
            reason="نسخه جدید برای ویرایش ایجاد شد.",
        )
    return submission


@transaction.atomic
def save_submission_step_for_actor(
    *,
    submission: Submission,
    actor: User,
    validated_data: dict[str, Any],
) -> Submission:
    submission = prepare_submission_edit(submission=submission, actor=actor)
    completed_step = validated_data["completed_step"]
    if completed_step == SubmissionStep.IMAGES:
        complete_submission_media_step(submission=submission)
    else:
        if completed_step == SubmissionStep.REVIEW:
            ensure_submission_media_complete(submission=submission)
        _apply_submission_step_update(submission=submission, validated_data=validated_data)
    return Submission.objects.get(id=submission.id)


def _apply_submission_step_update(
    *, submission: Submission, validated_data: dict[str, Any]
) -> None:
    step = validated_data["completed_step"]
    definition = STEP_DEFINITIONS[step]
    values = validated_data.get(definition.section)
    if values is not None:
        for field in definition.fields:
            if field in values:
                setattr(submission, field, values[field])
    contact = validated_data.get("contact")
    if contact is not None:
        submission.contact_name = contact["name"]
        submission.contact_phone = contact["phone"]
        submission.authorization_declared = contact["authorization_declared"]
        submission.phone_publication_consent = contact["phone_publication_consent"]
    if "description" in validated_data:
        submission.description = validated_data["description"]
    if "review" in validated_data:
        submission.review_data = validated_data["review"]
    if STEP_ORDER.index(definition.successor) > STEP_ORDER.index(submission.current_step):
        submission.current_step = definition.successor
    submission.save()


def ensure_operator_is_not_submitter(*, submission: Submission, actor: User) -> None:
    if submission.submitter_id == actor.id:
        raise ValidationError("An Operator cannot decide their own Submission.")


def _required_decision_reason(reason: str) -> str:
    reason = reason.strip()
    if not reason:
        raise ValidationError("A rejection or Request Changes decision requires a reason.")
    return reason


@transaction.atomic
def request_submission_changes(
    *, submission: Submission, actor: User, reviewed_revision: int, reason: str
) -> Submission:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    ensure_operator_is_not_submitter(submission=submission, actor=actor)
    claim = ensure_current_review_claim(
        submission=submission, actor=actor, reviewed_revision=reviewed_revision
    )
    reason = _required_decision_reason(reason)
    decision = _record_transition(
        submission=submission,
        actor=actor,
        new_state=SubmissionState.CHANGES_REQUESTED,
        reason=reason,
        review_claim=claim,
    )
    _schedule_decision_notification(decision)
    _release_claim(claim, actor=actor, reason="Review decision completed.")
    return submission


@transaction.atomic
def reject_submission(
    *, submission: Submission, actor: User, reviewed_revision: int, reason: str
) -> Submission:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    ensure_operator_is_not_submitter(submission=submission, actor=actor)
    claim = ensure_current_review_claim(
        submission=submission, actor=actor, reviewed_revision=reviewed_revision
    )
    reason = _required_decision_reason(reason)
    decision = _record_transition(
        submission=submission,
        actor=actor,
        new_state=SubmissionState.REJECTED,
        reason=reason,
        review_claim=claim,
    )
    _schedule_decision_notification(decision)
    _release_claim(claim, actor=actor, reason="Review decision completed.")
    return submission


def _property_values(submission: Submission, corrections: dict[str, object]) -> dict[str, object]:
    unknown = corrections.keys() - OPERATOR_PROPERTY_FIELDS
    if unknown:
        raise ValidationError(f"اصلاح مشخصات مجاز نیست: {', '.join(sorted(unknown))}")
    values = {field: getattr(submission, field) for field in PROPERTY_FIELDS}
    values.update(corrections)
    return values


def _formatting_only(original: str, formatted: str) -> bool:
    meaningful_original = "".join(character for character in original if character.isalnum())
    meaningful_formatted = "".join(character for character in formatted if character.isalnum())
    return meaningful_original.casefold() == meaningful_formatted.casefold()


def _audit_property_corrections(corrections: dict[str, object]) -> dict[str, object]:
    relation_names = {
        "city": "city_id",
        "district": "district_id",
        "neighborhood": "neighborhood_id",
    }
    audited: dict[str, object] = {}
    for field, value in corrections.items():
        output_field = relation_names.get(field, field)
        audited[output_field] = str(value.pk) if isinstance(value, models.Model) else value
    return audited


@transaction.atomic
def approve_submission(
    *,
    submission: Submission,
    actor: User,
    reviewed_revision: int,
    property_id: UUID | None = None,
    normalized_property: dict[str, object] | None = None,
    source_metadata: dict[str, object] | None = None,
    formatting: dict[str, object] | None = None,
    internal_note: str = "",
) -> Submission:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    ensure_operator_is_not_submitter(submission=submission, actor=actor)
    claim = ensure_current_review_claim(
        submission=submission, actor=actor, reviewed_revision=reviewed_revision
    )
    _validate_complete_submission(submission)
    corrections = normalized_property or {}
    values = _property_values(submission, corrections)
    if submission.deposit_rial is None or submission.monthly_rent_rial is None:
        raise ValidationError("شرایط اجاره کامل نیست.")

    metadata = source_metadata or {}
    allowed_metadata = {"source_reference", "source_claims", "provenance_note"}
    if metadata.keys() - allowed_metadata:
        raise ValidationError("فقط فراداده منبع قابل اصلاح است.")
    formatted = formatting or {}
    if formatted.keys() - {"description"}:
        raise ValidationError("فقط قالب‌بندی توضیحات قابل اصلاح است.")
    if "description" in formatted and not _formatting_only(
        submission.description, str(formatted["description"])
    ):
        raise ValidationError(
            "تغییر محتوای توضیحات باید از مسیر درخواست اصلاح به ثبت‌کننده بازگردد."
        )
    source = submission.source or Source.objects.get(is_builtin=True)
    listing = materialize_direct_listing(
        spec=DirectListingSpec(
            source=source,
            property_values=values,
            property_corrections=corrections,
            property_id=property_id,
            existing_listing_id=submission.listing_id,
            terms_values={
                "deposit_rial": submission.deposit_rial,
                "monthly_rent_rial": submission.monthly_rent_rial,
                "is_negotiable": submission.is_negotiable,
                "is_convertible": submission.is_convertible,
            },
            listing_values={
                "description": formatted.get("description", submission.description),
                "direct_phone": (
                    submission.contact_phone if submission.phone_publication_consent else ""
                ),
                **metadata,
            },
            image_specs=_submission_image_specs(submission),
        )
    )
    submission.listing = listing
    submission.save(update_fields=("listing", "updated_at"))
    normalized_corrections: dict[str, object] = {
        category: values
        for category, values in {
            "property": _audit_property_corrections(corrections),
            "source_metadata": metadata,
            "formatting": formatted,
        }.items()
        if values
    }
    decision = _record_transition(
        submission=submission,
        actor=actor,
        new_state=SubmissionState.PUBLISHED,
        reason=internal_note,
        review_claim=claim,
        normalized_corrections=normalized_corrections,
        publication_result={
            "listing_id": str(listing.id),
            "property_id": str(listing.property_id),
            "state": listing.state,
            "published_at": listing.published_at.isoformat() if listing.published_at else None,
            "available_until": (
                listing.available_until.isoformat() if listing.available_until else None
            ),
        },
    )
    _schedule_decision_notification(decision)
    _release_claim(claim, actor=actor, reason="Review decision completed.")
    return submission


@transaction.atomic
def append_submission_decision_correction(
    *,
    original_event: SubmissionEvent,
    actor: User,
    reason: str,
    correction: dict[str, object],
) -> SubmissionEvent:
    if not actor.is_active or not actor.is_superuser:
        raise ValidationError("Only an active superuser may append a break-glass correction.")
    if not reason.strip():
        raise ValidationError("A break-glass correction requires a reason.")
    if not correction:
        raise ValidationError("A break-glass correction must describe the corrected record.")
    validate_decision_correction(correction)
    original = (
        SubmissionEvent.objects
        .select_for_update()
        .select_related("submission")
        .get(id=original_event.id)
    )
    decision_states = {
        SubmissionState.CHANGES_REQUESTED,
        SubmissionState.REJECTED,
        SubmissionState.PUBLISHED,
    }
    if (
        original.event_type != SubmissionEventType.TRANSITION
        or original.review_claim_id is None
        or original.new_state not in decision_states
    ):
        raise ValidationError("Only an original Submission decision may be corrected.")
    return SubmissionEvent.objects.create(
        submission=original.submission,
        actor=actor,
        event_type=SubmissionEventType.DECISION_CORRECTION,
        review_claim=original.review_claim,
        revision=original.revision,
        prior_state=original.prior_state,
        new_state=original.new_state,
        reason=reason.strip(),
        corrects=original,
        correction=correction,
    )


def validate_image_upload(upload: UploadedFile[bytes]) -> None:
    if upload.size > settings.SUBMISSION_IMAGE_MAX_BYTES:
        raise ValidationError(
            "هر تصویر باید حداکثر "
            f"{settings.SUBMISSION_IMAGE_MAX_BYTES // (1024 * 1024)} مگابایت باشد."
        )
    try:
        image = Image.open(upload)
        image.verify()
        image_format = image.format
    except UnidentifiedImageError, OSError, SyntaxError:
        raise ValidationError("فایل بارگذاری‌شده یک تصویر معتبر نیست.") from None
    finally:
        upload.seek(0)
    if image_format not in ALLOWED_IMAGE_FORMATS:
        raise ValidationError("فقط تصویرهای JPEG، PNG و WebP پذیرفته می‌شوند.")


@transaction.atomic
def add_submission_image(*, submission: Submission, upload: UploadedFile[bytes]) -> SubmissionImage:
    validate_image_upload(upload)
    submission = Submission.objects.select_for_update().get(id=submission.id)
    if submission.state != SubmissionState.DRAFT:
        raise ValidationError("تصاویر فقط در نسخه پیش‌نویس قابل تغییر هستند.")
    position = submission.images.count()
    if position >= MAX_SUBMISSION_IMAGES:
        raise ValidationError("هر Submission می‌تواند حداکثر ۱۲ تصویر داشته باشد.")
    if submission.media_complete:
        submission.media_complete = False
        submission.save(update_fields=("media_complete", "updated_at"))
    image = SubmissionImage.objects.create(
        submission=submission,
        source=upload,
        position=position,
        is_primary=position == 0,
    )
    from .tasks import process_submission_image

    transaction.on_commit(lambda: process_submission_image.delay(str(image.id)))
    return image


def _file_is_referenced(name: str) -> bool:
    return (
        MediaAsset.objects.filter(file=name).exists()
        or SubmissionImage.objects.filter(source=name).exists()
        or SubmissionImageVariant.objects.filter(file=name).exists()
    )


def _delete_unreferenced_files(files: list[tuple[Storage, str]]) -> None:
    for storage, name in files:
        if name and not _file_is_referenced(name):
            storage.delete(name)


def schedule_file_cleanup(files: list[tuple[Storage, str]]) -> None:
    transaction.on_commit(lambda: _delete_unreferenced_files(files))


def schedule_asset_cleanup(asset_id: UUID) -> None:
    transaction.on_commit(lambda: _delete_orphaned_asset(asset_id))


def _delete_orphaned_asset(asset_id: UUID) -> None:
    try:
        MediaAsset.objects.get(id=asset_id).delete()
    except MediaAsset.DoesNotExist, ProtectedError:
        return


@transaction.atomic
def reorder_submission_images(
    *, submission: Submission, image_ids: list[UUID], primary_image_id: UUID
) -> list[SubmissionImage]:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    if submission.state != SubmissionState.DRAFT:
        raise ValidationError("تصاویر فقط در نسخه پیش‌نویس قابل تغییر هستند.")
    images = list(submission.images.select_for_update())
    current_ids = {image.id for image in images}
    requested_ids = set(image_ids)
    if len(image_ids) != len(requested_ids) or requested_ids != current_ids:
        raise ValidationError("ترتیب باید دقیقاً شامل همه تصویرهای این Submission باشد.")
    if primary_image_id not in requested_ids:
        raise ValidationError("تصویر اصلی باید یکی از تصویرهای همین Submission باشد.")
    submission.images.update(position=models.F("position") + MAX_SUBMISSION_IMAGES)
    submission.images.update(is_primary=False)
    for position, image_id in enumerate(image_ids):
        submission.images.filter(id=image_id).update(
            position=position,
            is_primary=image_id == primary_image_id,
        )
    return list(submission.images.prefetch_related("variants__asset"))


def submission_media_is_complete(submission: Submission) -> bool:
    image_count = submission.images.count()
    return (
        1 <= image_count <= MAX_SUBMISSION_IMAGES
        and submission.images.filter(status=SubmissionImageStatus.READY).count() == image_count
        and submission.images.filter(is_primary=True).count() == 1
    )


@transaction.atomic
def complete_submission_media_step(*, submission: Submission) -> Submission:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    if not submission_media_is_complete(submission):
        image_count = submission.images.count()
        if not 1 <= image_count <= MAX_SUBMISSION_IMAGES:
            raise ValidationError("برای ادامه، بین یک تا دوازده تصویر لازم است.")
        if submission.images.filter(status=SubmissionImageStatus.READY).count() != image_count:
            raise ValidationError("پردازش همه تصویرها باید با موفقیت تمام شود.")
        raise ValidationError("دقیقاً یک تصویر اصلی انتخاب کنید.")
    submission.media_complete = True
    if submission.current_step != SubmissionStep.REVIEW:
        submission.current_step = SubmissionStep.CONTACT
    submission.save(update_fields=("media_complete", "current_step", "updated_at"))
    return submission


def ensure_submission_media_complete(*, submission: Submission) -> None:
    if not submission.media_complete or not submission_media_is_complete(submission):
        raise ValidationError("مرحله تصاویر را پیش از بازبینی کامل کنید.")


@transaction.atomic
def retain_submission_media_for_listing(
    *, submission: Submission, listing: Listing
) -> list[ListingImage]:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    ensure_submission_media_complete(submission=submission)
    return replace_listing_images(listing=listing, image_specs=_submission_image_specs(submission))


def _submission_image_specs(submission: Submission) -> list[ListingImageSpec]:
    specs: list[ListingImageSpec] = []
    for image in submission.images.prefetch_related("variants__asset").order_by("position"):
        variants: list[ListingImageVariantSpec] = []
        for variant in image.variants.all():
            asset = variant.asset
            if asset is None:
                asset, _created = MediaAsset.objects.get_or_create(
                    file=variant.file.name,
                    defaults={
                        "width": variant.width,
                        "height": variant.height,
                        "byte_size": variant.byte_size,
                    },
                )
                variant.asset = asset
                variant.save(update_fields=("asset",))
            variants.append(ListingImageVariantSpec(kind=variant.kind, asset_id=asset.id))
        specs.append(
            ListingImageSpec(
                position=image.position,
                is_primary=image.is_primary,
                variants=tuple(variants),
            )
        )
    return specs


@transaction.atomic
def remove_submission_image(*, submission: Submission, image_id: UUID | str) -> None:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    if submission.state != SubmissionState.DRAFT:
        raise ValidationError("تصاویر فقط در نسخه پیش‌نویس قابل تغییر هستند.")
    image = submission.images.select_for_update().get(id=image_id)
    removed_primary = image.is_primary
    image.delete()
    remaining = list(submission.images.order_by("position"))
    submission.images.update(position=models.F("position") + MAX_SUBMISSION_IMAGES)
    if removed_primary and remaining:
        submission.images.update(is_primary=False)
    for position, remaining_image in enumerate(remaining):
        submission.images.filter(id=remaining_image.id).update(
            position=position,
            is_primary=True if removed_primary and position == 0 else remaining_image.is_primary,
        )
    submission.media_complete = submission_media_is_complete(submission)
    submission.save(update_fields=("media_complete", "updated_at"))


def cleanup_abandoned_images() -> int:
    cutoff = timezone.now() - timedelta(hours=settings.SUBMISSION_ABANDONED_IMAGE_HOURS)
    temporary_statuses = (
        SubmissionImageStatus.PENDING,
        SubmissionImageStatus.PROCESSING,
        SubmissionImageStatus.FAILED,
    )
    candidate_ids = list(
        SubmissionImage.objects.filter(
            status__in=temporary_statuses,
            updated_at__lt=cutoff,
        ).values_list("id", flat=True)
    )
    removed = 0
    for image_id in candidate_ids:
        with transaction.atomic():
            image = (
                SubmissionImage.objects
                .select_for_update()
                .select_related("submission")
                .filter(
                    id=image_id,
                    status__in=temporary_statuses,
                    updated_at__lt=cutoff,
                )
                .first()
            )
            if image is None:
                continue
            remove_submission_image(submission=image.submission, image_id=image.id)
            removed += 1
    return removed


@transaction.atomic
def retry_submission_image(
    *, image: SubmissionImage, upload: UploadedFile[bytes]
) -> SubmissionImage:
    validate_image_upload(upload)
    image = (
        SubmissionImage.objects.select_for_update().select_related("submission").get(id=image.id)
    )
    if image.submission.state != SubmissionState.DRAFT:
        raise ValidationError("تصاویر فقط در نسخه پیش‌نویس قابل تغییر هستند.")
    if image.status != SubmissionImageStatus.FAILED:
        raise ValidationError("فقط پردازش ناموفق را می‌توان دوباره تلاش کرد.")
    superseded_files = [(image.source.storage, image.source.name)] if image.source.name else []
    image.variants.all().delete()
    image.source.save("source.upload", upload, save=False)
    image.status = SubmissionImageStatus.PENDING
    image.failure_reason = ""
    image.processed_at = None
    image.save()
    if image.submission.media_complete:
        image.submission.media_complete = False
        image.submission.save(update_fields=("media_complete", "updated_at"))
    schedule_file_cleanup(superseded_files)
    from .tasks import process_submission_image

    transaction.on_commit(lambda: process_submission_image.delay(str(image.id)))
    return image


@transaction.atomic
def add_submission_image_for_actor(
    *, submission: Submission, actor: User, upload: UploadedFile[bytes]
) -> SubmissionImage:
    submission = prepare_submission_edit(submission=submission, actor=actor)
    return add_submission_image(submission=submission, upload=upload)


@transaction.atomic
def reorder_submission_images_for_actor(
    *,
    submission: Submission,
    actor: User,
    image_ids: list[UUID],
    primary_image_id: UUID,
) -> list[SubmissionImage]:
    submission = prepare_submission_edit(submission=submission, actor=actor)
    return reorder_submission_images(
        submission=submission,
        image_ids=image_ids,
        primary_image_id=primary_image_id,
    )


@transaction.atomic
def remove_submission_image_for_actor(
    *, submission: Submission, actor: User, image_id: UUID | str
) -> None:
    submission = prepare_submission_edit(submission=submission, actor=actor)
    remove_submission_image(submission=submission, image_id=image_id)


@transaction.atomic
def retry_submission_image_for_actor(
    *, image: SubmissionImage, actor: User, upload: UploadedFile[bytes]
) -> SubmissionImage:
    submission = prepare_submission_edit(submission=image.submission, actor=actor)
    image.submission = submission
    return retry_submission_image(image=image, upload=upload)


def _render_variant(source: Image.Image, width: int) -> tuple[ContentFile[bytes], int, int, int]:
    variant = source.copy()
    variant.thumbnail((width, width * 4), Image.Resampling.LANCZOS)
    output = BytesIO()
    variant.save(output, format="WEBP", quality=82, method=6, optimize=True)
    content = output.getvalue()
    return ContentFile(content), variant.width, variant.height, len(content)


def _open_source(image: SubmissionImage) -> File[bytes]:
    if not image.source.name:
        raise ValueError("تصویر منبع برای پردازش موجود نیست.")
    return image.source.storage.open(image.source.name, "rb")


def process_image(image_id: str) -> None:
    with transaction.atomic():
        image = SubmissionImage.objects.select_for_update().get(id=image_id)
        if image.status == SubmissionImageStatus.READY:
            return
        image.status = SubmissionImageStatus.PROCESSING
        image.failure_reason = ""
        image.save(update_fields=("status", "failure_reason", "updated_at"))
    try:
        with _open_source(image) as source_file, Image.open(source_file) as uploaded:
            corrected = ImageOps.exif_transpose(uploaded).convert("RGB")
            rendered = {
                kind: _render_variant(corrected, width) for kind, width in VARIANT_WIDTHS.items()
            }
    except Exception:
        logger.exception("Submission image rendering failed", extra={"image_id": image_id})
        _mark_image_failed(image_id)
        return

    written_files: list[tuple[Storage, str]] = []
    try:
        with transaction.atomic():
            image = SubmissionImage.objects.select_for_update().get(id=image_id)
            if image.status == SubmissionImageStatus.READY:
                return
            image.variants.all().delete()
            for kind, (content, width, height, byte_size) in rendered.items():
                asset = MediaAsset(
                    width=width,
                    height=height,
                    byte_size=byte_size,
                )
                asset.file.save(
                    f"submission-media/{image.submission_id}/{image.id}/{kind}.webp",
                    content,
                    save=False,
                )
                if asset.file.name:
                    written_files.append((asset.file.storage, asset.file.name))
                asset.save()
                SubmissionImageVariant.objects.create(
                    image=image,
                    kind=kind,
                    file=asset.file.name,
                    width=width,
                    height=height,
                    byte_size=byte_size,
                    asset=asset,
                )
            image.status = SubmissionImageStatus.READY
            image.processed_at = timezone.now()
            cleanup_files = [(image.source.storage, image.source.name)] if image.source.name else []
            image.source = ""
            image.save(update_fields=("source", "status", "processed_at", "updated_at"))
            schedule_file_cleanup(cleanup_files)
    except Exception:
        logger.exception("Submission image persistence failed", extra={"image_id": image_id})
        _delete_unreferenced_files(written_files)
        _mark_image_failed(image_id)


@transaction.atomic
def _mark_image_failed(image_id: str) -> None:
    image = SubmissionImage.objects.select_for_update().get(id=image_id)
    if image.status == SubmissionImageStatus.READY:
        return
    image.status = SubmissionImageStatus.FAILED
    image.failure_reason = PROCESSING_FAILURE_REASON
    image.processed_at = None
    image.save(update_fields=("status", "failure_reason", "processed_at", "updated_at"))
