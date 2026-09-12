"""Translate retained extraction evidence into catalog-ready candidates."""

from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.catalog.models import (
    City,
    District,
    Listing,
    Neighborhood,
    Property,
    PropertyType,
    RentalTerms,
    Source,
    property_type_requires_room_count,
)
from apps.catalog.services import ExternalListingSpec, materialize_external_listing
from apps.source_extraction.normalization import DIGIT_TRANSLATION, normalize_text

from .models import ExternalListingCandidate, ExtractionRun, PublicationOutcome

FIELD_NAMES = {"floor_area_sqm": "area_sqm", "bedroom_count": "room_count"}
PROPERTY_FIELDS = ("city", "district", "neighborhood", "property_type", "area_sqm", "room_count")
TERMS_FIELDS = ("deposit_rial", "monthly_rent_rial")


def property_values(candidate: ExternalListingCandidate) -> dict[str, Any]:
    return {name: getattr(candidate, name) for name in PROPERTY_FIELDS}


def validation_errors(candidate: ExternalListingCandidate) -> dict[str, Any]:
    errors: dict[str, Any] = {}
    for model in (
        Property(**property_values(candidate)),
        RentalTerms(**{name: getattr(candidate, name) for name in TERMS_FIELDS}),
    ):
        try:
            model.full_clean()
        except ValidationError as exc:
            errors.update(exc.message_dict)
    required = {*PROPERTY_FIELDS, *TERMS_FIELDS}
    if candidate.property_type in PropertyType.values and not property_type_requires_room_count(
        candidate.property_type
    ):
        required.discard("room_count")
    for field in candidate.conflicts:
        name = FIELD_NAMES.get(field, field)
        if name in required and name not in candidate.corrections:
            errors[name] = ["شواهد منبع متعارض است؛ اصلاح دستی لازم است."]
    if candidate.extraction_run is not None:
        result: dict[str, Any] = next(
            (
                item
                for item in candidate.extraction_run.results
                if item["canonical_url"] == candidate.external_url
            ),
            {},
        )
        if result.get("structural_drift") and not candidate.corrections.get("_structure_reviewed"):
            errors["structure"] = ["ساختار صفحه نیازمند بررسی دستی است."]
    return errors


def _bounded_integer(value: Any, maximum: int) -> int | None:
    return value if type(value) is int and 0 <= value <= maximum else None


def create_run_candidates(run: ExtractionRun) -> None:
    from apps.source_extraction.fetching import MAX_SOURCE_IMAGES

    from .models import CandidateImage
    from .tasks import process_run_images

    remaining_images = MAX_SOURCE_IMAGES
    for result in run.results:
        values = result["normalized"]
        city = next(
            (
                item
                for item in City.objects.filter(reviewed=True)
                if normalize_text(item.name_fa) == normalize_text(values.get("city", ""))
            ),
            None,
        )
        district = (
            next(
                (
                    item
                    for item in District.objects.filter(city=city, reviewed=True)
                    if normalize_text(f"منطقه {item.number}")
                    == normalize_text(values.get("district", "")).translate(DIGIT_TRANSLATION)
                ),
                None,
            )
            if city
            else None
        )
        neighborhood = (
            next(
                (
                    item
                    for item in Neighborhood.objects.filter(district=district, reviewed=True)
                    if normalize_text(item.name_fa)
                    == normalize_text(values.get("neighborhood", ""))
                ),
                None,
            )
            if district
            else None
        )
        candidate = ExternalListingCandidate(
            extraction_run=run,
            source_proposal=run.request.assignment.proposal,
            source=run.request.assignment.source,
            external_url=result["canonical_url"],
            title=str(values.get("title") or "نتیجه استخراج")[:200],
            description=str(values.get("description") or ""),
            city=city,
            district=district,
            neighborhood=neighborhood,
            property_type=values.get("property_type")
            if values.get("property_type") in PropertyType.values
            else "",
            area_sqm=_bounded_integer(values.get("floor_area_sqm"), 2**31 - 1),
            room_count=_bounded_integer(values.get("bedroom_count"), 32767),
            deposit_rial=_bounded_integer(values.get("deposit_rial"), 2**63 - 1),
            monthly_rent_rial=_bounded_integer(values.get("monthly_rent_rial"), 2**63 - 1),
            source_claims=result["source_claims"],
            evidence=result["evidence"],
            conflicts=result["conflicts"],
        )
        from .exclusions import candidate_exclusion

        candidate.exclusion_hold = candidate_exclusion(candidate, since=run.request.created_at)
        candidate.validation_errors = validation_errors(candidate)
        candidate.save()
        urls = values.get("image_urls", [])
        if isinstance(urls, list | tuple):
            approved_urls = [url for url in urls if isinstance(url, str)][:remaining_images]
            for order, url in enumerate(approved_urls):
                CandidateImage.objects.create(
                    candidate=candidate, original_url=url, source_order=order, position=order
                )
            remaining_images -= len(approved_urls)
    transaction.on_commit(lambda: process_run_images.delay(str(run.pk)))
    run.needs_attention = run.candidates.exclude(validation_errors={}).count()
    run.save(update_fields=("needs_attention", "errors"))


def _published_content(listing: Listing) -> tuple[object, ...]:
    """Compare published content, excluding run provenance and availability refresh timestamps."""
    return (
        tuple(getattr(listing.property, name) for name in PROPERTY_FIELDS),
        tuple(getattr(listing.terms, name) for name in TERMS_FIELDS),
        listing.description,
        listing.source_claims,
        listing.external_media_url,
        listing.direct_phone,
        listing.state,
        tuple(listing.images.values_list("external_origin__content_hash", "is_primary")),
    )


@transaction.atomic
def publish_candidate(candidate: ExternalListingCandidate) -> None:
    from .exclusions import blocking_exclusion

    if candidate.source.processing_paused or candidate.superseded:
        raise ValidationError("پردازش متوقف است یا نتیجه قدیمی است.")
    if candidate.extraction_run is not None:
        from .extraction import authorized

        if not authorized(candidate.extraction_run.request):
            raise ValidationError("مجوز این نتیجه پایان یافته است.")
    if blocking_exclusion(candidate):
        raise ValidationError("این صفحه با محدودیت فعال منبع کنار گذاشته شده است.")
    errors = validation_errors(candidate)
    if errors:
        raise ValidationError(errors)
    provenance = (
        f"Extraction Run {candidate.extraction_run_id}"
        if candidate.extraction_run_id
        else f"Source Proposal {candidate.source_proposal_id}"
    )
    # Use the same Source lock as materialization so concurrent runs compare against
    # the content they actually replace, including when this URL has no Listing yet.
    Source.objects.select_for_update().get(pk=candidate.source_id)
    previous = (
        Listing.objects
        .select_for_update(of=("self",))
        .select_related("property", "terms")
        .filter(source=candidate.source, external_url=candidate.external_url)
        .first()
    )
    before = _published_content(previous) if previous is not None else None
    listing = materialize_external_listing(
        spec=ExternalListingSpec(
            source=candidate.source,
            property_values={**property_values(candidate), "provenance_note": provenance},
            terms_values={name: getattr(candidate, name) for name in TERMS_FIELDS},
            listing_values={
                "description": candidate.description,
                "source_reference": str(candidate.id),
                "source_claims": candidate.source_claims,
                "provenance_note": provenance,
                "external_url": candidate.external_url,
                "external_media_url": "",
                "direct_phone": "",
            },
        )
    )
    candidate.listing = listing
    from .external_media import promote_candidate_images

    promote_candidate_images(candidate)
    candidate.publication_outcome = (
        PublicationOutcome.NEW
        if before is None
        else PublicationOutcome.UNCHANGED
        if before == _published_content(listing)
        else PublicationOutcome.UPDATED
    )
    candidate.save(update_fields=("listing", "publication_outcome", "updated_at"))


def publish_automatic_candidates(run: ExtractionRun) -> None:
    """Publish valid candidates inside the worker's Source-locked completion transaction."""
    from .extraction import authorized
    from .models import ExternalListingCandidateState, ProfileReviewMode, SourceAssignment
    from .publication_modes import publication_mode
    from .run_review import refresh_run_counts
    from .services import record_candidate_transition

    request = run.request
    assignment = SourceAssignment.objects.get(pk=request.assignment_id)
    mode, revision = publication_mode(assignment.approval)
    if (
        not authorized(request)
        or request.review_mode != ProfileReviewMode.AUTOMATIC
        or mode != ProfileReviewMode.AUTOMATIC
        or request.publication_revision != revision
    ):
        return
    for candidate in run.candidates.filter(
        state=ExternalListingCandidateState.PENDING,
        superseded=False,
        validation_errors={},
        exclusion_hold__isnull=True,
    ):
        publish_candidate(candidate)
        record_candidate_transition(
            candidate=candidate,
            actor=None,
            new_state=ExternalListingCandidateState.PUBLISHED,
            reason="انتشار خودکار با پروفایل تأییدشده منبع",
        )
    refresh_run_counts(run)
