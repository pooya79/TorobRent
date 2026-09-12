from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from math import atan2, cos, radians, sin, sqrt
from typing import Any, Literal

from apps.common.media import perceptual_hash_distance

from .models import FeatureState, ListingImage, ListingState, Property

SCORING_VERSION = "property-match-v2"
MAX_PERCEPTUAL_DISTANCE = 10


class SignalClassification(StrEnum):
    SUPPORT = "support"
    CONTRADICTION = "contradiction"
    NEUTRAL = "neutral"
    BLOCKER = "blocker"


@dataclass(frozen=True)
class MatchSignal:
    key: str
    label: str
    compared_values: dict[str, Any]
    classification: SignalClassification
    contribution: int


@dataclass(frozen=True)
class MatchAssessment:
    scoring_version: str
    score: int
    band: Literal["likely", "possible", "below_threshold"]
    is_calibrated_probability: bool
    signals: tuple[MatchSignal, ...]


def _signal(
    key: str,
    label: str,
    left: Any,
    right: Any,
    classification: SignalClassification,
    contribution: int,
) -> MatchSignal:
    return MatchSignal(
        key=key,
        label=label,
        compared_values={"left": left, "right": right},
        classification=classification,
        contribution=contribution,
    )


def _equality_signal(
    *,
    key: str,
    label: str,
    left: Any,
    right: Any,
    support: int,
    contradiction: int,
) -> MatchSignal:
    if left in (None, "") or right in (None, ""):
        return _signal(key, label, left, right, SignalClassification.NEUTRAL, 0)
    if left == right:
        return _signal(key, label, left, right, SignalClassification.SUPPORT, support)
    return _signal(key, label, left, right, SignalClassification.CONTRADICTION, contradiction)


def _distance_meters(left: Property, right: Property) -> int | None:
    if None in (left.latitude, left.longitude, right.latitude, right.longitude):
        return None
    assert left.latitude is not None
    assert left.longitude is not None
    assert right.latitude is not None
    assert right.longitude is not None
    left_lat = radians(float(left.latitude))
    right_lat = radians(float(right.latitude))
    latitude_delta = right_lat - left_lat
    longitude_delta = radians(float(right.longitude - left.longitude))
    haversine = sin(latitude_delta / 2) ** 2 + (
        cos(left_lat) * cos(right_lat) * sin(longitude_delta / 2) ** 2
    )
    return round(6_371_000 * 2 * atan2(sqrt(haversine), sqrt(1 - haversine)))


def _location_signal(left: Property, right: Property) -> MatchSignal:
    distance = _distance_meters(left, right)
    values = {
        "left": (
            {"latitude": str(left.latitude), "longitude": str(left.longitude)}
            if left.latitude is not None and left.longitude is not None
            else None
        ),
        "right": (
            {"latitude": str(right.latitude), "longitude": str(right.longitude)}
            if right.latitude is not None and right.longitude is not None
            else None
        ),
        "distance_meters": distance,
    }
    if distance is None:
        classification, contribution = SignalClassification.NEUTRAL, 0
    elif distance <= 100:
        classification, contribution = SignalClassification.SUPPORT, 35
    elif distance >= 500:
        classification, contribution = SignalClassification.BLOCKER, 0
    else:
        classification, contribution = SignalClassification.CONTRADICTION, -20
    return MatchSignal(
        key="exact_location",
        label="فاصله مکان دقیق",
        compared_values=values,
        classification=classification,
        contribution=contribution,
    )


def _area_signal(left: Property, right: Property) -> MatchSignal:
    if left.area_sqm is None or right.area_sqm is None:
        return _signal(
            "area_sqm",
            "متراژ",
            left.area_sqm,
            right.area_sqm,
            SignalClassification.NEUTRAL,
            0,
        )
    difference = abs(left.area_sqm - right.area_sqm) / max(left.area_sqm, right.area_sqm)
    if difference <= Decimal("0.05"):
        classification, contribution = SignalClassification.SUPPORT, 15
    elif difference <= Decimal("0.15"):
        classification, contribution = SignalClassification.SUPPORT, 5
    else:
        classification, contribution = SignalClassification.CONTRADICTION, -15
    return _signal("area_sqm", "متراژ", left.area_sqm, right.area_sqm, classification, contribution)


def _structure_signal(left: Property, right: Property) -> MatchSignal:
    left_value = {
        "floor": left.floor,
        "total_floors": left.total_floors,
        "units_per_floor": left.units_per_floor,
    }
    right_value = {
        "floor": right.floor,
        "total_floors": right.total_floors,
        "units_per_floor": right.units_per_floor,
    }
    known = [
        (left_value[key], right_value[key])
        for key in left_value
        if left_value[key] is not None and right_value[key] is not None
    ]
    if not known:
        classification, contribution = SignalClassification.NEUTRAL, 0
    elif all(left_part == right_part for left_part, right_part in known):
        classification, contribution = SignalClassification.SUPPORT, 10
    else:
        classification, contribution = SignalClassification.CONTRADICTION, -10
    return _signal(
        "structure", "ساختار ساختمان", left_value, right_value, classification, contribution
    )


def _features_signal(left: Property, right: Property) -> MatchSignal:
    feature_names = ("parking", "elevator", "storage", "balcony", "furnished")
    pairs = [(getattr(left, name), getattr(right, name)) for name in feature_names]
    known = [pair for pair in pairs if FeatureState.UNKNOWN not in pair]
    if not known:
        classification, contribution = SignalClassification.NEUTRAL, 0
    elif any(left_value != right_value for left_value, right_value in known):
        classification, contribution = SignalClassification.CONTRADICTION, -5
    else:
        classification, contribution = SignalClassification.SUPPORT, 5
    return _signal(
        "features",
        "امکانات",
        {name: getattr(left, name) for name in feature_names},
        {name: getattr(right, name) for name in feature_names},
        classification,
        contribution,
    )


def _image_reference(image: ListingImage) -> dict[str, Any]:
    variants = list(image.variants.all())
    thumbnail = min(
        variants,
        key=lambda variant: (variant.asset.width, variant.asset.height, variant.kind),
        default=None,
    )
    return {
        "image_id": str(image.id),
        "listing_id": str(image.listing_id),
        "source": image.listing.source.display_name,
        "thumbnail_url": (
            f"/api/v1/catalog/media/{thumbnail.asset_id}/" if thumbnail is not None else None
        ),
    }


def _property_listing_images(property_: Property) -> list[ListingImage]:
    return [
        image
        for listing in property_.listings.all()
        if listing.state not in (ListingState.DRAFT, ListingState.REJECTED)
        for image in listing.images.all()
        if image.raw_content_sha256 and image.normalized_pixel_sha256 and image.perceptual_dhash
    ]


def _candidate_image_match(
    left: ListingImage, right: ListingImage
) -> tuple[int, str, int | None] | None:
    if left.raw_content_sha256 == right.raw_content_sha256:
        return 0, "sha256", None
    if left.normalized_pixel_sha256 == right.normalized_pixel_sha256:
        return 1, "normalized_pixels", None
    distance = perceptual_hash_distance(left.perceptual_dhash, right.perceptual_dhash)
    if distance <= MAX_PERCEPTUAL_DISTANCE:
        return 2, "dhash", distance
    return None


def _catalog_repeated_dhashes(
    left: Property,
    right: Property,
    images: list[ListingImage],
) -> set[str]:
    hashes = {image.perceptual_dhash for image in images}
    if not hashes:
        return set()
    return set(
        ListingImage.objects
        .filter(
            perceptual_dhash__in=hashes,
            listing__property__merged_into__isnull=True,
        )
        .exclude(listing__state__in=(ListingState.DRAFT, ListingState.REJECTED))
        .exclude(listing__property_id__in=(left.id, right.id))
        .values_list("perceptual_dhash", flat=True)
    )


def _is_generic_image(image: ListingImage, *, repeated_dhashes: set[str]) -> bool:
    return image.perceptual_dhash in {"0" * 16, "f" * 16} | repeated_dhashes


def _image_signal(
    left: Property, right: Property, *, independently_corroborated: bool
) -> MatchSignal:
    left_images = _property_listing_images(left)
    right_images = _property_listing_images(right)
    repeated_dhashes = _catalog_repeated_dhashes(left, right, left_images + right_images)
    values: dict[str, Any] = {"matched_pairs": [], "contradictions": []}
    if not left_images or not right_images:
        return MatchSignal(
            key="images",
            label="تصاویر آگهی",
            compared_values=values,
            classification=SignalClassification.NEUTRAL,
            contribution=0,
        )

    candidates = []
    for left_image in left_images:
        for right_image in right_images:
            match = _candidate_image_match(left_image, right_image)
            if match is not None:
                rank, method, distance = match
                candidates.append((
                    rank,
                    distance or 0,
                    str(left_image.id),
                    str(right_image.id),
                    method,
                    distance,
                ))
    candidates.sort()
    left_by_id = {str(image.id): image for image in left_images}
    right_by_id = {str(image.id): image for image in right_images}
    used_left: set[str] = set()
    used_right: set[str] = set()
    independent_evidence_keys: set[str] = set()
    for _rank, _distance_order, left_id, right_id, method, distance in candidates:
        if left_id in used_left or right_id in used_right:
            continue
        left_image = left_by_id[left_id]
        right_image = right_by_id[right_id]
        used_left.add(left_id)
        used_right.add(right_id)
        is_generic = _is_generic_image(
            left_image, repeated_dhashes=repeated_dhashes
        ) or _is_generic_image(right_image, repeated_dhashes=repeated_dhashes)
        if not is_generic:
            independent_evidence_keys.add(left_image.perceptual_dhash)
        values["matched_pairs"].append({
            "left": _image_reference(left_image),
            "right": _image_reference(right_image),
            "method": method,
            "perceptual_distance": distance,
            "is_generic": is_generic,
        })

    unmatched_left = [image for image in left_images if str(image.id) not in used_left]
    unmatched_right = [image for image in right_images if str(image.id) not in used_right]
    contradiction_candidates = sorted(
        (
            perceptual_hash_distance(
                left_image.perceptual_dhash,
                right_image.perceptual_dhash,
            ),
            str(left_image.id),
            str(right_image.id),
        )
        for left_image in unmatched_left
        for right_image in unmatched_right
    )
    contradicted_left: set[str] = set()
    contradicted_right: set[str] = set()
    for distance, left_id, right_id in contradiction_candidates:
        if left_id in contradicted_left or right_id in contradicted_right:
            continue
        contradicted_left.add(left_id)
        contradicted_right.add(right_id)
        values["contradictions"].append({
            "left": _image_reference(left_by_id[left_id]),
            "right": _image_reference(right_by_id[right_id]),
            "perceptual_distance": distance,
        })

    if values["matched_pairs"]:
        decisive = len(independent_evidence_keys) >= 2 or (
            independently_corroborated and bool(independent_evidence_keys)
        )
        contribution = 30 if decisive else 10
        contribution -= min(15, len(values["contradictions"]) * 5)
        return MatchSignal(
            key="images",
            label="تصاویر آگهی",
            compared_values=values,
            classification=SignalClassification.SUPPORT,
            contribution=max(5, contribution),
        )
    return MatchSignal(
        key="images",
        label="تصاویر آگهی",
        compared_values=values,
        classification=SignalClassification.CONTRADICTION,
        contribution=-15,
    )


def compare_properties(left: Property, right: Property) -> MatchAssessment:
    city_signal = _equality_signal(
        key="city",
        label="شهر",
        left=str(left.city_id) if left.city_id else None,
        right=str(right.city_id) if right.city_id else None,
        support=15,
        contradiction=0,
    )
    if left.city_id and right.city_id and left.city_id != right.city_id:
        city_signal = _signal(
            "city",
            "شهر",
            str(left.city_id),
            str(right.city_id),
            SignalClassification.BLOCKER,
            0,
        )
    location_signal = _location_signal(left, right)
    signals = (
        city_signal,
        _equality_signal(
            key="neighborhood",
            label="محله",
            left=str(left.neighborhood_id) if left.neighborhood_id else None,
            right=str(right.neighborhood_id) if right.neighborhood_id else None,
            support=10,
            contradiction=-10,
        ),
        location_signal,
        _equality_signal(
            key="property_type",
            label="نوع ملک",
            left=left.property_type,
            right=right.property_type,
            support=15,
            contradiction=-15,
        ),
        _area_signal(left, right),
        _equality_signal(
            key="room_count",
            label="تعداد خواب",
            left=left.room_count,
            right=right.room_count,
            support=10,
            contradiction=-10,
        ),
        _structure_signal(left, right),
        _features_signal(left, right),
        _image_signal(
            left,
            right,
            independently_corroborated=(
                location_signal.classification == SignalClassification.SUPPORT
            ),
        ),
    )
    blocked = any(signal.classification == SignalClassification.BLOCKER for signal in signals)
    score = 0 if blocked else max(0, min(100, sum(signal.contribution for signal in signals)))
    band: Literal["likely", "possible", "below_threshold"] = (
        "likely" if score >= 80 else "possible" if score >= 60 else "below_threshold"
    )
    return MatchAssessment(
        scoring_version=SCORING_VERSION,
        score=score,
        band=band,
        is_calibrated_probability=False,
        signals=signals,
    )
