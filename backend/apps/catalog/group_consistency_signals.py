from __future__ import annotations

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from .curation.group_consistency import (
    GROUP_LISTING_UPDATE_FIELDS,
    GROUP_PROPERTY_UPDATE_FIELDS,
    invalidate_group_consistency,
)
from .models import Listing, ListingGroupingEvent, ListingImage, Property


@receiver(post_save, sender=Property)
def invalidate_property_consistency(
    sender: type[Property],
    instance: Property,
    created: bool,
    update_fields: frozenset[str] | None = None,
    raw: bool = False,
    **_kwargs: object,
) -> None:
    del sender
    if raw or created:
        return
    if update_fields is None or GROUP_PROPERTY_UPDATE_FIELDS.intersection(update_fields):
        invalidate_group_consistency({instance.pk})


@receiver(pre_save, sender=Listing)
def remember_listing_property(
    sender: type[Listing], instance: Listing, raw: bool = False, **_kwargs: object
) -> None:
    del sender
    if raw or instance._state.adding:
        return
    instance._previous_consistency_property_id = (  # type: ignore[attr-defined]
        Listing.objects.filter(pk=instance.pk).values_list("property_id", flat=True).first()
    )


@receiver(post_save, sender=Listing)
def invalidate_listing_consistency(
    sender: type[Listing],
    instance: Listing,
    created: bool,
    update_fields: frozenset[str] | None = None,
    raw: bool = False,
    **_kwargs: object,
) -> None:
    del sender
    if raw:
        return
    if (
        not created
        and update_fields is not None
        and not GROUP_LISTING_UPDATE_FIELDS.intersection(update_fields)
    ):
        return
    property_ids = {instance.property_id}
    previous = getattr(instance, "_previous_consistency_property_id", None)
    if previous is not None:
        property_ids.add(previous)
    invalidate_group_consistency(property_ids)


@receiver(post_delete, sender=Listing)
def invalidate_deleted_listing_consistency(
    sender: type[Listing], instance: Listing, **_kwargs: object
) -> None:
    del sender
    invalidate_group_consistency({instance.property_id})


@receiver(post_save, sender=ListingImage)
@receiver(post_delete, sender=ListingImage)
def invalidate_listing_image_consistency(
    sender: type[ListingImage], instance: ListingImage, raw: bool = False, **_kwargs: object
) -> None:
    del sender
    if not raw:
        invalidate_group_consistency({instance.listing.property_id})


@receiver(post_save, sender=ListingGroupingEvent)
@receiver(post_delete, sender=ListingGroupingEvent)
def invalidate_grouping_event_consistency(
    sender: type[ListingGroupingEvent],
    instance: ListingGroupingEvent,
    raw: bool = False,
    **_kwargs: object,
) -> None:
    del sender
    if not raw:
        invalidate_group_consistency({instance.from_property_id, instance.to_property_id})
