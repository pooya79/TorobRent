"""Superuser adapters for the canonical Catalog Curation decision services."""

import hashlib
import json
from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction

from apps.accounts.models import User

from .match_decisions import FACT_FIELDS, approve_comparison, claim_comparison, comparison_data
from .models import Listing, Property, PropertyMatchDecision, PropertyPartitionDecision
from .property_partitions import (
    claim_partition,
    confirm_partition,
    partition_preview,
    partition_state_revision,
)


def _require_superuser(actor: User) -> None:
    if not actor.is_active or not actor.is_superuser:
        raise ValidationError("دسترسی ابرکاربر برای تعمیر مدیریتی لازم است.")


def administrative_merge_preview(
    *, actor: User, survivor_id: UUID, redundant_id: UUID
) -> dict[str, Any]:
    """Return the canonical comparison revision for a break-glass merge."""
    _require_superuser(actor)
    return comparison_data([survivor_id, redundant_id])


@transaction.atomic
def administrative_merge(
    *,
    actor: User,
    survivor_id: UUID,
    redundant_id: UUID,
    reviewed_revision: str,
    reason: str = "",
) -> PropertyMatchDecision:
    """Apply one reviewed break-glass merge through the routine decision workflow."""
    _require_superuser(actor)
    properties = [survivor_id, redundant_id]
    reviewed = comparison_data(properties)
    if reviewed["revision"] != reviewed_revision:
        raise ValidationError("شواهد یا گروه‌بندی تغییر کرده است؛ بازبینی را تازه کنید.")
    claimed = claim_comparison(
        actor=actor,
        properties=properties,
        revision=reviewed_revision,
        administrative=True,
    )
    claim = claimed["claim"]
    if claim is None:
        raise ValidationError("بازبینی مدیریتی قابل رزرو نیست؛ دوباره تلاش کنید.")
    image_ids = [
        image["id"] for image in reviewed["property_images"] if image["property_id"] == survivor_id
    ]
    return approve_comparison(
        actor=actor,
        properties=properties,
        revision=reviewed_revision,
        claim_id=claim["id"],
        survivor_id=survivor_id,
        survivor_confirmed=True,
        fact_choices={field: survivor_id for field in FACT_FIELDS},
        image_ids=image_ids,
        images_confirmed=True,
        warning_confirmed=True,
        reason=reason,
        administrative=True,
    )


def _administrative_partition_revision(
    *, partition_revision: str, destination_id: UUID, destination_revision: str
) -> str:
    payload = {
        "partition_revision": partition_revision,
        "destination_id": destination_id,
        "destination_revision": destination_revision,
    }
    encoded = json.dumps(payload, cls=DjangoJSONEncoder, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


@transaction.atomic
def administrative_partition_preview(
    *, actor: User, listing: Listing, destination_id: UUID
) -> dict[str, Any]:
    """Return the revision and evidence a superuser must confirm before reassignment."""
    _require_superuser(actor)
    current = Listing.objects.select_related("property").get(pk=listing.pk)
    if destination_id == current.property_id:
        raise ValidationError("ملک مقصد معتبر نیست.")
    list(
        Property.objects
        .select_for_update()
        .filter(pk__in=(current.property_id, destination_id))
        .order_by("pk")
    )
    destination = Property.objects.filter(pk=destination_id).first()
    if destination is None:
        raise ValidationError("ملک مقصد معتبر نیست.")
    reviewed = partition_preview(
        actor=actor,
        property_id=current.property_id,
        listing_ids=[current.pk],
        administrative=True,
    )
    partition_revision = reviewed["revision"]
    restoration_ids = {UUID(str(option["id"])) for option in reviewed["restoration_options"]}
    if destination.merged_into_id is not None and destination.pk not in restoration_ids:
        raise ValidationError("ملک مقصد ادغام‌شده، گزینه تاریخی سازگار این تفکیک نیست.")
    destination_revision = (
        partition_revision
        if destination.pk in restoration_ids
        else partition_state_revision(destination.pk)
    )
    reviewed["partition_revision"] = partition_revision
    reviewed["destination_id"] = destination.pk
    reviewed["destination_revision"] = destination_revision
    reviewed["revision"] = _administrative_partition_revision(
        partition_revision=partition_revision,
        destination_id=destination.pk,
        destination_revision=destination_revision,
    )
    return reviewed


@transaction.atomic
def administrative_reassign_listing(
    *,
    actor: User,
    listing_id: UUID,
    destination_id: UUID,
    reviewed_revision: str,
    reason: str = "",
) -> PropertyPartitionDecision:
    """Move one Listing through an audited partition decision."""
    _require_superuser(actor)
    listing = Listing.objects.select_related("property").get(pk=listing_id)
    list(
        Property.objects
        .select_for_update()
        .filter(pk__in=(listing.property_id, destination_id))
        .order_by("pk")
    )
    reviewed = administrative_partition_preview(
        actor=actor, listing=listing, destination_id=destination_id
    )
    if reviewed["revision"] != reviewed_revision:
        raise ValidationError("شواهد یا گروه‌بندی تغییر کرده است؛ بازبینی را تازه کنید.")
    destination = Property.objects.get(pk=destination_id)
    restoration_ids = {UUID(str(option["id"])) for option in reviewed["restoration_options"]}
    partition_revision = reviewed["partition_revision"]
    claimed = claim_partition(
        actor=actor,
        property_id=listing.property_id,
        listing_ids=[listing.pk],
        revision=partition_revision,
        administrative=True,
    )
    claim = claimed["claim"]
    if claim is None:
        raise ValidationError("بازبینی مدیریتی قابل رزرو نیست؛ دوباره تلاش کنید.")
    restoring = destination.pk in restoration_ids
    image_ids = [
        image["id"]
        for image in reviewed["property_images"]
        if UUID(str(image["property_id"])) == destination.pk
    ]
    return confirm_partition(
        actor=actor,
        property_id=listing.property_id,
        listing_ids=[listing.pk],
        revision=partition_revision,
        claim_id=claim["id"],
        destination_mode="restore" if restoring else "existing",
        destination_property_id=destination.pk,
        normalized_facts={},
        image_ids=image_ids,
        facts_confirmed=True,
        images_confirmed=True,
        reason=reason,
        administrative=True,
    )
