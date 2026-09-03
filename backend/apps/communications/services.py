import uuid
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Listing, OutboundPolicy
from apps.source_proposals.models import SourceProposalEvent, SourceProposalState
from apps.submissions.models import SubmissionEvent, SubmissionState

from .models import ListingInquiry, ListingInquiryMessage, SystemNotification


class ListingInquiryError(Exception):
    def __init__(self, message: str, *, code: str) -> None:
        self.code = code
        super().__init__(message)


class ListingInquiryQuotaExceeded(ListingInquiryError):
    pass


class ListingInquiryAlreadyExists(ListingInquiryError):
    pass


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


def _enforce_cold_contact_quota(renter: User) -> None:
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


@transaction.atomic
def start_listing_inquiry(
    *, renter: User, listing_id: uuid.UUID, body: str
) -> tuple[ListingInquiry, ListingInquiryMessage]:
    renter = User.objects.select_for_update().get(id=renter.id)
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
    inquiry = ListingInquiry.objects.filter(renter=renter, listing=listing).first()
    if inquiry is not None:
        raise ListingInquiryAlreadyExists(
            "گفت‌وگوی این آگهی قبلا شروع شده است؛ پاسخ را در همان گفت‌وگو بفرستید.",
            code="listing_inquiry_exists",
        )
    now = timezone.now()
    _enforce_cold_contact_quota(renter)
    inquiry = ListingInquiry.objects.create(
        listing=listing,
        renter=renter,
        submitter=submitter,
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
    inquiry = ListingInquiry.objects.select_for_update().get(id=inquiry.id)
    if actor.id not in (inquiry.renter_id, inquiry.submitter_id):
        raise ListingInquiryError(
            "این گفت‌وگو در دسترس شما نیست.",
            code="listing_inquiry_forbidden",
        )
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
