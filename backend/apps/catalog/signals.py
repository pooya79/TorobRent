import uuid

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.common.media import schedule_asset_cleanup

from .models import (
    Listing,
    ListingImageVariant,
    ListingPriceObservation,
    ListingState,
    PropertyImageVariant,
    RentalTerms,
)


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
