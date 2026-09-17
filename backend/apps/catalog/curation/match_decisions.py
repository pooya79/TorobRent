"""Manual Property match review and its optimistic evidence boundary."""

import hashlib
import json
from dataclasses import asdict
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Field, Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User

from ..locations import derive_public_location
from ..models import (
    Listing,
    ListingGroupingAction,
    ListingGroupingEvent,
    ListingImage,
    ListingImageVariant,
    Property,
    PropertyDecisionOrigin,
    PropertyImage,
    PropertyImageVariant,
    PropertyMatchClaim,
    PropertyMatchDecision,
    PropertyMatchSuggestion,
    PropertyMatchSuggestionEvaluation,
    PropertyMatchSuggestionOrigin,
    PropertyMatchSuggestionState,
    PropertyPartitionClaim,
    RentalTerms,
)
from ..selectors import current_properties_for_curation
from ..services import merge_properties, property_component_ids
from .decision_audit import assessment_snapshot, evaluation_snapshot, property_snapshot_rows
from .evidence import property_evidence_data
from .matching import compare_properties, have_different_known_cities
from .review_policy import CLAIM_LIFETIME, FACT_FIELDS, ReviewConflict, _authorize, _eligible


class StaleSuggestion(ReviewConflict):
    default_code = "stale_property_match_suggestion"


class SuggestionNoLongerReviewable(ReviewConflict):
    default_code = "property_match_suggestion_no_longer_reviewable"
    default_detail = "این پیشنهاد پس از به‌روزرسانی شواهد دیگر قابل بررسی نیست."


def _properties(ids: list[UUID], *, lock: bool = False) -> list[Property]:
    if len(ids) != 2 or len(set(ids)) != 2:
        raise ValidationError("دقیقاً دو ملک متفاوت انتخاب کنید.")
    from ..services import current_property_id

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
    from ..services import current_property_id

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
        "properties": property_snapshot_rows(Property.objects.filter(pk__in=ids).order_by("pk")),
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


def _approved_connection_data(properties: list[Property]) -> dict[str, list[Any]]:
    root_ids = [property_.pk for property_ in properties]
    component_ids = set().union(*(property_component_ids(root_id) for root_id in root_ids))
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
        raise SuggestionNoLongerReviewable()
    evaluation = suggestion.evaluations.order_by("-created_at", "-pk").first()
    if evaluation is None:
        raise SuggestionNoLongerReviewable()
    roots = {
        item.pk: item for item in Property.objects.filter(pk__in=ordered, merged_into__isnull=True)
    }
    if len(roots) != 2:
        raise SuggestionNoLongerReviewable()
    if (
        property_identity_revision(roots[ordered[0]]) != evaluation.left_revision
        or property_identity_revision(roots[ordered[1]]) != evaluation.right_revision
        or suggestion.evidence_fingerprint != evaluation.evidence_fingerprint
    ):
        raise StaleSuggestion()
    return suggestion, evaluation


@transaction.atomic
def comparison_data(ids: list[UUID]) -> dict[str, Any]:
    properties = _properties(ids, lock=True)
    if have_different_known_cities(*properties):
        raise ValidationError("ملک‌های متعلق به شهرهای متفاوت قابل مقایسه نیستند.")
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


def claim_comparison(
    *,
    actor: User,
    properties: list[UUID],
    revision: str,
    suggestion_id: UUID | None = None,
    administrative: bool = False,
) -> dict[str, Any]:
    if suggestion_id is not None:
        # Keep the rescore in its own transaction so an inactive result remains
        # recorded when the claim request is rejected after this function returns.
        reviewable = _refresh_stale_suggestion_for_claim(
            actor=actor,
            properties=properties,
            revision=revision,
            suggestion_id=suggestion_id,
            administrative=administrative,
        )
        if not reviewable:
            raise SuggestionNoLongerReviewable()
    return _claim_current_comparison(
        actor=actor,
        properties=properties,
        revision=revision,
        suggestion_id=suggestion_id,
        administrative=administrative,
    )


def _validate_locked_claim_context(
    *,
    actor: User,
    properties: list[UUID],
    revision: str,
    administrative: bool,
) -> list[UUID]:
    _authorize(actor, administrative=administrative)
    selected = _properties(properties, lock=True)
    property_ids = [property_.pk for property_ in selected]
    _eligible(actor, property_ids)
    _lock_evidence(property_ids)
    if _revision(_snapshot(selected)) != revision:
        raise ReviewConflict()
    return property_ids


def _existing_actor_claim_or_raise(
    *,
    actor: User,
    properties: list[UUID],
    now: datetime,
) -> PropertyMatchClaim | None:
    if PropertyPartitionClaim.objects.filter(
        property_id__in=properties, expires_at__gt=now
    ).exists():
        raise ReviewConflict("این ملک در حال بررسی تفکیک است.")
    occupied = PropertyMatchClaim.objects.filter(
        Q(left_id__in=properties) | Q(right_id__in=properties), expires_at__gt=now
    )
    pair = sorted(properties)
    if occupied.exclude(left_id=pair[0], right_id=pair[1], actor=actor).exists():
        raise ReviewConflict("این ملک در حال بررسی توسط کارشناس دیگری است.")
    return occupied.filter(left_id=pair[0], right_id=pair[1], actor=actor).first()


@transaction.atomic
def _refresh_stale_suggestion_for_claim(
    *,
    actor: User,
    properties: list[UUID],
    revision: str,
    suggestion_id: UUID,
    administrative: bool,
) -> bool:
    properties = _validate_locked_claim_context(
        actor=actor,
        properties=properties,
        revision=revision,
        administrative=administrative,
    )
    try:
        _current_suggestion(suggestion_id=suggestion_id, properties=properties)
    except StaleSuggestion:
        # Rescoring expires exact-pair claims whose evidence changed. Check all
        # overlapping reviews under the Property locks before allowing that mutation.
        existing_claim = _existing_actor_claim_or_raise(
            actor=actor,
            properties=properties,
            now=timezone.now(),
        )
        if existing_claim is not None and existing_claim.suggestion_id not in (
            None,
            suggestion_id,
        ):
            raise ReviewConflict() from None
        from .match_suggestions import evaluate_property_pair

        refreshed = evaluate_property_pair(
            properties[0],
            properties[1],
            origin=PropertyMatchSuggestionOrigin.FOCUSED,
            persist_inactive=True,
        )
        reviewable = bool(
            refreshed is not None
            and refreshed.pk == suggestion_id
            and refreshed.state == PropertyMatchSuggestionState.PENDING
        )
        if reviewable and existing_claim is not None:
            existing_claim.suggestion = refreshed
            existing_claim.expires_at = timezone.now() + CLAIM_LIFETIME
            existing_claim.save(update_fields=("suggestion", "expires_at"))
        return reviewable
    return True


@transaction.atomic
def _claim_current_comparison(
    *,
    actor: User,
    properties: list[UUID],
    revision: str,
    suggestion_id: UUID | None,
    administrative: bool,
) -> dict[str, Any]:
    properties = _validate_locked_claim_context(
        actor=actor,
        properties=properties,
        revision=revision,
        administrative=administrative,
    )
    suggestion = None
    if suggestion_id is not None:
        suggestion, _ = _current_suggestion(
            suggestion_id=suggestion_id,
            properties=properties,
        )
    now = timezone.now()
    pair = sorted(properties)
    claim = _existing_actor_claim_or_raise(actor=actor, properties=properties, now=now)
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
    administrative: bool = False,
) -> PropertyMatchDecision:
    _authorize(actor, administrative=administrative)
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
                    "administrative": administrative,
                },
                cls=DjangoJSONEncoder,
            )
        )
    )
    from ..services import current_property_id

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
    try:
        selected = _approval_properties(properties)
    except ReviewConflict:
        # A concurrent identical approval can collapse the pair while this request waits
        # for the stable root locks. Return its durable decision instead of reporting stale.
        existing = (
            PropertyMatchDecision.objects.select_for_update().filter(claim_id=claim_id).first()
        )
        if (
            existing is not None
            and existing.actor_id == actor.pk
            and existing.request_digest == request_digest
        ):
            return existing
        raise
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
        origin=(
            PropertyDecisionOrigin.ADMINISTRATIVE
            if administrative
            else evaluation.origin
            if evaluation is not None
            else PropertyDecisionOrigin.OPERATOR_INITIATED
        ),
        outcome=PropertyMatchDecision.Outcome.SAME_PROPERTY,
        suggestion=suggestion,
        evaluation=evaluation,
        evaluation_snapshot=(
            evaluation_snapshot(evaluation)
            if evaluation is not None
            else assessment_snapshot(
                before["assessment"],
                origin=(
                    PropertyDecisionOrigin.ADMINISTRATIVE
                    if administrative
                    else PropertyDecisionOrigin.OPERATOR_INITIATED
                ),
            )
        ),
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
        evaluation_snapshot=evaluation_snapshot(evaluation),
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
