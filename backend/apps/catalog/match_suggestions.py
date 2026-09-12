from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import asdict
from decimal import Decimal
from typing import cast

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Q, QuerySet
from django.utils import timezone

from .matching import MatchAssessment, SignalClassification, compare_properties
from .models import (
    ListingState,
    Property,
    PropertyMatchSuggestion,
    PropertyMatchSuggestionEvaluation,
    PropertyMatchSuggestionOrigin,
    PropertyMatchSuggestionState,
)

ELIGIBLE_LISTING_STATES = tuple(
    state
    for state in ListingState.values
    if state not in (ListingState.DRAFT, ListingState.REJECTED)
)
IDENTITY_PROPERTY_FIELDS = (
    "city_id",
    "district_id",
    "neighborhood_id",
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
    "heating",
    "cooling",
    "latitude",
    "longitude",
)


def eligible_property_roots() -> QuerySet[Property]:
    return Property.objects.filter(
        merged_into__isnull=True,
        listings__state__in=ELIGIBLE_LISTING_STATES,
    ).distinct()


def _bounded_ids(queryset: QuerySet[Property], limit: int) -> list[uuid.UUID]:
    return list(queryset.order_by("pk").values_list("pk", flat=True)[:limit])


def candidate_property_ids(property_: Property, *, limit: int) -> list[uuid.UUID]:
    """Return the bounded union of indexed candidate paths for one current Property."""
    if limit < 1:
        return []
    base = eligible_property_roots().exclude(pk=property_.pk)
    candidates: set[uuid.UUID] = set()

    if property_.latitude is not None and property_.longitude is not None:
        coordinate_delta = Decimal("0.005")
        candidates.update(
            _bounded_ids(
                base.filter(
                    latitude__range=(
                        property_.latitude - coordinate_delta,
                        property_.latitude + coordinate_delta,
                    ),
                    longitude__range=(
                        property_.longitude - coordinate_delta,
                        property_.longitude + coordinate_delta,
                    ),
                ),
                limit,
            )
        )

    location_facts = Q()
    if property_.neighborhood_id is not None:
        location_facts |= Q(neighborhood_id=property_.neighborhood_id)
    if property_.city_id is not None and property_.property_type and property_.area_sqm:
        area_delta = max(5, round(property_.area_sqm * 0.15))
        location_facts |= Q(
            city_id=property_.city_id,
            property_type=property_.property_type,
            area_sqm__range=(property_.area_sqm - area_delta, property_.area_sqm + area_delta),
        )
    if location_facts:
        candidates.update(_bounded_ids(base.filter(location_facts), limit))

    images = property_.listings.filter(state__in=ELIGIBLE_LISTING_STATES).values_list(
        "images__raw_content_sha256",
        "images__normalized_pixel_sha256",
        "images__perceptual_dhash",
    )
    raw_hashes: set[str] = set()
    normalized_hashes: set[str] = set()
    perceptual_hashes: set[str] = set()
    for raw_hash, normalized_hash, perceptual_hash in images:
        if raw_hash:
            raw_hashes.add(raw_hash)
        if normalized_hash:
            normalized_hashes.add(normalized_hash)
        if perceptual_hash:
            perceptual_hashes.add(perceptual_hash)
    image_query = Q()
    if raw_hashes:
        image_query |= Q(listings__images__raw_content_sha256__in=raw_hashes)
    if normalized_hashes:
        image_query |= Q(listings__images__normalized_pixel_sha256__in=normalized_hashes)
    if perceptual_hashes:
        image_query |= Q(listings__images__perceptual_dhash__in=perceptual_hashes)
        for perceptual_hash in perceptual_hashes:
            image_query |= Q(listings__images__perceptual_dhash__startswith=perceptual_hash[:4])
    if image_query:
        candidates.update(_bounded_ids(base.filter(image_query).distinct(), limit))

    building_query = Q()
    if property_.total_floors is not None and property_.units_per_floor is not None:
        building_query |= Q(
            total_floors=property_.total_floors,
            units_per_floor=property_.units_per_floor,
        )
    if property_.floor is not None and property_.construction_year is not None:
        building_query |= Q(
            floor=property_.floor,
            construction_year=property_.construction_year,
        )
    if building_query:
        candidates.update(_bounded_ids(base.filter(building_query), limit))

    return sorted(candidates)[:limit]


def property_identity_revision(property_: Property) -> str:
    listings = []
    for listing in property_.listings.filter(state__in=ELIGIBLE_LISTING_STATES).order_by("pk"):
        listings.append({
            "id": listing.pk,
            "source_id": listing.source_id,
            "source_reference": listing.source_reference,
            "source_claims": listing.source_claims,
            "images": list(
                listing.images.order_by("pk").values(
                    "raw_content_sha256",
                    "normalized_pixel_sha256",
                    "perceptual_dhash",
                )
            ),
        })
    payload = {
        "property_id": property_.pk,
        "facts": {field: getattr(property_, field) for field in IDENTITY_PROPERTY_FIELDS},
        "listings": listings,
    }
    encoded = json.dumps(payload, cls=DjangoJSONEncoder, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _assessment_evidence(assessment: MatchAssessment) -> list[dict[str, object]]:
    serialized = json.loads(
        json.dumps([asdict(signal) for signal in assessment.signals], cls=DjangoJSONEncoder)
    )
    return cast(list[dict[str, object]], serialized)


@transaction.atomic
def evaluate_property_pair(
    left_id: uuid.UUID,
    right_id: uuid.UUID,
    *,
    origin: str,
) -> PropertyMatchSuggestion | None:
    ordered_ids = sorted((left_id, right_id))
    properties = list(
        eligible_property_roots().select_for_update().filter(pk__in=ordered_ids).order_by("pk")
    )
    if len(properties) != 2:
        return None
    left, right = properties
    assessment = compare_properties(left, right)
    left_revision = property_identity_revision(left)
    right_revision = property_identity_revision(right)
    evidence_fingerprint = hashlib.sha256(f"{left_revision}:{right_revision}".encode()).hexdigest()
    evidence = _assessment_evidence(assessment)
    blocked = any(
        signal.classification == SignalClassification.BLOCKER for signal in assessment.signals
    )
    active = assessment.band != "below_threshold" and not blocked
    now = timezone.now()
    suggestion = (
        PropertyMatchSuggestion.objects.select_for_update().filter(left=left, right=right).first()
    )
    if suggestion is None and not active:
        return None
    values = {
        "state": (
            PropertyMatchSuggestionState.PENDING
            if active
            else PropertyMatchSuggestionState.SUPERSEDED
        ),
        "score": assessment.score,
        "band": assessment.band,
        "scoring_version": assessment.scoring_version,
        "evidence_fingerprint": evidence_fingerprint,
        "left_revision": left_revision,
        "right_revision": right_revision,
        "evidence": evidence,
        "origin": origin,
        "last_evaluated_at": now,
    }
    if suggestion is None:
        suggestion = PropertyMatchSuggestion.objects.create(
            left=left,
            right=right,
            first_suggested_at=now,
            **values,
        )
    else:
        for field, value in values.items():
            setattr(suggestion, field, value)
        suggestion.save(update_fields=(*values, "updated_at"))
    PropertyMatchSuggestionEvaluation.objects.create(
        suggestion=suggestion,
        score=assessment.score,
        band=assessment.band,
        scoring_version=assessment.scoring_version,
        evidence_fingerprint=evidence_fingerprint,
        left_revision=left_revision,
        right_revision=right_revision,
        evidence=evidence,
        origin=origin,
    )
    return suggestion


def measure_candidates_for_property(
    property_id: uuid.UUID,
    *,
    limit: int,
    origin: str = PropertyMatchSuggestionOrigin.FOCUSED,
) -> dict[str, int]:
    property_ = eligible_property_roots().filter(pk=property_id).first()
    if property_ is None:
        return {"evaluated": 0, "active": 0}
    candidates = candidate_property_ids(property_, limit=limit)
    active = sum(
        evaluate_property_pair(property_.pk, candidate_id, origin=origin) is not None
        for candidate_id in candidates
    )
    return {"evaluated": len(candidates), "active": active}
