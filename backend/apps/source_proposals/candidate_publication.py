"""Translate retained extraction evidence into catalog-ready candidates."""

from typing import Any

from django.core.exceptions import ValidationError

from apps.catalog.models import (
    City,
    District,
    Neighborhood,
    Property,
    PropertyType,
    RentalTerms,
    property_type_requires_room_count,
)
from apps.catalog.services import ExternalListingSpec, materialize_external_listing
from apps.source_extraction.normalization import DIGIT_TRANSLATION, normalize_text

from .models import ExternalListingCandidate, ExtractionRun

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
            simulated=False,
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
        candidate.validation_errors = validation_errors(candidate)
        candidate.save()
    run.needs_attention = run.candidates.exclude(validation_errors={}).count()
    run.save(update_fields=("needs_attention",))


def publish_candidate(candidate: ExternalListingCandidate) -> None:
    errors = validation_errors(candidate)
    if errors:
        raise ValidationError(errors)
    provenance = (
        f"Extraction Run {candidate.extraction_run_id}"
        if candidate.extraction_run_id
        else f"Simulated Source Proposal {candidate.source_proposal_id}"
    )
    listing = materialize_external_listing(
        spec=ExternalListingSpec(
            source=candidate.source,
            property_values={**property_values(candidate), "provenance_note": provenance},
            terms_values={name: getattr(candidate, name) for name in TERMS_FIELDS},
            listing_values={
                "description": candidate.description,
                "source_reference": str(candidate.id),
                "source_claims": candidate.source_claims
                if not candidate.simulated
                else {"simulated": True},
                "provenance_note": provenance,
                "external_url": candidate.external_url,
                "external_media_url": "",
                "direct_phone": "",
            },
        )
    )
    candidate.listing = listing
    candidate.save(update_fields=("listing", "updated_at"))
