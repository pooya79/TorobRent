from collections.abc import Sequence
from dataclasses import dataclass

from apps.accounts.models import User
from apps.catalog.models import Listing, Property
from apps.common.development_seed import DevelopmentFixtureKind, development_fixture_id

from .models import (
    Submission,
    SubmissionEvent,
    SubmissionState,
    SubmissionStep,
    SubmitterRole,
)


@dataclass(frozen=True)
class DevelopmentSubmissionSpec:
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
            id=development_fixture_id(
                DevelopmentFixtureKind.SUBMISSION_EVENT, index * 10 + position
            ),
            defaults={
                "submission": submission,
                "actor": actor,
                "revision": 1,
                "prior_state": prior_state,
                "new_state": new_state,
                "reason": reason,
            },
        )


def seed_development_submissions(
    *,
    submitter: User,
    operator: User,
    property_: Property,
    published_listing: Listing,
    expired_listing: Listing,
    listings: Sequence[Listing],
) -> None:
    if not submitter.phone_verified or submitter.phone is None:
        raise RuntimeError("The development submitter must have a verified phone")
    specs = [
        DevelopmentSubmissionSpec(SubmissionState.DRAFT),
        DevelopmentSubmissionSpec(SubmissionState.PENDING),
        DevelopmentSubmissionSpec(SubmissionState.CHANGES_REQUESTED),
        DevelopmentSubmissionSpec(SubmissionState.REJECTED),
        DevelopmentSubmissionSpec(SubmissionState.PUBLISHED, published_listing),
        DevelopmentSubmissionSpec(SubmissionState.PUBLISHED, expired_listing),
    ]
    specs.extend(
        DevelopmentSubmissionSpec(SubmissionState.PUBLISHED, listing)
        for listing in listings
        if listing.source.is_builtin
        and listing.state == "published"
        and listing.pk != published_listing.pk
    )
    for index, spec in enumerate(specs, start=1):
        contact_phone = submitter.phone
        submission_property = spec.listing.property if spec.listing is not None else property_
        submission, created = Submission.objects.get_or_create(
            id=development_fixture_id(DevelopmentFixtureKind.SUBMISSION, index),
            defaults={
                "submitter": submitter,
                "role": SubmitterRole.OWNER if index % 2 else SubmitterRole.AGENT,
                "state": spec.state,
                "revision": 2 if spec.state == SubmissionState.CHANGES_REQUESTED else 1,
                "source": spec.listing.source if spec.listing else None,
                "listing": spec.listing,
                "current_step": SubmissionStep.REVIEW,
                "media_complete": True,
                "city": submission_property.city,
                "district": submission_property.district,
                "neighborhood": submission_property.neighborhood,
                "address": f"نشانی ساختگی محیط توسعه {index}",
                "property_type": submission_property.property_type,
                "area_sqm": submission_property.area_sqm,
                "room_count": submission_property.room_count,
                "construction_year": submission_property.construction_year,
                "floor": submission_property.floor,
                "total_floors": submission_property.total_floors,
                "units_per_floor": submission_property.units_per_floor,
                "deposit_rial": 5_000_000_000,
                "monthly_rent_rial": 100_000_000,
                "parking": submission_property.parking,
                "elevator": submission_property.elevator,
                "storage": submission_property.storage,
                "balcony": submission_property.balcony,
                "furnished": submission_property.furnished,
                "description": "پیشنهاد ساختگی برای توسعه گردش کار Submitter و Operator.",
                "contact_name": "کاربر توسعه",
                "contact_phone": contact_phone,
                "authorization_declared": True,
                "phone_publication_consent": True,
                "review_data": {"development_seed": True},
            },
        )
        if (
            index == 6
            and submission.listing_id == expired_listing.pk
            and submission.source_id != expired_listing.source_id
        ):
            submission.source = expired_listing.source
            submission.save(update_fields=("source",))
        if created:
            _seed_events(
                submission=submission,
                index=index,
                submitter=submitter,
                operator=operator,
            )
