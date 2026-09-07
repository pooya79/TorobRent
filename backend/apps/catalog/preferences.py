"""Versioned, explicit preference fit; unknown facts contribute evidence, never a zero."""

import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, cast

from .models import PropertyType

SCORING_VERSION = "explicit-v1"
PRIORITY_WEIGHTS = {"very_important": 3, "preferred": 1, "unimportant": 0}
FEATURES = ("parking", "elevator", "storage", "balcony", "furnished")
NUMERIC_BOUNDS = {
    "area": (1, 100000),
    "bedroom_count": (0, 100),
    "monthly_rent": (0, 10**12),
    "deposit": (0, 10**12),
    "construction_year": (1200, 1500),
    "freshness": (1, 365),
}
PREFERENCE_IDS = ("property_type", "district", "neighborhood", *NUMERIC_BOUNDS, *FEATURES)


@dataclass(frozen=True)
class Preference:
    identifier: str
    priority: str
    target: str | int | tuple[str, ...]


def parse_preferences(raw: str) -> tuple[tuple[Preference, ...], tuple[str, ...]]:
    if not raw:
        return (), ()
    if len(raw) > 4096:
        return (), ("preferences",)
    try:
        data = json.loads(raw)
    except ValueError, TypeError, RecursionError:
        return (), ("preferences",)
    if not isinstance(data, dict):
        return (), ("preferences",)
    preferences = []
    invalid = ["preferences"] if any(key not in PREFERENCE_IDS for key in data) else []
    for identifier in PREFERENCE_IDS:
        if identifier not in data:
            continue
        value = data[identifier]
        if (
            not isinstance(value, dict)
            or not isinstance(value.get("priority"), str)
            or value["priority"] not in PRIORITY_WEIGHTS
        ):
            invalid.append(identifier)
            continue
        target = value.get("target")
        valid = False
        if identifier in NUMERIC_BOUNDS:
            low, high = NUMERIC_BOUNDS[identifier]
            valid = type(target) is int and low <= target <= high
        elif identifier in FEATURES:
            valid = target in ("present", "absent")
        elif identifier == "property_type":
            valid = target in PropertyType.values
        elif identifier in ("district", "neighborhood"):
            targets = [target] if isinstance(target, str) else target
            if isinstance(targets, list) and 1 <= len(targets) <= 22:
                try:
                    target = tuple(
                        sorted({str(uuid.UUID(item)) for item in targets if isinstance(item, str)})
                    )
                    valid = len(target) == len(set(targets))
                except ValueError, TypeError:
                    pass
        if not valid:
            invalid.append(identifier)
        else:
            preferences.append(
                Preference(identifier, value["priority"], cast(str | int | tuple[str, ...], target))
            )
    return tuple(preferences), tuple(invalid)


def assess_preferences(
    facts: dict[str, Any],
    preferences: tuple[Preference, ...],
    *,
    as_of: datetime,
) -> tuple[Decimal, dict[str, Any]]:
    weighted_fit = Decimal(0)
    denominator = 0
    satisfied: list[str] = []
    trade_offs: list[tuple[Decimal, str]] = []
    unknown: list[str] = []
    for preference in preferences:
        weight = PRIORITY_WEIGHTS[preference.priority]
        if not weight:
            continue
        identifier, target = preference.identifier, preference.target
        actual = facts.get(identifier)
        if actual is None or actual == "unknown":
            unknown.append(identifier)
            continue
        if identifier == "freshness":
            actual = max(0, (as_of.date() - actual.date()).days)
        if identifier in ("monthly_rent", "deposit", "freshness"):
            fit = (
                Decimal(1)
                if actual <= target
                else Decimal(int(cast(int, target)) + 1) / Decimal(actual + 1)
            )
        elif identifier in ("area", "bedroom_count"):
            fit = max(
                Decimal(0),
                1 - Decimal(abs(actual - int(cast(int, target)))) / max(int(cast(int, target)), 1),
            )
        elif identifier == "construction_year":
            fit = max(Decimal(0), 1 - Decimal(max(0, int(cast(int, target)) - actual)) / 30)
        elif isinstance(target, tuple):
            fit = Decimal(str(actual) in target)
        else:
            fit = Decimal(str(actual) == str(target))
        weighted_fit += weight * fit
        denominator += weight
        if fit >= Decimal("0.8"):
            satisfied.append(identifier)
        else:
            trade_offs.append((weight * (1 - fit), identifier))
    score = weighted_fit / denominator if denominator else Decimal("0.5")
    band = (
        None
        if not denominator
        else "high"
        if score >= Decimal("0.8")
        else "reasonable"
        if score >= Decimal("0.5")
        else "weak"
    )
    return score, {
        "version": SCORING_VERSION,
        "band": band,
        "satisfied": satisfied,
        "trade_offs": [
            identifier for _, identifier in sorted(trade_offs, key=lambda row: (-row[0], row[1]))
        ],
        "unknown": unknown,
        "selected_listing_id": str(facts["listing_id"]),
    }
