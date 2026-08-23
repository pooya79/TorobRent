from collections.abc import Sequence
from dataclasses import dataclass

from apps.accounts.models import User
from apps.catalog.models import Listing, Property
from apps.common.demo import DemoFixtureKind, demo_id

from .models import (
    Submission,
    SubmissionEvent,
    SubmissionState,
    SubmissionStep,
    SubmitterRole,
)


@dataclass(frozen=True)
class DemoSubmissionSpec:
    state: SubmissionState
    listing: Listing | None = None


def _seed_events(*, submission: Submission, index: int, submitter: User, operator: User) -> None:
    current_state = SubmissionState(submission.state)
    transitions: Sequence[tuple[SubmissionState, SubmissionState, User, str]] = ()
    if current_state != SubmissionState.DRAFT:
        transitions = ((SubmissionState.DRAFT, SubmissionState.PENDING, submitter, ""),)
    decision = {
        SubmissionState.CHANGES_REQUESTED: "تصاویر و توضیحات تماس نیازمند اصلاح هستند.",
        SubmissionState.REJECTED: "مجوز انتشار این پیشنهاد قابل تأیید نیست.",
        SubmissionState.PUBLISHED: "پیشنهاد برای نمایش نسخه محلی تأیید شد.",
    }.get(current_state)
    if decision is not None:
        transitions = (
            *transitions,
            (SubmissionState.PENDING, current_state, operator, decision),
        )
    for position, (prior_state, new_state, actor, reason) in enumerate(transitions, start=1):
        SubmissionEvent.objects.get_or_create(
            id=demo_id(DemoFixtureKind.SUBMISSION_EVENT, index * 10 + position),
            defaults={
                "submission": submission,
                "actor": actor,
                "revision": 1,
                "prior_state": prior_state,
                "new_state": new_state,
                "reason": reason,
            },
        )


def seed_demo_submissions(
    *,
    submitter: User,
    operator: User,
    property_: Property,
    published_listing: Listing,
    expired_listing: Listing,
) -> None:
    specs = (
        DemoSubmissionSpec(SubmissionState.DRAFT),
        DemoSubmissionSpec(SubmissionState.PENDING),
        DemoSubmissionSpec(SubmissionState.CHANGES_REQUESTED),
        DemoSubmissionSpec(SubmissionState.REJECTED),
        DemoSubmissionSpec(SubmissionState.PUBLISHED, published_listing),
        DemoSubmissionSpec(SubmissionState.PUBLISHED, expired_listing),
    )
    for index, spec in enumerate(specs, start=1):
        submission, created = Submission.objects.get_or_create(
            id=demo_id(DemoFixtureKind.SUBMISSION, index),
            defaults={
                "submitter": submitter,
                "role": SubmitterRole.OWNER if index % 2 else SubmitterRole.AGENT,
                "state": spec.state,
                "revision": 2 if spec.state == SubmissionState.CHANGES_REQUESTED else 1,
                "source": spec.listing.source if spec.listing else None,
                "listing": spec.listing,
                "current_step": SubmissionStep.REVIEW,
                "media_complete": True,
                "city": property_.city,
                "district": property_.district,
                "neighborhood": property_.neighborhood,
                "address": f"نشانی ساختگی نسخه نمایشی {index}",
                "property_type": property_.property_type,
                "area_sqm": property_.area_sqm,
                "room_count": property_.room_count,
                "construction_year": property_.construction_year,
                "floor": property_.floor,
                "total_floors": property_.total_floors,
                "units_per_floor": property_.units_per_floor,
                "deposit_rial": 5_000_000_000,
                "monthly_rent_rial": 100_000_000,
                "parking": property_.parking,
                "elevator": property_.elevator,
                "storage": property_.storage,
                "balcony": property_.balcony,
                "furnished": property_.furnished,
                "description": "پیشنهاد ساختگی برای نمایش گردش کار Submitter و Operator.",
                "contact_name": "کاربر نمایشی",
                "contact_phone": "09120000000",
                "authorization_declared": True,
                "phone_publication_consent": True,
                "review_data": {"demo": True},
            },
        )
        if created:
            _seed_events(
                submission=submission,
                index=index,
                submitter=submitter,
                operator=operator,
            )
