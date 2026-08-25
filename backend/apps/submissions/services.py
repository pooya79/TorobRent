import logging
from dataclasses import dataclass
from datetime import timedelta
from io import BytesIO
from typing import Any
from uuid import UUID

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile, File
from django.core.files.storage import Storage
from django.core.files.uploadedfile import UploadedFile
from django.db import models, transaction
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError

from apps.accounts.models import User
from apps.catalog.models import Listing, ListingImage, Source
from apps.catalog.services import (
    DirectListingSpec,
    ListingImageSpec,
    ListingImageVariantSpec,
    materialize_direct_listing,
    replace_listing_images,
)

from .models import (
    MediaAsset,
    Submission,
    SubmissionEvent,
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
    *, submission: Submission, actor: User, new_state: SubmissionState, reason: str = ""
) -> None:
    prior_state = submission.state
    submission.state = new_state
    submission.save(update_fields=("state", "updated_at"))
    SubmissionEvent.objects.create(
        submission=submission,
        actor=actor,
        revision=submission.revision,
        prior_state=prior_state,
        new_state=new_state,
        reason=reason,
    )


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


@transaction.atomic
def request_submission_changes(*, submission: Submission, actor: User, reason: str) -> Submission:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    ensure_operator_is_not_submitter(submission=submission, actor=actor)
    if submission.state != SubmissionState.PENDING:
        raise ValidationError("فقط Submission در انتظار بررسی قابل بازگشت است.")
    _record_transition(
        submission=submission,
        actor=actor,
        new_state=SubmissionState.CHANGES_REQUESTED,
        reason=reason,
    )
    return submission


@transaction.atomic
def reject_submission(*, submission: Submission, actor: User, reason: str) -> Submission:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    ensure_operator_is_not_submitter(submission=submission, actor=actor)
    if submission.state != SubmissionState.PENDING:
        raise ValidationError("فقط Submission در انتظار بررسی قابل رد است.")
    _record_transition(
        submission=submission,
        actor=actor,
        new_state=SubmissionState.REJECTED,
        reason=reason,
    )
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


@transaction.atomic
def approve_submission(
    *,
    submission: Submission,
    actor: User,
    property_id: UUID | None = None,
    normalized_property: dict[str, object] | None = None,
    source_metadata: dict[str, object] | None = None,
    formatting: dict[str, object] | None = None,
) -> Submission:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    ensure_operator_is_not_submitter(submission=submission, actor=actor)
    if submission.state != SubmissionState.PENDING:
        raise ValidationError("فقط Submission در انتظار بررسی قابل تأیید است.")
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
    _record_transition(submission=submission, actor=actor, new_state=SubmissionState.PUBLISHED)
    return submission


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
