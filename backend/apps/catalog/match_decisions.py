"""Manual Property match review and its optimistic evidence boundary."""

import hashlib
import json
from dataclasses import asdict
from datetime import timedelta
from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Field, Q
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User

from .locations import derive_public_location
from .matching import compare_properties
from .models import (
    Listing,
    ListingGroupingAction,
    ListingGroupingEvent,
    ListingImage,
    ListingImageVariant,
    Property,
    PropertyImage,
    PropertyImageVariant,
    PropertyMatchClaim,
    PropertyMatchDecision,
    PropertyMatchSuggestion,
    PropertyMatchSuggestionEvaluation,
    PropertyMatchSuggestionState,
    RentalTerms,
)
from .operator_serializers import property_evidence_data
from .selectors import current_properties_for_curation
from .services import merge_properties

CLAIM_LIFETIME = timedelta(minutes=10)


class ReviewConflict(APIException):
    status_code = 409
    default_detail = "شواهد یا مسئول بررسی تغییر کرده است؛ مقایسه را تازه کنید."


def _authorize(actor: User) -> None:
    # Re-read permissions rather than trusting a request's cached capability set.
    if not has_capability(User.objects.get(pk=actor.pk), OperatorCapability.CURATE_CATALOG):
        raise PermissionDenied("مجوز ساماندهی کاتالوگ لازم است.")


def _properties(ids: list[UUID], *, lock: bool = False) -> list[Property]:
    if len(ids) != 2 or len(set(ids)) != 2:
        raise ValidationError("دقیقاً دو ملک متفاوت انتخاب کنید.")
    from .services import current_property_id

    ids = [current_property_id(property_id) for property_id in ids]
    if len(set(ids)) != 2:
        raise ReviewConflict()
    if lock:
        # Pair order from the client never determines database lock order.
        list(Property.objects.select_for_update().filter(pk__in=ids).order_by("pk"))
    found = {item.pk: item for item in current_properties_for_curation().filter(pk__in=ids)}
    if len(found) != 2:
        raise ReviewConflict()
    return [found[pk] for pk in ids]


def _approval_properties(ids: list[UUID]) -> list[Property]:
    """Lock the reviewed roots and every root joined by an adjacent suggestion in UUID order."""
    selected = _properties(ids)
    selected_ids = {property_.pk for property_ in selected}
    adjacent_endpoint_ids = _adjacent_suggestion_endpoint_ids(selected_ids)
    from .services import current_property_id

    lock_ids = selected_ids | {
        current_property_id(property_id) for property_id in adjacent_endpoint_ids
    }
    list(Property.objects.select_for_update().filter(pk__in=lock_ids).order_by("pk"))
    confirmed = _properties(ids)
    if {property_.pk for property_ in confirmed} != selected_ids:
        raise ReviewConflict()
    current_adjacent_roots = {
        current_property_id(property_id)
        for property_id in _adjacent_suggestion_endpoint_ids(selected_ids)
    }
    if not current_adjacent_roots.issubset(lock_ids):
        raise ReviewConflict()
    return confirmed


def _adjacent_suggestion_endpoint_ids(property_ids: set[UUID]) -> set[UUID]:
    suggestions = PropertyMatchSuggestion.objects.filter(
        Q(left_id__in=property_ids) | Q(right_id__in=property_ids)
    )
    return set(suggestions.values_list("left_id", flat=True)) | set(
        suggestions.values_list("right_id", flat=True)
    )


def _lock_evidence(ids: list[UUID]) -> None:
    # Parent rows precede their media, so inserts cannot slip into an approved snapshot.
    listings = Listing.objects.filter(property_id__in=ids)
    list(listings.select_for_update().order_by("pk"))
    list(RentalTerms.objects.select_for_update().filter(listing__in=listings).order_by("pk"))
    list(PropertyImage.objects.select_for_update().filter(property_id__in=ids).order_by("pk"))
    list(ListingImage.objects.select_for_update().filter(listing__in=listings).order_by("pk"))
    list(
        PropertyImageVariant.objects
        .select_for_update()
        .filter(image__property_id__in=ids)
        .order_by("pk")
    )
    list(
        ListingImageVariant.objects
        .select_for_update()
        .filter(image__listing__in=listings)
        .order_by("pk")
    )


def _snapshot(properties: list[Property]) -> dict[str, Any]:
    ids = [item.pk for item in properties]
    refreshed = {item.pk: item for item in Property.objects.filter(pk__in=ids)}
    properties = [refreshed[pk] for pk in ids]
    listings = Listing.objects.filter(property_id__in=ids).order_by("pk")
    payload = {
        "properties": list(Property.objects.filter(pk__in=ids).order_by("pk").values()),
        "listings": list(listings.values()),
        "terms": list(RentalTerms.objects.filter(listing__in=listings).order_by("pk").values()),
        "property_images": list(
            PropertyImage.objects.filter(property_id__in=ids).order_by("pk").values()
        ),
        "property_variants": list(
            PropertyImageVariant.objects.filter(image__property_id__in=ids).order_by("pk").values()
        ),
        "listing_images": list(
            ListingImage.objects.filter(listing__in=listings).order_by("pk").values()
        ),
        "listing_variants": list(
            ListingImageVariant.objects.filter(image__listing__in=listings).order_by("pk").values()
        ),
        "grouping_events": list(
            ListingGroupingEvent.objects
            .filter(Q(from_property_id__in=ids) | Q(to_property_id__in=ids))
            .order_by("pk")
            .values()
        ),
        "assessment": asdict(compare_properties(*properties)),
    }
    # The serialized form is both the retained audit evidence and the revision input.
    return json.loads(json.dumps(payload, cls=DjangoJSONEncoder))  # type: ignore[no-any-return]


def _revision(snapshot: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()


def _component_property_ids(root_ids: list[UUID]) -> set[UUID]:
    component_ids = set(root_ids)
    frontier = set(root_ids)
    while frontier:
        children = set(
            Property.objects.filter(merged_into_id__in=frontier).values_list("pk", flat=True)
        )
        frontier = children - component_ids
        component_ids.update(frontier)
    return component_ids


def _approved_connection_data(properties: list[Property]) -> dict[str, list[Any]]:
    root_ids = [property_.pk for property_ in properties]
    component_ids = _component_property_ids(root_ids)
    decisions = PropertyMatchDecision.objects.filter(
        outcome=PropertyMatchDecision.Outcome.SAME_PROPERTY,
        survivor_id__in=component_ids,
        redundant_id__in=component_ids,
    ).order_by("created_at", "pk")
    indirect_listing_ids = list(
        ListingGroupingEvent.objects
        .filter(
            action=ListingGroupingAction.MERGE,
            decision__outcome=PropertyMatchDecision.Outcome.SAME_PROPERTY,
            listing__property_id__in=root_ids,
        )
        .order_by("listing_id")
        .values_list("listing_id", flat=True)
        .distinct()
    )
    return {
        "approved_connections": [
            {
                "decision_id": decision.pk,
                "left_property_id": decision.redundant_id,
                "right_property_id": decision.survivor_id,
            }
            for decision in decisions
        ],
        "indirect_listing_ids": indirect_listing_ids,
    }


def _evaluation_snapshot(evaluation: PropertyMatchSuggestionEvaluation) -> dict[str, Any]:
    return {
        "score": evaluation.score,
        "band": evaluation.band,
        "scoring_version": evaluation.scoring_version,
        "evidence_fingerprint": evaluation.evidence_fingerprint,
        "left_revision": evaluation.left_revision,
        "right_revision": evaluation.right_revision,
        "evidence": evaluation.evidence,
        "origin": evaluation.origin,
    }


def _current_suggestion(
    *,
    suggestion_id: UUID,
    properties: list[UUID],
) -> tuple[PropertyMatchSuggestion, PropertyMatchSuggestionEvaluation]:
    from .match_suggestions import property_identity_revision

    suggestion = (
        PropertyMatchSuggestion.objects.select_for_update().filter(pk=suggestion_id).first()
    )
    ordered = sorted(properties)
    if (
        suggestion is None
        or [suggestion.left_id, suggestion.right_id] != ordered
        or suggestion.state != PropertyMatchSuggestionState.PENDING
    ):
        raise ReviewConflict()
    evaluation = suggestion.evaluations.order_by("-created_at", "-pk").first()
    if evaluation is None:
        raise ReviewConflict()
    roots = {
        item.pk: item for item in Property.objects.filter(pk__in=ordered, merged_into__isnull=True)
    }
    if len(roots) != 2:
        raise ReviewConflict()
    if (
        property_identity_revision(roots[ordered[0]]) != evaluation.left_revision
        or property_identity_revision(roots[ordered[1]]) != evaluation.right_revision
        or suggestion.evidence_fingerprint != evaluation.evidence_fingerprint
    ):
        raise ReviewConflict()
    return suggestion, evaluation


@transaction.atomic
def comparison_data(ids: list[UUID]) -> dict[str, Any]:
    properties = _properties(ids, lock=True)
    ids = [property_.pk for property_ in properties]
    _lock_evidence(ids)
    snapshot = _snapshot(properties)
    claim = PropertyMatchClaim.objects.filter(
        Q(left_id__in=ids) | Q(right_id__in=ids), expires_at__gt=timezone.now()
    ).first()
    return {
        **snapshot["assessment"],
        **decision_options(properties),
        **_approved_connection_data(properties),
        "properties": [property_evidence_data(item) for item in properties],
        "revision": _revision(snapshot),
        "claim": (
            {"id": claim.pk, "actor_id": claim.actor_id, "expires_at": claim.expires_at}
            if claim
            else None
        ),
    }


@transaction.atomic
def claim_comparison(
    *,
    actor: User,
    properties: list[UUID],
    revision: str,
    suggestion_id: UUID | None = None,
) -> dict[str, Any]:
    _authorize(actor)
    selected = _properties(properties, lock=True)
    properties = [property_.pk for property_ in selected]
    _eligible(actor, properties)
    _lock_evidence(properties)
    if _revision(_snapshot(selected)) != revision:
        raise ReviewConflict()
    suggestion = None
    if suggestion_id is not None:
        suggestion, _ = _current_suggestion(
            suggestion_id=suggestion_id,
            properties=properties,
        )
    now = timezone.now()
    occupied = PropertyMatchClaim.objects.filter(
        Q(left_id__in=properties) | Q(right_id__in=properties), expires_at__gt=now
    )
    pair = sorted(properties)
    if occupied.exclude(left_id=pair[0], right_id=pair[1], actor=actor).exists():
        raise ReviewConflict("این ملک در حال بررسی توسط کارشناس دیگری است.")
    claim = occupied.filter(left_id=pair[0], right_id=pair[1], actor=actor).first()
    if claim is None:
        PropertyMatchClaim.objects.create(
            left_id=pair[0],
            right_id=pair[1],
            actor=actor,
            suggestion=suggestion,
            expires_at=now + CLAIM_LIFETIME,
        )
    else:
        if claim.suggestion_id not in (None, suggestion_id):
            raise ReviewConflict()
        if suggestion is not None and claim.suggestion_id is None:
            claim.suggestion = suggestion
        claim.expires_at = now + CLAIM_LIFETIME
        claim.save(update_fields=["suggestion", "expires_at"])
    return comparison_data(properties)


FACT_FIELDS = {
    "city_id": "شهر",
    "district_id": "منطقه",
    "neighborhood_id": "محله",
    "property_type": "نوع ملک",
    "area_sqm": "متراژ",
    "room_count": "تعداد اتاق",
    "construction_year": "سال ساخت",
    "floor": "طبقه",
    "total_floors": "تعداد طبقات",
    "units_per_floor": "واحد در طبقه",
    "parking": "پارکینگ",
    "elevator": "آسانسور",
    "storage": "انباری",
    "balcony": "بالکن",
    "furnished": "مبله",
    "heating": "گرمایش",
    "cooling": "سرمایش",
    "latitude": "عرض جغرافیایی دقیق",
    "longitude": "طول جغرافیایی دقیق",
    "operator_location_notes": "یادداشت مکان",
    "provenance_note": "یادداشت شواهد",
}


def _display_fact(property_: Property, key: str) -> Any:
    value = getattr(property_, key)
    if key.endswith("_id"):
        return str(getattr(property_, key.removesuffix("_id"))) if value else None
    field = Property._meta.get_field(key)
    if isinstance(field, Field) and field.choices:
        return str(dict(field.flatchoices).get(value, value))
    return value


def decision_options(properties: list[Property]) -> dict[str, Any]:
    def rank(item: Property) -> tuple[int, str, str]:
        return (
            sum(getattr(item, key) not in (None, "", "unknown") for key in FACT_FIELDS),
            item.normalized_at.isoformat() if item.normalized_at else "",
            str(item.pk),
        )

    return {
        "suggested_survivor_id": max(properties, key=rank).pk,
        "decision_fields": [
            {
                "key": key,
                "label": label,
                "values": {str(item.pk): getattr(item, key) for item in properties},
                "display_values": {str(item.pk): _display_fact(item, key) for item in properties},
                "conflicting": getattr(properties[0], key) != getattr(properties[1], key),
            }
            for key, label in FACT_FIELDS.items()
        ],
        "property_images": [
            {
                "id": image.pk,
                "property_id": item.pk,
                "url": f"/api/v1/operator/catalog-curation/images/{image.pk}/",
            }
            for item in properties
            for image in item.images.filter(retired_at__isnull=True)
        ],
    }


def _eligible(actor: User, properties: list[UUID]) -> None:
    from apps.submissions.models import Submission

    from .models import OutboundPolicy

    if Submission.objects.filter(
        submitter=actor,
        listing__property_id__in=properties,
        listing__source__outbound_policy=OutboundPolicy.DIRECT_CONTACT,
    ).exists():
        raise PermissionDenied("نمی‌توانید درباره آگهی مستقیم خود تصمیم بگیرید.")


@transaction.atomic
def approve_comparison(
    *,
    actor: User,
    properties: list[UUID],
    revision: str,
    claim_id: UUID,
    survivor_id: UUID,
    survivor_confirmed: bool,
    fact_choices: dict[str, UUID],
    image_ids: list[UUID],
    images_confirmed: bool,
    warning_confirmed: bool = False,
    reason: str = "",
    suggestion_id: UUID | None = None,
) -> PropertyMatchDecision:
    _authorize(actor)
    request_digest = _revision(
        json.loads(
            json.dumps(
                {
                    "properties": sorted(properties),
                    "revision": revision,
                    "claim_id": claim_id,
                    "survivor_id": survivor_id,
                    "survivor_confirmed": survivor_confirmed,
                    "fact_choices": fact_choices,
                    "image_ids": image_ids,
                    "images_confirmed": images_confirmed,
                    "warning_confirmed": warning_confirmed,
                    "reason": reason,
                    "suggestion_id": suggestion_id,
                },
                cls=DjangoJSONEncoder,
            )
        )
    )
    from .services import current_property_id

    resolved_property_ids = [current_property_id(property_id) for property_id in properties]
    if len(set(resolved_property_ids)) != 2:
        list(
            Property.objects.select_for_update().filter(pk__in=resolved_property_ids).order_by("pk")
        )
        existing = (
            PropertyMatchDecision.objects.select_for_update().filter(claim_id=claim_id).first()
        )
        if (
            existing is not None
            and existing.actor_id == actor.pk
            and existing.request_digest == request_digest
        ):
            return existing
        raise ReviewConflict()
    selected = _approval_properties(properties)
    properties = [property_.pk for property_ in selected]
    survivor_id = current_property_id(survivor_id)
    fact_choices = {
        field: current_property_id(property_id) for field, property_id in fact_choices.items()
    }
    existing = PropertyMatchDecision.objects.select_for_update().filter(claim_id=claim_id).first()
    if existing:
        if existing.actor_id != actor.pk or existing.request_digest != request_digest:
            raise ReviewConflict()
        return existing
    _eligible(actor, properties)
    claim = PropertyMatchClaim.objects.filter(
        pk=claim_id,
        actor=actor,
        expires_at__gt=timezone.now(),
        left_id=min(properties),
        right_id=max(properties),
    ).first()
    if claim is None:
        raise ReviewConflict()
    suggestion = None
    evaluation = None
    if suggestion_id is not None:
        if claim.suggestion_id != suggestion_id:
            raise ReviewConflict()
        suggestion, evaluation = _current_suggestion(
            suggestion_id=suggestion_id,
            properties=properties,
        )
    elif claim.suggestion_id is not None:
        raise ReviewConflict()
    _lock_evidence(properties)
    before = _snapshot(selected)
    if _revision(before) != revision:
        raise ReviewConflict()
    if not survivor_confirmed or survivor_id not in properties or not images_confirmed:
        raise ValidationError("ملک باقی‌مانده و انتخاب تصاویر را صریحاً تأیید کنید.")
    if set(fact_choices) != set(FACT_FIELDS) or any(
        value not in properties for value in fact_choices.values()
    ):
        raise ValidationError("برای هر واقعیت، یکی از دو مقدار نمایش‌داده‌شده را انتخاب کنید.")
    if before["assessment"]["band"] == "below_threshold" and not warning_confirmed:
        raise ValidationError("هشدار شواهد ضعیف یا متعارض را تأیید کنید.")
    by_id = {item.pk: item for item in selected}
    survivor = by_id[survivor_id]
    redundant = next(item for item in selected if item.pk != survivor_id)
    selected_facts = {key: getattr(by_id[side], key) for key, side in fact_choices.items()}
    for key, value in selected_facts.items():
        setattr(survivor, key, value)
    try:
        survivor.full_clean()
        derive_public_location(survivor)
    except DjangoValidationError as exc:
        raise ValidationError(
            exc.message_dict if hasattr(exc, "message_dict") else exc.messages
        ) from exc
    images = {
        image.pk: image
        for image in PropertyImage.objects.filter(
            property_id__in=properties,
            retired_at__isnull=True,
        ).prefetch_related("variants")
    }
    if len(set(image_ids)) != len(image_ids) or any(pk not in images for pk in image_ids):
        raise ValidationError("تصاویر انتخاب‌شده باید از همین دو ملک باشند.")
    survivor.normalized_at = timezone.now()
    survivor.save()
    # Retained image rows keep their asset references and original review provenance.
    PropertyImage.objects.filter(property=survivor, retired_at__isnull=True).update(
        retired_at=timezone.now()
    )
    for position, image_id in enumerate(image_ids):
        original = images[image_id]
        copied = PropertyImage.objects.create(
            property=survivor,
            position=position,
            is_primary=position == 0,
            reviewed_at=timezone.now(),
            reviewed_by=actor,
        )
        PropertyImageVariant.objects.bulk_create([
            PropertyImageVariant(image=copied, kind=variant.kind, asset_id=variant.asset_id)
            for variant in original.variants.all()
        ])
    decision = PropertyMatchDecision.objects.create(
        claim=claim,
        actor=actor,
        origin=evaluation.origin if evaluation is not None else "operator_initiated",
        outcome=PropertyMatchDecision.Outcome.SAME_PROPERTY,
        suggestion=suggestion,
        evaluation=evaluation,
        evaluation_snapshot=_evaluation_snapshot(evaluation) if evaluation is not None else {},
        survivor=survivor,
        redundant=redundant,
        before_revision=revision,
        after_revision="",
        evidence=before,
        after_snapshot={},
        selected_facts=json.loads(json.dumps(selected_facts, cls=DjangoJSONEncoder)),
        selected_image_ids=[str(pk) for pk in image_ids],
        affected_listing_ids=[row["id"] for row in before["listings"]],
        request_digest=request_digest,
        reason=reason,
    )
    if suggestion is not None:
        suggestion.state = PropertyMatchSuggestionState.APPROVED
        suggestion.snoozed_until = None
        suggestion.save(update_fields=["state", "snoozed_until", "updated_at"])
    merge_properties(target=survivor, duplicate=redundant, reason=reason, decision=decision)
    after = _snapshot([survivor, redundant])
    decision.after_snapshot = after
    decision.after_revision = _revision(after)
    decision.save(update_fields=["after_snapshot", "after_revision"])
    claim.expires_at = timezone.now()
    claim.save(update_fields=["expires_at"])
    return decision


@transaction.atomic
def decide_suggestion(
    *,
    actor: User,
    suggestion_id: UUID,
    revision: str,
    claim_id: UUID,
    outcome: str,
    reason: str = "",
    snooze_days: int | None = None,
) -> PropertyMatchDecision:
    _authorize(actor)
    request_digest = _revision({
        "suggestion_id": str(suggestion_id),
        "revision": revision,
        "claim_id": str(claim_id),
        "outcome": outcome,
        "reason": reason,
        "snooze_days": snooze_days,
    })
    suggestion_reference = PropertyMatchSuggestion.objects.filter(pk=suggestion_id).first()
    if suggestion_reference is None:
        raise ReviewConflict()
    referenced_properties = [suggestion_reference.left_id, suggestion_reference.right_id]
    selected = _properties(referenced_properties, lock=True)
    properties = [property_.pk for property_ in selected]
    existing = PropertyMatchDecision.objects.filter(claim_id=claim_id).first()
    if existing is not None:
        if existing.actor_id != actor.pk or existing.request_digest != request_digest:
            raise ReviewConflict()
        return existing
    _eligible(actor, properties)
    suggestion, evaluation = _current_suggestion(
        suggestion_id=suggestion_id,
        properties=properties,
    )
    claim = PropertyMatchClaim.objects.filter(
        pk=claim_id,
        actor=actor,
        suggestion=suggestion,
        expires_at__gt=timezone.now(),
        left_id=suggestion.left_id,
        right_id=suggestion.right_id,
    ).first()
    if claim is None:
        raise ReviewConflict()
    _lock_evidence(properties)
    before = _snapshot(selected)
    if _revision(before) != revision:
        raise ReviewConflict()
    if outcome not in {
        PropertyMatchDecision.Outcome.NOT_SAME_PROPERTY,
        PropertyMatchDecision.Outcome.SNOOZED,
    }:
        raise ValidationError("تصمیم پیشنهاد معتبر نیست.")
    if outcome == PropertyMatchDecision.Outcome.SNOOZED and snooze_days not in (1, 7, 30):
        raise ValidationError("تعویق باید ۱، ۷ یا ۳۰ روز باشد.")
    decision = PropertyMatchDecision.objects.create(
        claim=claim,
        actor=actor,
        origin=evaluation.origin,
        outcome=outcome,
        suggestion=suggestion,
        evaluation=evaluation,
        evaluation_snapshot=_evaluation_snapshot(evaluation),
        survivor=None,
        redundant=None,
        before_revision=revision,
        after_revision=revision,
        evidence=before,
        after_snapshot=before,
        selected_facts={},
        selected_image_ids=[],
        affected_listing_ids=[row["id"] for row in before["listings"]],
        request_digest=request_digest,
        reason=reason,
    )
    suggestion.suppressed_evidence_fingerprint = evaluation.evidence_fingerprint
    if outcome == PropertyMatchDecision.Outcome.NOT_SAME_PROPERTY:
        suggestion.state = PropertyMatchSuggestionState.REJECTED
        suggestion.snoozed_until = None
    else:
        suggestion.state = PropertyMatchSuggestionState.SNOOZED
        suggestion.snoozed_until = timezone.now() + timedelta(days=snooze_days or 7)
    suggestion.save(
        update_fields=[
            "state",
            "suppressed_evidence_fingerprint",
            "snoozed_until",
            "updated_at",
        ]
    )
    claim.expires_at = timezone.now()
    claim.save(update_fields=["expires_at"])
    return decision
