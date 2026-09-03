from django.db import models
from django.db.models import QuerySet

from apps.accounts.models import User

from .models import ListingInquiry, MessageKind, SystemNotification


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
