import uuid
from datetime import datetime, timedelta
from enum import StrEnum
from unicodedata import normalize

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac

from apps.accounts.models import User
from apps.catalog.models import Listing, ListingState, OutboundPolicy
from apps.source_proposals.models import SourceProposalEvent, SourceProposalState
from apps.submissions.models import SubmissionEvent, SubmissionState

from .models import (
    AccountBlock,
    ConversationModerationEvent,
    ConversationModerationEventType,
    ConversationReport,
    ConversationReportStatus,
    InquiryInitiationSuspension,
    ListingInquiry,
    ListingInquiryMessage,
    ListingInquiryReplyUnavailableReason,
    ModeratedPairRestriction,
    SystemNotification,
)
from .selectors import blocked_counterpart_ids


class ListingInquiryError(Exception):
    def __init__(self, message: str, *, code: str) -> None:
        self.code = code
        super().__init__(message)


class ListingInquiryQuotaExceeded(ListingInquiryError):
    pass


class ListingInquiryConflictError(ListingInquiryError):
    pass


class ListingInquiryAlreadyExists(ListingInquiryConflictError):
    pass


class ListingInquiryEditConflict(ListingInquiryConflictError):
    pass


@transaction.atomic
def report_listing_inquiry(
    *,
    inquiry: ListingInquiry,
    reporter: User,
    target_message_id: uuid.UUID | None,
    explanation: str,
) -> ConversationReport:
    inquiry = (
        ListingInquiry.objects
        .select_for_update()
        .prefetch_related("messages__author")
        .get(id=inquiry.id)
    )
    if reporter.id not in (inquiry.renter_id, inquiry.submitter_id):
        raise ListingInquiryError(
            "این گفت‌وگو در دسترس شما نیست.",
            code="listing_inquiry_forbidden",
        )
    messages = list(inquiry.messages.all())
    target_message = None
    if target_message_id is not None:
        target_message = next(
            (message for message in messages if message.id == target_message_id),
            None,
        )
        if target_message is None:
            raise ListingInquiryError(
                "پیام گزارش‌شده در این گفت‌وگو پیدا نشد.",
                code="conversation_report_target_invalid",
            )
    now = timezone.now()
    ListingInquiryMessage.objects.filter(
        id__in=[message.id for message in messages], edit_locked_at__isnull=True
    ).update(edit_locked_at=now)
    evidence = {
        "inquiry_id": str(inquiry.id),
        "target_message_id": str(target_message.id) if target_message is not None else None,
        "participants": {
            "renter_id": str(inquiry.renter_id),
            "submitter_id": str(inquiry.submitter_id),
        },
        "messages": [
            {
                "id": str(message.id),
                "author_id": str(message.author_id),
                "author_display_name": message.author.display_name,
                "body": message.body,
                "created_at": message.created_at.isoformat().replace("+00:00", "Z"),
                "edited_at": (
                    message.edited_at.isoformat().replace("+00:00", "Z")
                    if message.edited_at is not None
                    else None
                ),
            }
            for message in messages
        ],
    }
    return ConversationReport.objects.create(
        inquiry=inquiry,
        target_message=target_message,
        reporter=reporter,
        explanation=explanation,
        evidence=evidence,
    )


@transaction.atomic
def decide_conversation_report(
    *,
    report: ConversationReport,
    actor: User,
    decision: ConversationReportStatus,
    internal_note: str,
    restrict_pair: bool,
    suspend_account_id: uuid.UUID | None,
) -> ConversationReport:
    report = (
        ConversationReport.objects.select_for_update().select_related("inquiry").get(id=report.id)
    )
    if report.status != ConversationReportStatus.PENDING:
        raise ValidationError("This Conversation Report has already been decided.")
    if decision == ConversationReportStatus.DISMISSED and (
        restrict_pair or suspend_account_id is not None
    ):
        raise ValidationError("A dismissed report cannot apply restrictions.")
    participant_ids = (report.inquiry.renter_id, report.inquiry.submitter_id)
    if suspend_account_id is not None and suspend_account_id not in participant_ids:
        raise ValidationError("The suspended account must be a report participant.")

    report.status = decision
    report.decided_by = actor
    report.decided_at = timezone.now()
    report.internal_note = internal_note
    report.save(update_fields=("status", "decided_by", "decided_at", "internal_note"))
    ConversationModerationEvent.objects.create(
        report=report,
        actor=actor,
        event_type=(
            ConversationModerationEventType.UPHELD
            if decision == ConversationReportStatus.UPHELD
            else ConversationModerationEventType.DISMISSED
        ),
        internal_note=internal_note,
    )
    if (
        decision == ConversationReportStatus.DISMISSED
        and not ConversationReport.objects.filter(
            inquiry=report.inquiry,
            status__in=(ConversationReportStatus.PENDING, ConversationReportStatus.UPHELD),
        ).exists()
    ):
        evidence_message_ids = [
            item["id"] for item in report.evidence.get("messages", []) if "id" in item
        ]
        ListingInquiryMessage.objects.filter(id__in=evidence_message_ids).update(
            edit_locked_at=None
        )
    if restrict_pair:
        lower_id, higher_id = sorted(participant_ids, key=lambda account_id: account_id.int)
        list(User.objects.select_for_update().filter(id__in=participant_ids).order_by("id"))
        ModeratedPairRestriction.objects.get_or_create(
            lower_account_id=lower_id,
            higher_account_id=higher_id,
            defaults={"report": report, "created_by": actor},
        )
        ConversationModerationEvent.objects.create(
            report=report,
            actor=actor,
            event_type=ConversationModerationEventType.PAIR_RESTRICTED,
        )
    if suspend_account_id is not None:
        InquiryInitiationSuspension.objects.get_or_create(
            account_id=suspend_account_id,
            defaults={"report": report, "created_by": actor},
        )
        ConversationModerationEvent.objects.create(
            report=report,
            actor=actor,
            event_type=ConversationModerationEventType.INITIATION_SUSPENDED,
            metadata={"account_id": str(suspend_account_id)},
        )
    return report


class ListingInquiryMessageEditDeniedReason(StrEnum):
    WRONG_AUTHOR = "listing_inquiry_message_edit_forbidden"
    LOCKED = "listing_inquiry_message_edit_locked"
    EXPIRED = "listing_inquiry_message_edit_window_expired"
    ACCOUNT_BLOCKED = ListingInquiryReplyUnavailableReason.ACCOUNT_BLOCKED
    LISTING_INACTIVE = ListingInquiryReplyUnavailableReason.LISTING_INACTIVE
    RESPONSIBILITY_CHANGED = ListingInquiryReplyUnavailableReason.RESPONSIBILITY_CHANGED


def inquiry_reply_unavailable_reason(
    inquiry: ListingInquiry,
) -> ListingInquiryReplyUnavailableReason | None:
    if accounts_are_blocked(inquiry.renter_id, inquiry.submitter_id):
        return ListingInquiryReplyUnavailableReason.ACCOUNT_BLOCKED
    listing = inquiry.listing
    if (
        listing.state != ListingState.PUBLISHED
        or listing.available_until is None
        or listing.available_until <= timezone.now()
        or not listing.source.is_active
    ):
        return ListingInquiryReplyUnavailableReason.LISTING_INACTIVE
    try:
        current_submitter_id = listing.submission.submitter_id
    except Listing.submission.RelatedObjectDoesNotExist:
        return ListingInquiryReplyUnavailableReason.RESPONSIBILITY_CHANGED
    if current_submitter_id != inquiry.submitter_id:
        return ListingInquiryReplyUnavailableReason.RESPONSIBILITY_CHANGED
    return None


def accounts_are_blocked(first_account_id: uuid.UUID, second_account_id: uuid.UUID) -> bool:
    return second_account_id in blocked_counterpart_ids(first_account_id)


@transaction.atomic
def block_listing_inquiry_counterpart(*, inquiry: ListingInquiry, actor: User) -> AccountBlock:
    inquiry = ListingInquiry.objects.select_for_update().get(id=inquiry.id)
    if actor.id not in (inquiry.renter_id, inquiry.submitter_id):
        raise ListingInquiryError(
            "این گفت‌وگو در دسترس شما نیست.",
            code="listing_inquiry_forbidden",
        )
    lower_account_id, higher_account_id = sorted(
        (inquiry.renter_id, inquiry.submitter_id), key=lambda account_id: account_id.int
    )
    list(
        User.objects
        .select_for_update()
        .filter(id__in=(lower_account_id, higher_account_id))
        .order_by("id")
    )
    block, _created = AccountBlock.objects.get_or_create(
        lower_account_id=lower_account_id,
        higher_account_id=higher_account_id,
        defaults={"created_by": actor},
    )
    return block


def inquiry_message_edit_denied_reason(
    message: ListingInquiryMessage,
    *,
    actor_id: uuid.UUID | None,
    now: datetime | None = None,
) -> ListingInquiryMessageEditDeniedReason | None:
    if message.author_id != actor_id:
        return ListingInquiryMessageEditDeniedReason.WRONG_AUTHOR
    if message.edit_locked_at is not None:
        return ListingInquiryMessageEditDeniedReason.LOCKED
    if message.created_at < (now or timezone.now()) - timedelta(minutes=15):
        return ListingInquiryMessageEditDeniedReason.EXPIRED
    unavailable_reason = inquiry_reply_unavailable_reason(message.inquiry)
    if unavailable_reason is not None:
        return ListingInquiryMessageEditDeniedReason(unavailable_reason)
    return None


def _eligible_listing(listing_id: uuid.UUID) -> Listing:
    try:
        return (
            Listing.objects
            .active()
            .select_related("submission", "submission__submitter")
            .get(
                id=listing_id,
                source__is_builtin=True,
                source__outbound_policy=OutboundPolicy.DIRECT_CONTACT,
                submission__state=SubmissionState.PUBLISHED,
            )
        )
    except (Listing.DoesNotExist, ValidationError, ValueError) as exc:
        raise ListingInquiryError(
            "این آگهی برای پیام به ثبت‌کننده در دسترس نیست.",
            code="listing_inquiry_unavailable",
        ) from exc


def _opening_message_fingerprint(body: str) -> str:
    normalized_body = " ".join(normalize("NFKC", body).casefold().split())
    return salted_hmac(
        "listing-inquiry-opening-message",
        normalized_body,
        algorithm="sha256",
    ).hexdigest()


def _enforce_cold_contact_quota(renter: User, *, message_fingerprint: str) -> None:
    now = timezone.now()
    hourly_limit = settings.LISTING_INQUIRY_COLD_HOURLY_LIMIT
    daily_limit = settings.LISTING_INQUIRY_COLD_DAILY_LIMIT
    inquiries = ListingInquiry.objects.filter(renter=renter)
    if inquiries.filter(created_at__gte=now - timedelta(hours=1)).count() >= hourly_limit:
        raise ListingInquiryQuotaExceeded(
            "سقف شروع گفت‌وگوهای تازه در یک ساعت پر شده است.",
            code="listing_inquiry_hourly_limit",
        )
    if inquiries.filter(created_at__gte=now - timedelta(days=1)).count() >= daily_limit:
        raise ListingInquiryQuotaExceeded(
            "سقف شروع گفت‌وگوهای تازه امروز پر شده است.",
            code="listing_inquiry_daily_limit",
        )
    repeated_content_limit = settings.LISTING_INQUIRY_REPEATED_CONTENT_DAILY_LIMIT
    if (
        inquiries.filter(
            created_at__gte=now - timedelta(days=1),
            opening_message_fingerprint=message_fingerprint,
        ).count()
        >= repeated_content_limit
    ):
        raise ListingInquiryQuotaExceeded(
            "برای شروع گفت‌وگوهای تازه از یک متن تکراری استفاده نکنید.",
            code="repeated_content_limit",
        )


@transaction.atomic
def start_listing_inquiry(
    *, renter: User, listing_id: uuid.UUID, body: str
) -> tuple[ListingInquiry, ListingInquiryMessage]:
    renter = User.objects.select_for_update().get(id=renter.id)
    if InquiryInitiationSuspension.objects.filter(account=renter).exists():
        raise ListingInquiryError(
            "امکان شروع گفت‌وگوی تازه برای این حساب تعلیق شده است.",
            code="inquiry_initiation_suspended",
        )
    if not renter.display_name:
        raise ListingInquiryError(
            "پیش از ارسال نخستین پیام یک نام نمایشی انتخاب کنید.",
            code="display_name_required",
        )
    listing = _eligible_listing(listing_id)
    submitter = listing.submission.submitter
    if renter.id == submitter.id:
        raise ListingInquiryError(
            "این آگهی متعلق به خود شماست.",
            code="self_listing_inquiry",
        )
    if accounts_are_blocked(renter.id, submitter.id):
        raise ListingInquiryError(
            "ارتباط میان این دو حساب مسدود شده است.",
            code=ListingInquiryReplyUnavailableReason.ACCOUNT_BLOCKED,
        )
    inquiry = ListingInquiry.objects.filter(renter=renter, listing=listing).first()
    if inquiry is not None:
        raise ListingInquiryAlreadyExists(
            "گفت‌وگوی این آگهی قبلا شروع شده است؛ پاسخ را در همان گفت‌وگو بفرستید.",
            code="listing_inquiry_exists",
        )
    now = timezone.now()
    message_fingerprint = _opening_message_fingerprint(body)
    _enforce_cold_contact_quota(renter, message_fingerprint=message_fingerprint)
    assert listing.property.area_sqm is not None
    inquiry = ListingInquiry.objects.create(
        listing=listing,
        renter=renter,
        submitter=submitter,
        opening_property_title=listing.property.title,
        opening_area_sqm=listing.property.area_sqm,
        opening_deposit_rial=listing.terms.deposit_rial,
        opening_monthly_rent_rial=listing.terms.monthly_rent_rial,
        opening_currency=listing.terms.currency,
        opening_source_display_name=listing.source.display_name,
        opening_message_fingerprint=message_fingerprint,
        renter_read_at=now,
        latest_activity_at=now,
    )
    message = ListingInquiryMessage.objects.create(
        inquiry=inquiry,
        author=renter,
        body=body,
    )
    inquiry.latest_activity_at = message.created_at
    inquiry.renter_read_at = message.created_at
    inquiry.save(update_fields=("latest_activity_at", "renter_read_at"))
    return inquiry, message


@transaction.atomic
def reply_to_listing_inquiry(
    *, inquiry: ListingInquiry, actor: User, body: str
) -> ListingInquiryMessage:
    inquiry = (
        ListingInquiry.objects
        .select_for_update()
        .select_related("listing__source", "listing__submission")
        .get(id=inquiry.id)
    )
    if actor.id not in (inquiry.renter_id, inquiry.submitter_id):
        raise ListingInquiryError(
            "این گفت‌وگو در دسترس شما نیست.",
            code="listing_inquiry_forbidden",
        )
    unavailable_reason = inquiry_reply_unavailable_reason(inquiry)
    if unavailable_reason is not None:
        error_message = (
            "مسئولیت این آگهی تغییر کرده و این گفت‌وگو فقط خواندنی است."
            if unavailable_reason == ListingInquiryReplyUnavailableReason.RESPONSIBILITY_CHANGED
            else "این آگهی فعال نیست و تا فعال‌شدن دوباره امکان ارسال پیام ندارد."
        )
        raise ListingInquiryError(error_message, code=unavailable_reason)
    message = ListingInquiryMessage.objects.create(
        inquiry=inquiry,
        author=actor,
        body=body,
    )
    inquiry.latest_activity_at = message.created_at
    if actor.id == inquiry.renter_id:
        inquiry.renter_read_at = message.created_at
        fields = ("latest_activity_at", "renter_read_at")
    else:
        inquiry.submitter_read_at = message.created_at
        fields = ("latest_activity_at", "submitter_read_at")
    inquiry.save(update_fields=fields)
    return message


@transaction.atomic
def edit_listing_inquiry_message(
    *, message: ListingInquiryMessage, actor: User, body: str
) -> ListingInquiryMessage:
    message = (
        ListingInquiryMessage.objects
        .select_for_update()
        .select_related("inquiry__listing__source", "inquiry__listing__submission")
        .get(id=message.id)
    )
    now = timezone.now()
    denied_reason = inquiry_message_edit_denied_reason(message, actor_id=actor.id, now=now)
    if denied_reason is not None:
        messages = {
            ListingInquiryMessageEditDeniedReason.WRONG_AUTHOR: (
                "فقط نویسنده پیام می‌تواند آن را ویرایش کند."
            ),
            ListingInquiryMessageEditDeniedReason.LOCKED: (
                "محتوای ثبت‌شده برای بررسی قابل ویرایش نیست."
            ),
            ListingInquiryMessageEditDeniedReason.EXPIRED: (
                "مهلت ۱۵ دقیقه‌ای ویرایش پیام پایان یافته است."
            ),
            ListingInquiryMessageEditDeniedReason.ACCOUNT_BLOCKED: (
                "ارتباط میان این دو حساب مسدود شده است."
            ),
            ListingInquiryMessageEditDeniedReason.LISTING_INACTIVE: (
                "این آگهی فعال نیست و گفت‌وگو فقط خواندنی است."
            ),
            ListingInquiryMessageEditDeniedReason.RESPONSIBILITY_CHANGED: (
                "مسئولیت آگهی تغییر کرده و گفت‌وگو فقط خواندنی است."
            ),
        }
        error_type = (
            ListingInquiryError
            if denied_reason == ListingInquiryMessageEditDeniedReason.WRONG_AUTHOR
            else ListingInquiryEditConflict
        )
        raise error_type(messages[denied_reason], code=denied_reason)
    message.body = body
    message.edited_at = now
    message.save(update_fields=("body", "edited_at"))
    return message


@transaction.atomic
def lock_listing_inquiry_message_edits(
    *, message: ListingInquiryMessage, locked_at: datetime | None = None
) -> ListingInquiryMessage:
    message = ListingInquiryMessage.objects.select_for_update().get(id=message.id)
    if message.edit_locked_at is None:
        message.edit_locked_at = locked_at or timezone.now()
        message.save(update_fields=("edit_locked_at",))
    return message


def create_submission_review_notification(decision: SubmissionEvent) -> SystemNotification:
    notification, _ = SystemNotification.objects.get_or_create(
        recipient=decision.submission.submitter,
        originating_event=decision,
        defaults={"target_submission": decision.submission},
    )
    return notification


def create_source_proposal_review_notification(
    decision: SourceProposalEvent,
) -> SystemNotification | None:
    if decision.new_state not in (
        SourceProposalState.CHANGES_REQUESTED,
        SourceProposalState.REJECTED,
        SourceProposalState.APPROVED,
    ):
        return None
    notification, _ = SystemNotification.objects.get_or_create(
        recipient=decision.proposal.submitter,
        originating_source_proposal_event=decision,
        defaults={"target_source_proposal": decision.proposal},
    )
    return notification
