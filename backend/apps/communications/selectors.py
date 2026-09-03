import uuid

from django.db import models
from django.db.models import QuerySet

from apps.accounts.models import User

from .models import AccountBlock, ListingInquiry, MessageKind, SystemNotification


def blocked_counterpart_ids(account_id: uuid.UUID) -> set[uuid.UUID]:
    blocks = AccountBlock.objects.filter(
        models.Q(lower_account_id=account_id) | models.Q(higher_account_id=account_id)
    ).values_list("lower_account_id", "higher_account_id")
    return {higher_id if lower_id == account_id else lower_id for lower_id, higher_id in blocks}


def listing_inquiries_for(participant: User, *, unread: bool = False) -> QuerySet[ListingInquiry]:
    inquiries = (
        ListingInquiry.objects
        .filter(models.Q(renter=participant) | models.Q(submitter=participant))
        .select_related(
            "listing__property",
            "listing__source",
            "listing__submission",
            "renter",
            "submitter",
        )
        .prefetch_related("messages")
    )
    if unread:
        inquiries = inquiries.filter(
            models.Q(
                renter=participant,
                renter_read_at__lt=models.F("latest_activity_at"),
            )
            | models.Q(renter=participant, renter_read_at__isnull=True)
            | models.Q(
                submitter=participant,
                submitter_read_at__lt=models.F("latest_activity_at"),
            )
            | models.Q(submitter=participant, submitter_read_at__isnull=True)
        )
    return inquiries


def system_notifications_for(
    recipient: User, *, kind: str = "all", unread: bool = False
) -> QuerySet[SystemNotification]:
    notifications = SystemNotification.objects.filter(recipient=recipient).select_related(
        "originating_event__submission",
        "originating_source_proposal_event__proposal",
    )
    if kind not in ("all", MessageKind.SYSTEM_NOTIFICATION):
        return notifications.none()
    if unread:
        notifications = notifications.filter(read_state__isnull=True)
    return notifications
