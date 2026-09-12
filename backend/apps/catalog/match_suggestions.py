from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import asdict
from decimal import Decimal
from typing import cast

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Count, IntegerField, OuterRef, Q, QuerySet, Subquery
from django.utils import timezone

from .matching import MatchAssessment, SignalClassification, compare_properties
from .models import (
    ListingImage,
    ListingState,
    Property,
    PropertyMatchClaim,
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
IDENTITY_PROPERTY_FIELD_NAMES = (
    "city",
    "district",
    "neighborhood",
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
IDENTITY_PROPERTY_FIELDS = tuple(
    f"{field}_id" if field in {"city", "district", "neighborhood"} else field
    for field in IDENTITY_PROPERTY_FIELD_NAMES
)
IDENTITY_SOURCE_CLAIM_FIELDS = (
    *IDENTITY_PROPERTY_FIELD_NAMES,
    "floor_area_sqm",
    "bedroom_count",
    "address",
    "source_location_text",
)


def eligible_property_roots() -> QuerySet[Property]:
    return Property.objects.filter(
        merged_into__isnull=True,
        listings__state__in=ELIGIBLE_LISTING_STATES,
    ).distinct()


def _bounded_ids(queryset: QuerySet[Property], limit: int) -> list[uuid.UUID]:
    return list(queryset.order_by("pk").values_list("pk", flat=True)[:limit])


def _fair_bounded_union(paths: list[list[uuid.UUID]], limit: int) -> list[uuid.UUID]:
    """Take candidates round-robin so no populated evidence path can crowd out another."""
    result: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for offset in range(limit):
        for path in paths:
            if offset >= len(path) or path[offset] in seen:
                continue
            seen.add(path[offset])
            result.append(path[offset])
            if len(result) == limit:
                return result
    return result


def candidate_property_ids(property_: Property, *, limit: int) -> list[uuid.UUID]:
    """Return the bounded union of indexed candidate paths for one current Property."""
    if limit < 1:
        return []
    base = eligible_property_roots().exclude(pk=property_.pk)
    paths: list[list[uuid.UUID]] = []

    if property_.latitude is not None and property_.longitude is not None:
        coordinate_delta = Decimal("0.005")
        paths.append(
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
        paths.append(_bounded_ids(base.filter(location_facts), limit))

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
    exact_image_query = Q()
    if raw_hashes:
        exact_image_query |= Q(listings__images__raw_content_sha256__in=raw_hashes)
    if normalized_hashes:
        exact_image_query |= Q(listings__images__normalized_pixel_sha256__in=normalized_hashes)
    perceptual_bucket_query = Q()
    if perceptual_hashes:
        exact_image_query |= Q(listings__images__perceptual_dhash__in=perceptual_hashes)
        bucket_pairs = property_.listings.filter(state__in=ELIGIBLE_LISTING_STATES).values_list(
            "images__perceptual_buckets__position",
            "images__perceptual_buckets__value",
        )
        for position, value in bucket_pairs:
            if position is not None and value:
                perceptual_bucket_query |= Q(
                    perceptual_buckets__position=position,
                    perceptual_buckets__value=value,
                )
    image_ids: list[uuid.UUID] = []
    if exact_image_query:
        eligible_exact_image_query = (
            Q(listings__state__in=ELIGIBLE_LISTING_STATES) & exact_image_query
        )
        image_ids.extend(_bounded_ids(base.filter(eligible_exact_image_query).distinct(), limit))
    if perceptual_bucket_query and len(image_ids) < limit:
        matching_image_score = (
            ListingImage.objects
            .filter(
                listing__property_id=OuterRef("pk"),
                listing__state__in=ELIGIBLE_LISTING_STATES,
            )
            .annotate(
                shared_bucket_count=Count(
                    "perceptual_buckets",
                    filter=perceptual_bucket_query,
                    distinct=True,
                )
            )
            .filter(shared_bucket_count__gte=6)
            .order_by("-shared_bucket_count", "pk")
            .values("shared_bucket_count")[:1]
        )
        perceptual_ids = list(
            base
            .annotate(
                perceptual_bucket_score=Subquery(
                    matching_image_score,
                    output_field=IntegerField(),
                )
            )
            .filter(perceptual_bucket_score__isnull=False)
            .order_by("-perceptual_bucket_score", "pk")
            .values_list("pk", flat=True)[:limit]
        )
        image_ids.extend(
            candidate_id for candidate_id in perceptual_ids if candidate_id not in image_ids
        )
    if image_ids:
        # Image evidence is the most selective path, so it gets the first round-robin slot.
        paths.insert(0, image_ids[:limit])

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
        paths.append(_bounded_ids(base.filter(building_query), limit))

    return _fair_bounded_union(paths, limit)


def property_identity_revision(property_: Property) -> str:
    listings = []
    for listing in property_.listings.filter(state__in=ELIGIBLE_LISTING_STATES).order_by("pk"):
        listings.append({
            "id": listing.pk,
            "source_id": listing.source_id,
            "source_reference": listing.source_reference,
            "source_claims": {
                field: listing.source_claims[field]
                for field in IDENTITY_SOURCE_CLAIM_FIELDS
                if field in listing.source_claims
            },
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
    # Lock plain parent rows before applying the DISTINCT eligibility query; PostgreSQL
    # cannot combine SELECT FOR UPDATE with DISTINCT.
    list(Property.objects.select_for_update().filter(pk__in=ordered_ids).order_by("pk"))
    properties = list(eligible_property_roots().filter(pk__in=ordered_ids).order_by("pk"))
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
            state=(
                PropertyMatchSuggestionState.PENDING
                if active
                else PropertyMatchSuggestionState.SUPERSEDED
            ),
            **values,
        )
    else:
        previous_fingerprint = suggestion.evidence_fingerprint
        material_evidence_changed = previous_fingerprint != evidence_fingerprint
        review_evidence_changed = material_evidence_changed or any((
            suggestion.score != assessment.score,
            suggestion.band != assessment.band,
            suggestion.scoring_version != assessment.scoring_version,
            suggestion.evidence != evidence,
        ))
        if (
            suggestion.state == PropertyMatchSuggestionState.REJECTED
            and suggestion.suppressed_evidence_fingerprint == evidence_fingerprint
        ):
            suggestion.state = PropertyMatchSuggestionState.REJECTED
        elif (
            suggestion.state == PropertyMatchSuggestionState.SNOOZED
            and suggestion.suppressed_evidence_fingerprint == evidence_fingerprint
            and suggestion.snoozed_until is not None
            and suggestion.snoozed_until > now
        ):
            suggestion.state = PropertyMatchSuggestionState.SNOOZED
        elif active:
            suggestion.state = PropertyMatchSuggestionState.PENDING
            suggestion.suppressed_evidence_fingerprint = ""
            suggestion.snoozed_until = None
        else:
            suggestion.state = PropertyMatchSuggestionState.SUPERSEDED
            suggestion.suppressed_evidence_fingerprint = ""
            suggestion.snoozed_until = None
        if review_evidence_changed:
            PropertyMatchClaim.objects.filter(
                left=left,
                right=right,
                expires_at__gt=now,
            ).update(expires_at=now)
        for field, value in values.items():
            setattr(suggestion, field, value)
        suggestion.save(
            update_fields=(
                "state",
                "suppressed_evidence_fingerprint",
                "snoozed_until",
                *values,
                "updated_at",
            )
        )
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
    tracked_neighbors = (
        PropertyMatchSuggestion.objects
        .filter(
            Q(left_id=property_.pk) | Q(right_id=property_.pk),
            state__in=(
                PropertyMatchSuggestionState.PENDING,
                PropertyMatchSuggestionState.REJECTED,
                PropertyMatchSuggestionState.SNOOZED,
            ),
        )
        .order_by("last_evaluated_at", "pk")
        .values_list("left_id", "right_id")[:limit]
    )
    candidate_ids = [
        right_id if left_id == property_.pk else left_id for left_id, right_id in tracked_neighbors
    ]
    candidate_ids.extend(
        candidate_id
        for candidate_id in candidate_property_ids(property_, limit=limit)
        if candidate_id not in candidate_ids
    )
    evaluations = [
        evaluate_property_pair(property_.pk, candidate_id, origin=origin)
        for candidate_id in candidate_ids
    ]
    active_count = sum(
        suggestion is not None and suggestion.state == PropertyMatchSuggestionState.PENDING
        for suggestion in evaluations
    )
    return {"evaluated": len(candidate_ids), "active": active_count}
