from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from math import atan2, cos, radians, sin, sqrt
from typing import Any, Literal

from .models import FeatureState, Property

SCORING_VERSION = "property-match-v1"


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
        _location_signal(left, right),
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
