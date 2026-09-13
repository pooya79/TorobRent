"""Operator-confirmed partitioning of an incorrectly grouped Property."""

import hashlib
import json
from typing import Any, cast
from uuid import UUID

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User

from .decision_audit import evaluation_snapshot
from .group_consistency import approved_connection_graph, grouping_history
from .locations import derive_public_location
from .match_decisions import CLAIM_LIFETIME, FACT_FIELDS, ReviewConflict, _authorize, _eligible
from .match_suggestions import evaluate_property_pair, property_identity_revision
from .models import (
    Favorite,
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
    PropertyMatchSuggestion,
    PropertyMatchSuggestionState,
    PropertyPartitionClaim,
    PropertyPartitionDecision,
    RentalTerms,
)
from .operator_serializers import property_evidence_data
from .services import property_component_ids


def _json[T](value: T) -> T:
    return cast(T, json.loads(json.dumps(value, cls=DjangoJSONEncoder)))


def _digest(value: Any) -> str:
    encoded = json.dumps(_json(value), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


@transaction.atomic
def partition_state_revision(property_id: UUID) -> str:
    """Lock and revise all evidence that can affect a partition destination."""
    return _digest(_snapshot(_lock_group(property_id)))


def _lock_group(property_id: UUID) -> Property:
    property_ = (
        Property.objects
        .select_for_update()
        .filter(pk=property_id, merged_into__isnull=True)
        .first()
    )
    if property_ is None:
        raise ReviewConflict()
    component_ids = property_component_ids(property_id)
    list(Property.objects.select_for_update().filter(pk__in=component_ids).order_by("pk"))
    listings = Listing.objects.filter(property=property_)
    list(listings.select_for_update().order_by("pk"))
    list(RentalTerms.objects.select_for_update().filter(listing__in=listings).order_by("pk"))
    list(ListingImage.objects.select_for_update().filter(listing__in=listings).order_by("pk"))
    list(
        ListingImageVariant.objects
        .select_for_update()
        .filter(image__listing__in=listings)
        .order_by("pk")
    )
    list(
        PropertyImage.objects
        .select_for_update()
        .filter(property_id__in=component_ids)
        .order_by("pk")
    )
    list(
        PropertyImageVariant.objects
        .select_for_update()
        .filter(image__property_id__in=component_ids)
        .order_by("pk")
    )
    list(
        Favorite.objects.select_for_update().filter(property=property_).order_by("account_id", "pk")
    )
    list(
        PropertyMatchSuggestion.objects
        .select_for_update()
        .filter(Q(left=property_) | Q(right=property_))
        .order_by("pk")
    )
    return Property.objects.get(pk=property_id)


def _selected_listings(property_: Property, ids: list[UUID]) -> list[Listing]:
    if not ids or len(ids) != len(set(ids)):
        raise ValidationError({"listing_ids": "دست‌کم یک آگهی یکتا انتخاب کنید."})
    listings = list(property_.listings.select_related("source", "terms").order_by("pk"))
    selected = [listing for listing in listings if listing.pk in set(ids)]
    if len(selected) != len(ids) or len(selected) == len(listings):
        raise ValidationError({
            "listing_ids": "یک زیرمجموعه غیرخالی از آگهی‌های گروه را انتخاب کنید."
        })
    return selected


def _facts(property_: Property) -> dict[str, Any]:
    return {field: getattr(property_, field) for field in FACT_FIELDS}


def _historical_options(property_: Property, selected: list[Listing]) -> list[Property]:
    origin_ids: set[UUID] = set()
    for listing in selected:
        first = listing.grouping_events.order_by("created_at", "pk").first()
        if first is None or first.from_property_id == property_.pk:
            return []
        origin_ids.add(first.from_property_id)
    if len(origin_ids) != 1:
        return []
    return list(
        Property.objects.filter(
            pk__in=origin_ids,
            merged_into=property_,
            listings__isnull=True,
        )
    )


def _snapshot(property_: Property) -> dict[str, Any]:
    component_ids = property_component_ids(property_.pk)
    listings = Listing.objects.filter(property=property_).order_by("pk")
    return _json({
        "properties": list(Property.objects.filter(pk__in=component_ids).order_by("pk").values()),
        "listings": list(listings.values()),
        "terms": list(RentalTerms.objects.filter(listing__in=listings).order_by("pk").values()),
        "listing_images": list(
            ListingImage.objects.filter(listing__in=listings).order_by("pk").values()
        ),
        "listing_image_variants": list(
            ListingImageVariant.objects.filter(image__listing__in=listings).order_by("pk").values()
        ),
        "property_images": list(
            PropertyImage.objects.filter(property_id__in=component_ids).order_by("pk").values()
        ),
        "property_image_variants": list(
            PropertyImageVariant.objects
            .filter(image__property_id__in=component_ids)
            .order_by("pk")
            .values()
        ),
        "favorites": list(Favorite.objects.filter(property=property_).order_by("pk").values()),
        "grouping_history": grouping_history(property_),
        "approved_connections": approved_connection_graph(property_),
        "pending_suggestions": list(
            PropertyMatchSuggestion.objects
            .filter(
                Q(left=property_) | Q(right=property_), state=PropertyMatchSuggestionState.PENDING
            )
            .order_by("pk")
            .values()
        ),
    })


def _listing_preview(listing: Listing) -> dict[str, Any]:
    return _json({
        "id": listing.pk,
        "state": listing.state,
        "source": {
            "id": listing.source_id,
            "name": listing.source.display_name,
            "domain": listing.source.domain,
        },
        "source_reference": listing.source_reference,
        "source_claims": listing.source_claims,
        "provenance_note": listing.provenance_note,
        "external_url": listing.external_url,
        "direct_phone": listing.direct_phone,
        "rental_terms": {
            "deposit_rial": listing.terms.deposit_rial,
            "monthly_rent_rial": listing.terms.monthly_rent_rial,
        },
    })


@transaction.atomic
def partition_preview(
    *,
    actor: User,
    property_id: UUID,
    listing_ids: list[UUID],
    administrative: bool = False,
) -> dict[str, Any]:
    _authorize(actor, administrative=administrative)
    property_ = _lock_group(property_id)
    selected = _selected_listings(property_, listing_ids)
    _eligible(actor, [property_.pk])
    snapshot = _snapshot(property_)
    remaining = list(
        property_.listings
        .select_related("source", "terms")
        .exclude(pk__in=listing_ids)
        .order_by("pk")
    )
    historical = _historical_options(property_, selected)
    image_properties = [property_, *historical]
    active_images = list(
        PropertyImage.objects.filter(
            property__in=image_properties, retired_at__isnull=True
        ).order_by("property_id", "position")
    )
    active_claim = PropertyPartitionClaim.objects.filter(
        property=property_, expires_at__gt=timezone.now()
    ).first()
    return _json({
        "property_id": property_.pk,
        "revision": _digest(snapshot),
        "selected_listing_ids": [item.pk for item in selected],
        "selected_listings": [_listing_preview(item) for item in selected],
        "remaining_listings": [_listing_preview(item) for item in remaining],
        "grouping_history": snapshot["grouping_history"],
        "approved_connections": snapshot["approved_connections"],
        "pending_suggestions": snapshot["pending_suggestions"],
        "property_images": [
            {
                "id": image.pk,
                "property_id": image.property_id,
                "url": f"/api/v1/operator/catalog-curation/images/{image.pk}/",
            }
            for image in active_images
        ],
        "favorites": {"surviving_count": len(snapshot["favorites"]), "copied_count": 0},
        "restoration_options": [
            {
                "id": item.pk,
                "normalized_facts": _facts(item),
                "property": property_evidence_data(item),
            }
            for item in historical
        ],
        "new_property_defaults": _facts(property_),
        "resulting_properties": [
            {
                "role": "surviving",
                "id": property_.pk,
                "normalized_facts": _facts(property_),
                "listing_ids": [item.pk for item in remaining],
            },
            {
                "role": "separated",
                "id": historical[0].pk if historical else None,
                "normalized_facts": _facts(historical[0] if historical else property_),
                "listing_ids": [item.pk for item in selected],
            },
        ],
        "claim": (
            {
                "id": active_claim.pk,
                "actor_id": active_claim.actor_id,
                "expires_at": active_claim.expires_at,
            }
            if active_claim
            else None
        ),
    })


@transaction.atomic
def claim_partition(
    *,
    actor: User,
    property_id: UUID,
    listing_ids: list[UUID],
    revision: str,
    administrative: bool = False,
) -> dict[str, Any]:
    preview = partition_preview(
        actor=actor,
        property_id=property_id,
        listing_ids=listing_ids,
        administrative=administrative,
    )
    if preview["revision"] != revision:
        raise ReviewConflict()
    now = timezone.now()
    if PropertyMatchClaim.objects.filter(
        Q(left_id=property_id) | Q(right_id=property_id), expires_at__gt=now
    ).exists():
        raise ReviewConflict("این ملک در حال بررسی تطبیق است.")
    occupied = PropertyPartitionClaim.objects.filter(property_id=property_id, expires_at__gt=now)
    claim = occupied.filter(actor=actor).first()
    if occupied.exclude(actor=actor).exists():
        raise ReviewConflict("این ملک در حال بررسی توسط کارشناس دیگری است.")
    normalized_ids = [str(value) for value in sorted(listing_ids)]
    if claim is None:
        claim = PropertyPartitionClaim.objects.create(
            property_id=property_id,
            actor=actor,
            selected_listing_ids=normalized_ids,
            revision=revision,
            expires_at=now + CLAIM_LIFETIME,
        )
    else:
        claim.selected_listing_ids = normalized_ids
        claim.revision = revision
        claim.expires_at = now + CLAIM_LIFETIME
        claim.save(update_fields=["selected_listing_ids", "revision", "expires_at"])
    preview["claim"] = {"id": claim.pk, "actor_id": actor.pk, "expires_at": claim.expires_at}
    return _json(preview)


def _validated_facts(values: dict[str, Any]) -> dict[str, Any]:
    if set(values) != set(FACT_FIELDS):
        raise ValidationError({"normalized_facts": "همه واقعیت‌های ملک را تأیید کنید."})
    result: dict[str, Any] = {}
    for name, value in values.items():
        field = cast(Any, Property._meta.get_field(name))
        try:
            result[name] = field.to_python(value)
        except (TypeError, ValueError, DjangoValidationError) as exc:
            raise ValidationError({"normalized_facts": {name: "مقدار معتبر نیست."}}) from exc
    return result


def _suppression_fingerprint(left: Property, right: Property) -> str:
    ordered = sorted((left, right), key=lambda item: item.pk)
    return hashlib.sha256(
        f"{property_identity_revision(ordered[0])}:{property_identity_revision(ordered[1])}".encode()
    ).hexdigest()


@transaction.atomic
def confirm_partition(
    *,
    actor: User,
    property_id: UUID,
    listing_ids: list[UUID],
    revision: str,
    claim_id: UUID,
    destination_mode: str,
    destination_property_id: UUID | None,
    normalized_facts: dict[str, Any],
    image_ids: list[UUID],
    facts_confirmed: bool,
    images_confirmed: bool,
    reason: str = "",
    administrative: bool = False,
) -> PropertyPartitionDecision:
    _authorize(actor, administrative=administrative)
    request_digest = _digest({
        "property_id": property_id,
        "listing_ids": sorted(listing_ids),
        "revision": revision,
        "claim_id": claim_id,
        "destination_mode": destination_mode,
        "destination_property_id": destination_property_id,
        "normalized_facts": normalized_facts,
        "image_ids": image_ids,
        "facts_confirmed": facts_confirmed,
        "images_confirmed": images_confirmed,
        "reason": reason,
        "administrative": administrative,
    })
    existing = (
        PropertyPartitionDecision.objects.select_for_update().filter(claim_id=claim_id).first()
    )
    if existing is not None:
        if existing.actor_id == actor.pk and existing.request_digest == request_digest:
            return existing
        raise ReviewConflict()
    if destination_mode == "existing" and destination_property_id is not None:
        list(
            Property.objects
            .select_for_update()
            .filter(pk__in=(property_id, destination_property_id))
            .order_by("pk")
        )
    source = _lock_group(property_id)
    selected = _selected_listings(source, listing_ids)
    _eligible(actor, [source.pk])
    claim = PropertyPartitionClaim.objects.filter(
        pk=claim_id,
        property=source,
        actor=actor,
        expires_at__gt=timezone.now(),
        revision=revision,
        selected_listing_ids=[str(value) for value in sorted(listing_ids)],
    ).first()
    if claim is None or _digest(_snapshot(source)) != revision:
        raise ReviewConflict()
    if not facts_confirmed or not images_confirmed:
        raise ValidationError("واقعیت‌ها و تصاویر ملک جداشده را صریحاً تأیید کنید.")
    before = _snapshot(source)
    historical = _historical_options(source, selected)
    if destination_mode == "restore":
        if destination_property_id is None or destination_property_id not in {
            item.pk for item in historical
        }:
            raise ValidationError({"destination_property_id": "ملک تاریخی سازگار نیست."})
        destination = next(item for item in historical if item.pk == destination_property_id)
        destination.merged_into = None
        destination.merged_at = None
        destination.save(update_fields=["merged_into", "merged_at"])
        selected_facts = _facts(destination)
        restored = True
    elif destination_mode == "new":
        if destination_property_id is not None:
            raise ValidationError({"destination_property_id": "برای ملک تازه شناسه مقصد نفرستید."})
        selected_facts = _validated_facts(normalized_facts)
        destination = Property(**selected_facts)
        try:
            destination.full_clean()
            derive_public_location(destination)
        except DjangoValidationError as exc:
            raise ValidationError(
                exc.message_dict if hasattr(exc, "message_dict") else exc.messages
            ) from exc
        destination.normalized_at = timezone.now()
        destination.save()
        restored = False
    elif destination_mode == "existing":
        if destination_property_id is None or destination_property_id == source.pk:
            raise ValidationError({"destination_property_id": "ملک مقصد معتبر نیست."})
        destination = _lock_group(destination_property_id)
        _eligible(actor, [destination.pk])
        selected_facts = _facts(destination)
        restored = False
    else:
        raise ValidationError({"destination_mode": "مقصد تفکیک معتبر نیست."})
    available_images = {
        image.pk: image
        for image in PropertyImage.objects.filter(
            property_id__in=(source.pk, destination.pk), retired_at__isnull=True
        ).prefetch_related("variants")
    }
    if len(image_ids) != len(set(image_ids)) or any(
        value not in available_images for value in image_ids
    ):
        raise ValidationError({"image_ids": "تصاویر باید از ملک در حال تفکیک باشند."})
    decision = PropertyPartitionDecision.objects.create(
        claim=claim,
        actor=actor,
        origin=(
            PropertyDecisionOrigin.ADMINISTRATIVE
            if administrative
            else PropertyDecisionOrigin.OPERATOR_INITIATED
        ),
        source_property=source,
        separated_property=destination,
        restored_historical_property=restored,
        selected_listing_ids=[str(item.pk) for item in selected],
        before_revision=revision,
        after_revision="",
        evidence=before,
        after_snapshot={},
        selected_facts=_json(selected_facts),
        selected_image_ids=[str(value) for value in image_ids],
        suppression_fingerprint="",
        request_digest=request_digest,
        reason=reason,
    )
    for listing in selected:
        listing.property = destination
        listing.save(update_fields=["property", "updated_at"])
        ListingGroupingEvent.objects.create(
            listing=listing,
            from_property=source,
            to_property=destination,
            action=ListingGroupingAction.SPLIT,
            partition_decision=decision,
            reason=reason,
        )
    PropertyImage.objects.filter(property=destination, retired_at__isnull=True).update(
        retired_at=timezone.now()
    )
    for position, image_id in enumerate(image_ids):
        original = available_images[image_id]
        copied = PropertyImage.objects.create(
            property=destination,
            position=position,
            is_primary=position == 0,
            reviewed_at=timezone.now(),
            reviewed_by=actor,
        )
        PropertyImageVariant.objects.bulk_create([
            PropertyImageVariant(image=copied, kind=variant.kind, asset_id=variant.asset_id)
            for variant in original.variants.all()
        ])
    fingerprint = _suppression_fingerprint(source, destination)
    decision.suppression_fingerprint = fingerprint
    suggestion = evaluate_property_pair(
        source.pk, destination.pk, origin="focused", persist_inactive=True
    )
    if suggestion is not None:
        evaluation = suggestion.evaluations.order_by("-created_at", "-pk").first()
        if evaluation is not None:
            decision.evaluation_snapshot = _json(evaluation_snapshot(evaluation))
        suggestion.state = PropertyMatchSuggestionState.REJECTED
        suggestion.suppressed_evidence_fingerprint = suggestion.evidence_fingerprint
        suggestion.snoozed_until = None
        suggestion.save(
            update_fields=[
                "state",
                "suppressed_evidence_fingerprint",
                "snoozed_until",
                "updated_at",
            ]
        )
    after = _json({
        "surviving": _snapshot(source),
        "separated": _snapshot(destination),
    })
    decision.after_snapshot = after
    decision.after_revision = _digest(after)
    decision.save(
        update_fields=[
            "after_snapshot",
            "after_revision",
            "suppression_fingerprint",
            "evaluation_snapshot",
        ]
    )
    claim.expires_at = timezone.now()
    claim.save(update_fields=["expires_at"])
    return decision
