import logging
import uuid

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.common.media import schedule_asset_cleanup

from .models import (
    Listing,
    ListingImage,
    ListingImageVariant,
    ListingPriceObservation,
    ListingState,
    Property,
    PropertyImageVariant,
    RentalTerms,
)

logger = logging.getLogger(__name__)

PROPERTY_IDENTITY_UPDATE_FIELDS = {
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
    "merged_into",
}
LISTING_IDENTITY_UPDATE_FIELDS = {
    "property",
    "source",
    "state",
    "source_reference",
    "source_claims",
}


def _dispatch_focused_measurement(property_id: uuid.UUID) -> None:
    from .tasks import measure_property_match_candidates

    try:
        measure_property_match_candidates.delay(property_id=str(property_id), limit=100)
    except Exception:
        logger.exception("Could not enqueue a focused Property match measurement")


def _enqueue_focused_measurement(property_id: uuid.UUID) -> None:
    transaction.on_commit(lambda: _dispatch_focused_measurement(property_id))


@receiver(post_save, sender=Property)
def enqueue_property_identity_measurement(
    sender: type[Property],
    instance: Property,
    created: bool,
    update_fields: frozenset[str] | None = None,
    raw: bool = False,
    **_kwargs: object,
) -> None:
    del sender
    if raw or (
        not created
        and update_fields is not None
        and not PROPERTY_IDENTITY_UPDATE_FIELDS.intersection(update_fields)
    ):
        return
    _enqueue_focused_measurement(instance.pk)


@receiver(post_save, sender=Listing)
def enqueue_listing_identity_measurement(
    sender: type[Listing],
    instance: Listing,
    created: bool,
    update_fields: frozenset[str] | None = None,
    raw: bool = False,
    **_kwargs: object,
) -> None:
    del sender
    if raw or (
        not created
        and update_fields is not None
        and not LISTING_IDENTITY_UPDATE_FIELDS.intersection(update_fields)
    ):
        return
    _enqueue_focused_measurement(instance.property_id)


@receiver(post_save, sender=ListingImage)
def enqueue_listing_image_measurement(
    sender: type[ListingImage],
    instance: ListingImage,
    raw: bool = False,
    **_kwargs: object,
) -> None:
    del sender
    if not raw:
        _enqueue_focused_measurement(instance.listing.property_id)


@receiver(post_delete, sender=ListingImage)
def enqueue_deleted_listing_image_measurement(
    sender: type[ListingImage],
    instance: ListingImage,
    **_kwargs: object,
) -> None:
    del sender
    _enqueue_focused_measurement(instance.listing.property_id)


@receiver(post_delete, sender=Listing)
def enqueue_deleted_listing_measurement(
    sender: type[Listing],
    instance: Listing,
    **_kwargs: object,
) -> None:
    del sender
    _enqueue_focused_measurement(instance.property_id)


@receiver(post_delete, sender=ListingImageVariant)
@receiver(post_delete, sender=PropertyImageVariant)
def delete_catalog_image_variant_asset(
    sender: type[ListingImageVariant] | type[PropertyImageVariant],
    instance: ListingImageVariant | PropertyImageVariant,
    **_kwargs: object,
) -> None:
    del sender
    schedule_asset_cleanup(instance.asset_id)


def record_listing_price(listing_id: uuid.UUID) -> None:
    with transaction.atomic():
        listing = Listing.objects.get(pk=listing_id)
        if listing.state != ListingState.PUBLISHED:
            return
        # Both signals serialize on the terms row without reversing the lock order
        # of callers that have already saved RentalTerms inside a transaction.
        terms = RentalTerms.objects.select_for_update().get(pk=listing.terms_id)
        latest = listing.price_history.order_by("-recorded_at", "-id").first()
        if latest and (latest.deposit_rial, latest.monthly_rent_rial) == (
            terms.deposit_rial,
            terms.monthly_rent_rial,
        ):
            return
        ListingPriceObservation.objects.create(
            listing=listing,
            deposit_rial=terms.deposit_rial,
            monthly_rent_rial=terms.monthly_rent_rial,
        )


@receiver(post_save, sender=Listing)
@receiver(post_save, sender=RentalTerms)
def record_published_price(
    sender: type[Listing] | type[RentalTerms],
    instance: Listing | RentalTerms,
    raw: bool = False,
    **_kwargs: object,
) -> None:
    if raw:
        return
    if isinstance(instance, Listing):
        record_listing_price(instance.pk)
    else:
        listing_id = (
            Listing.objects.filter(terms_id=instance.pk).values_list("pk", flat=True).first()
        )
        if listing_id is not None:
            record_listing_price(listing_id)
