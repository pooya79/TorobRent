from dataclasses import dataclass
from unicodedata import normalize

from django.utils import timezone
from django.utils.crypto import salted_hmac

from apps.accounts.models import User
from apps.catalog.models import Listing
from apps.common.development_seed import DevelopmentFixtureKind, development_fixture_id
from apps.submissions.models import SubmissionEvent, SubmissionState

from .models import (
    ListingInquiry,
    ListingInquiryMessage,
    SystemNotification,
    SystemNotificationReadState,
)


@dataclass(frozen=True)
class DevelopmentCommunicationResult:
    inquiries: int
    messages: int
    notifications: int


def _fingerprint(body: str) -> str:
    normalized_body = " ".join(normalize("NFKC", body).casefold().split())
    return salted_hmac(
        "listing-inquiry-opening-message",
        normalized_body,
        algorithm="sha256",
    ).hexdigest()


def _seed_inquiry(
    *, index: int, listing: Listing, renter: User, submitter: User, bodies: tuple[str, ...]
) -> ListingInquiry:
    now = timezone.now()
    if listing.property.area_sqm is None:
        raise RuntimeError("Development Listing Properties must have an area")
    inquiry, _created = ListingInquiry.objects.get_or_create(
        id=development_fixture_id(DevelopmentFixtureKind.LISTING_INQUIRY, index),
        defaults={
            "listing": listing,
            "renter": renter,
            "submitter": submitter,
            "opening_property_title": listing.property.title,
            "opening_area_sqm": listing.property.area_sqm,
            "opening_deposit_rial": listing.terms.deposit_rial,
            "opening_monthly_rent_rial": listing.terms.monthly_rent_rial,
            "opening_currency": listing.terms.currency,
            "opening_source_display_name": listing.source.display_name,
            "opening_message_fingerprint": _fingerprint(bodies[0]),
            "renter_read_at": now if index == 2 else None,
            "submitter_read_at": now if index == 1 else None,
            "latest_activity_at": now,
        },
    )
    for position, body in enumerate(bodies, start=1):
        author = renter if position % 2 else submitter
        message, _created = ListingInquiryMessage.objects.get_or_create(
            id=development_fixture_id(
                DevelopmentFixtureKind.LISTING_INQUIRY_MESSAGE, index * 10 + position
            ),
            defaults={"inquiry": inquiry, "author": author, "body": body},
        )
        if position == len(bodies) and inquiry.latest_activity_at != message.created_at:
            inquiry.latest_activity_at = message.created_at
            inquiry.save(update_fields=("latest_activity_at",))
    return inquiry


def seed_development_communications(
    *,
    submitter: User,
    renter: User,
    renter_two: User,
    published_listing: Listing,
    expired_listing: Listing,
) -> DevelopmentCommunicationResult:
    _seed_inquiry(
        index=1,
        listing=published_listing,
        renter=renter,
        submitter=submitter,
        bodies=(
            "سلام، آیا این خانه هنوز برای بازدید در دسترس است؟",
            "سلام، بله. عصر فردا برای بازدید مناسب است.",
            "ممنون، لطفا ساعت دقیق را اعلام کنید.",
        ),
    )
    _seed_inquiry(
        index=2,
        listing=expired_listing,
        renter=renter_two,
        submitter=submitter,
        bodies=(
            "سلام، شرایط اجاره این مورد چگونه است؟",
            "این آگهی اکنون منقضی شده و گفت و گو فقط خواندنی است.",
        ),
    )

    decision_events = list(
        SubmissionEvent.objects.filter(
            submission__submitter=submitter,
            new_state__in=(
                SubmissionState.CHANGES_REQUESTED,
                SubmissionState.REJECTED,
                SubmissionState.PUBLISHED,
            ),
        ).order_by("id")
    )
    notifications = []
    for index, event in enumerate(decision_events, start=1):
        notification, _created = SystemNotification.objects.get_or_create(
            recipient=submitter,
            originating_event=event,
            defaults={
                "id": development_fixture_id(DevelopmentFixtureKind.SYSTEM_NOTIFICATION, index),
                "target_submission": event.submission,
            },
        )
        notifications.append(notification)
    if notifications:
        SystemNotificationReadState.objects.get_or_create(notification=notifications[0])

    return DevelopmentCommunicationResult(
        inquiries=ListingInquiry.objects.filter(
            id__in=[
                development_fixture_id(DevelopmentFixtureKind.LISTING_INQUIRY, index)
                for index in (1, 2)
            ]
        ).count(),
        messages=ListingInquiryMessage.objects.filter(
            inquiry_id__in=[
                development_fixture_id(DevelopmentFixtureKind.LISTING_INQUIRY, index)
                for index in (1, 2)
            ]
        ).count(),
        notifications=len(notifications),
    )
