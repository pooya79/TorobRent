import logging
import uuid

from django.core.cache import cache
from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .match_suggestions import IDENTITY_PROPERTY_FIELD_NAMES
from .models import Listing, ListingImage, ListingImagePerceptualBucket, Property

logger = logging.getLogger(__name__)
FOCUSED_MEASUREMENT_TIMEOUT = 35 * 60
FOCUSED_MEASUREMENT_KEY = "catalog:property-match-focused:{property_id}"
FOCUSED_MEASUREMENT_DIRTY_KEY = "catalog:property-match-focused-dirty:{property_id}"

PROPERTY_IDENTITY_UPDATE_FIELDS = {*IDENTITY_PROPERTY_FIELD_NAMES, "merged_into"}
LISTING_IDENTITY_UPDATE_FIELDS = {
    "property",
    "source",
    "state",
    "source_reference",
    "source_claims",
}


def _dispatch_focused_measurement(property_id: uuid.UUID) -> None:
    from .tasks import measure_property_match_candidates

    key = FOCUSED_MEASUREMENT_KEY.format(property_id=property_id)
    if not cache.add(key, True, timeout=FOCUSED_MEASUREMENT_TIMEOUT):
        cache.set(
            FOCUSED_MEASUREMENT_DIRTY_KEY.format(property_id=property_id),
            True,
            timeout=FOCUSED_MEASUREMENT_TIMEOUT,
        )
        return
    try:
        measure_property_match_candidates.delay(property_id=str(property_id), limit=100)
    except Exception:
        cache.delete(key)
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
    if (
        raw
        or created
        or (
            update_fields is not None
            and not PROPERTY_IDENTITY_UPDATE_FIELDS.intersection(update_fields)
        )
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
def sync_listing_image_perceptual_buckets(
    sender: type[ListingImage],
    instance: ListingImage,
    raw: bool = False,
    **_kwargs: object,
) -> None:
    del sender
    if raw:
        return
    instance.perceptual_buckets.all().delete()
    if len(instance.perceptual_dhash) != 16:
        return
    ListingImagePerceptualBucket.objects.bulk_create([
        ListingImagePerceptualBucket(image=instance, position=position, value=value)
        for position, value in enumerate(instance.perceptual_dhash)
    ])


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
