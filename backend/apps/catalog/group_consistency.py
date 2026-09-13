from __future__ import annotations

import hashlib
import json
import uuid
from copy import copy
from dataclasses import asdict
from itertools import combinations
from typing import Any, cast

from django.core.exceptions import ValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Q, QuerySet
from django.utils import timezone

from .matching import SCORING_VERSION, SignalClassification, compare_properties
from .models import (
    Listing,
    ListingGroupingEvent,
    Property,
    PropertyGroupConsistencyMeasurement,
    PropertyMatchDecision,
)

RELIABLE_CONTRADICTION_CONTRIBUTION = -10
LISTING_SCORING_CLAIM_FIELDS = (
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
LISTING_SCORING_CLAIM_ALIASES = {
    "floor_area_sqm": "area_sqm",
    "bedroom_count": "room_count",
}


def grouped_property_queryset() -> QuerySet[Property]:
    from django.db.models import Count

    return (
        Property.objects
        .filter(merged_into__isnull=True)
        .annotate(listing_count_value=Count("listings", distinct=True))
        .filter(listing_count_value__gt=1)
    )


def _property_component_ids(property_: Property) -> set[uuid.UUID]:
    component_ids = {property_.pk}
    frontier = {property_.pk}
    while frontier:
        children = set(
            Property.objects.filter(merged_into_id__in=frontier).values_list("pk", flat=True)
        )
        frontier = children - component_ids
        component_ids.update(frontier)
    return component_ids


def _grouping_events(property_: Property) -> QuerySet[ListingGroupingEvent]:
    component_ids = _property_component_ids(property_)
    return ListingGroupingEvent.objects.filter(
        Q(from_property_id__in=component_ids) | Q(to_property_id__in=component_ids)
    )


def group_identity_revision(property_: Property) -> str:
    listing_rows = [
        {
            "id": listing.pk,
            "state": listing.state,
            "source_id": listing.source_id,
            "source_reference": listing.source_reference,
            "source_claims": listing.source_claims,
            "updated_at": listing.updated_at,
            "images": [
                {
                    "id": image.pk,
                    "raw_content_sha256": image.raw_content_sha256,
                    "normalized_pixel_sha256": image.normalized_pixel_sha256,
                    "perceptual_dhash": image.perceptual_dhash,
                }
                for image in listing.images.all()
            ],
        }
        for listing in sorted(property_.listings.all(), key=lambda item: item.pk)
    ]
    event_rows = list(
        _grouping_events(property_)
        .order_by("created_at", "pk")
        .values(
            "id",
            "listing_id",
            "from_property_id",
            "to_property_id",
            "action",
            "decision_id",
            "created_at",
        )
    )
    payload = {
        "property_id": property_.pk,
        "facts": {
            field: getattr(property_, field)
            for field in (
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
        },
        "listings": listing_rows,
        "grouping_events": event_rows,
    }
    encoded = json.dumps(payload, cls=DjangoJSONEncoder, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _listing_origins(listings: list[Listing], current: Property) -> dict[uuid.UUID, Property]:
    first_events: dict[uuid.UUID, ListingGroupingEvent] = {}
    events = (
        ListingGroupingEvent.objects
        .filter(listing_id__in=[listing.pk for listing in listings])
        .select_related("from_property")
        .order_by("created_at", "pk")
    )
    for event in events:
        first_events.setdefault(event.listing_id, event)
    origin_ids = {event.from_property_id for event in first_events.values()}
    origins = {item.pk: item for item in Property.objects.filter(pk__in=origin_ids)}
    return {
        listing.pk: origins.get(first_events[listing.pk].from_property_id, current)
        if listing.pk in first_events
        else current
        for listing in listings
    }


def _serialized_signals(assessment: Any) -> list[dict[str, Any]]:
    return cast(
        list[dict[str, Any]],
        json.loads(
            json.dumps([asdict(signal) for signal in assessment.signals], cls=DjangoJSONEncoder)
        ),
    )


def _listing_scoring_claims(listing: Listing) -> dict[str, Any]:
    claims = dict(listing.source_claims)
    for source_name, property_name in LISTING_SCORING_CLAIM_ALIASES.items():
        if source_name in claims and property_name not in claims:
            claims[property_name] = claims[source_name]
    normalized: dict[str, Any] = {}
    for field in LISTING_SCORING_CLAIM_FIELDS:
        if field not in claims or claims[field] in (None, ""):
            continue
        model_field = cast(Any, Property._meta.get_field(field))
        candidates = claims[field] if isinstance(claims[field], list | tuple) else [claims[field]]
        converted: list[Any] = []
        for candidate in candidates:
            if candidate in (None, ""):
                continue
            try:
                value = model_field.to_python(candidate)
            except TypeError, ValueError, ValidationError:
                continue
            if model_field.choices and value not in {
                choice[0] for choice in model_field.flatchoices
            }:
                continue
            converted.append(value)
        unique_values = list(dict.fromkeys(converted))
        if len(unique_values) == 1:
            normalized[field] = unique_values[0]
    return normalized


def _listing_evidence_property(origin: Property, claims: dict[str, Any]) -> Property:
    property_view = copy(origin)
    for field, value in claims.items():
        setattr(property_view, field, value)
    return property_view


def _has_complete_image(listing: Listing) -> bool:
    return any(
        image.raw_content_sha256 and image.normalized_pixel_sha256 and image.perceptual_dhash
        for image in listing.images.all()
    )


def _shared_listing_signal_keys(
    left_claims: dict[str, Any],
    right_claims: dict[str, Any],
    left_listing: Listing,
    right_listing: Listing,
) -> set[str]:
    common = set(left_claims) & set(right_claims)
    keys = common & {"property_type", "area_sqm", "room_count"}
    if common & {"floor", "total_floors", "units_per_floor"}:
        keys.add("structure")
    if common & {"parking", "elevator", "storage", "balcony", "furnished"}:
        keys.add("features")
    if {"latitude", "longitude"}.issubset(common):
        keys.add("exact_location")
    if _has_complete_image(left_listing) and _has_complete_image(right_listing):
        keys.add("images")
    return keys


def _pair_measurement(
    left_listing: Listing,
    right_listing: Listing,
    origins: dict[uuid.UUID, Property],
) -> dict[str, Any]:
    listing_ids = sorted((str(left_listing.pk), str(right_listing.pk)))
    left_origin = origins[left_listing.pk]
    right_origin = origins[right_listing.pk]
    left_claims = _listing_scoring_claims(left_listing)
    right_claims = _listing_scoring_claims(right_listing)
    shared_signal_keys = _shared_listing_signal_keys(
        left_claims, right_claims, left_listing, right_listing
    )
    same_origin = left_origin.pk == right_origin.pk
    if same_origin and not shared_signal_keys:
        return {
            "listing_ids": listing_ids,
            "status": "missing_evidence",
            "score": None,
            "band": None,
            "signals": [],
            "contradictions": [],
            "reliable_contradictions": [],
        }
    assessment = compare_properties(
        _listing_evidence_property(left_origin, left_claims),
        _listing_evidence_property(right_origin, right_claims),
        left_listings=[left_listing],
        right_listings=[right_listing],
    )
    signals = _serialized_signals(assessment)
    if same_origin:
        signals = [signal for signal in signals if signal["key"] in shared_signal_keys]
    contradictions = [
        signal
        for signal in signals
        if signal["classification"]
        in (SignalClassification.CONTRADICTION, SignalClassification.BLOCKER)
    ]
    reliable = [
        signal
        for signal in contradictions
        if signal["classification"] == SignalClassification.BLOCKER
        or (
            signal["classification"] == SignalClassification.CONTRADICTION
            and signal["contribution"] <= RELIABLE_CONTRADICTION_CONTRIBUTION
        )
    ]
    blocked = any(signal["classification"] == SignalClassification.BLOCKER for signal in signals)
    score = 0 if blocked else max(0, min(100, sum(signal["contribution"] for signal in signals)))
    band = "likely" if score >= 80 else "possible" if score >= 60 else "below_threshold"
    return {
        "listing_ids": listing_ids,
        "status": "measured",
        "score": score if same_origin else assessment.score,
        "band": band if same_origin else assessment.band,
        "signals": signals,
        "contradictions": contradictions,
        "reliable_contradictions": reliable,
    }


@transaction.atomic
def measure_group_consistency(
    property_id: uuid.UUID,
) -> PropertyGroupConsistencyMeasurement | None:
    property_ = grouped_property_queryset().select_for_update().filter(pk=property_id).first()
    if property_ is None:
        return None
    listings = list(
        property_.listings
        .select_related("source")
        .prefetch_related("images__variants__asset")
        .order_by("pk")
    )
    origins = _listing_origins(listings, property_)
    pairs = [_pair_measurement(left, right, origins) for left, right in combinations(listings, 2)]
    measured_pairs = [pair for pair in pairs if pair["status"] == "measured"]
    explicit_contradictions = [
        {"listing_ids": pair["listing_ids"], **signal}
        for pair in measured_pairs
        for signal in pair["contradictions"]
    ]
    reliable_contradictions = [
        signal for pair in measured_pairs for signal in pair["reliable_contradictions"]
    ]
    strongest_pair = max(measured_pairs, key=lambda pair: pair["score"], default=None)
    weakest_pair = min(measured_pairs, key=lambda pair: pair["score"], default=None)
    measurement, _ = PropertyGroupConsistencyMeasurement.objects.update_or_create(
        property=property_,
        group_revision=group_identity_revision(property_),
        scoring_version=SCORING_VERSION,
        defaults={
            "listing_count": len(listings),
            "pair_measurements": pairs,
            "strongest_pair": strongest_pair,
            "weakest_pair": weakest_pair,
            "explicit_contradictions": explicit_contradictions,
            "needs_attention": bool(reliable_contradictions),
            "measured_at": timezone.now(),
        },
    )
    return measurement


def current_group_measurement(
    property_: Property,
) -> tuple[str, PropertyGroupConsistencyMeasurement | None]:
    latest = next(iter(property_.consistency_measurements.all()), None)
    if latest is None:
        return "not_measured", None
    is_current = latest.scoring_version == SCORING_VERSION and (
        latest.group_revision == group_identity_revision(property_)
    )
    if not is_current:
        return "stale", latest
    return "measured", latest


def approved_connection_graph(property_: Property) -> list[dict[str, Any]]:
    component_ids = _property_component_ids(property_)
    decisions = PropertyMatchDecision.objects.filter(
        outcome=PropertyMatchDecision.Outcome.SAME_PROPERTY,
        survivor_id__in=component_ids,
        redundant_id__in=component_ids,
    ).order_by("created_at", "pk")
    return [
        {
            "decision_id": decision.pk,
            "left_property_id": decision.redundant_id,
            "right_property_id": decision.survivor_id,
            "created_at": decision.created_at,
        }
        for decision in decisions
    ]


def grouping_history(property_: Property) -> list[dict[str, Any]]:
    events = _grouping_events(property_).select_related("decision").order_by("created_at", "pk")
    return [
        {
            "id": event.pk,
            "listing_id": event.listing_id,
            "from_property_id": event.from_property_id,
            "to_property_id": event.to_property_id,
            "action": event.action,
            "reason": event.reason,
            "decision_id": event.decision_id,
            "created_at": event.created_at,
        }
        for event in events
    ]


def indirect_only_connections(property_: Property) -> list[dict[str, Any]]:
    listings = list(property_.listings.order_by("pk"))
    origins = _listing_origins(listings, property_)
    graph = approved_connection_graph(property_)
    edges = {frozenset((row["left_property_id"], row["right_property_id"])) for row in graph}
    adjacency: dict[uuid.UUID, set[uuid.UUID]] = {}
    for edge in edges:
        left, right = tuple(edge)
        adjacency.setdefault(left, set()).add(right)
        adjacency.setdefault(right, set()).add(left)

    def connected(left: uuid.UUID, right: uuid.UUID) -> bool:
        frontier = {left}
        visited: set[uuid.UUID] = set()
        while frontier:
            if right in frontier:
                return True
            visited.update(frontier)
            frontier = {
                neighbor
                for node in frontier
                for neighbor in adjacency.get(node, set())
                if neighbor not in visited
            }
        return False

    indirect = []
    for left_listing, right_listing in combinations(listings, 2):
        left_origin = origins[left_listing.pk].pk
        right_origin = origins[right_listing.pk].pk
        edge = frozenset((left_origin, right_origin))
        is_indirect = (
            left_origin != right_origin
            and edge not in edges
            and connected(left_origin, right_origin)
        )
        if is_indirect:
            indirect.append({
                "listing_ids": sorted((left_listing.pk, right_listing.pk)),
                "property_ids": sorted((left_origin, right_origin)),
            })
    return indirect
