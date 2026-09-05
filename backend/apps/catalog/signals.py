from django.db.models.signals import post_delete
from django.dispatch import receiver

from apps.common.media import schedule_asset_cleanup

from .models import ListingImageVariant, PropertyImageVariant


@receiver(post_delete, sender=ListingImageVariant)
@receiver(post_delete, sender=PropertyImageVariant)
def delete_catalog_image_variant_asset(
    sender: type[ListingImageVariant] | type[PropertyImageVariant],
    instance: ListingImageVariant | PropertyImageVariant,
    **_kwargs: object,
) -> None:
    del sender
    schedule_asset_cleanup(instance.asset_id)
