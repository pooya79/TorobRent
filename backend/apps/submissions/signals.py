from django.db.models.signals import post_delete
from django.dispatch import receiver

from apps.catalog.models import ListingImageVariant, PropertyImageVariant

from .models import (
    MediaAsset,
    SubmissionImage,
    SubmissionImageVariant,
)
from .services import schedule_asset_cleanup, schedule_file_cleanup


@receiver(post_delete, sender=SubmissionImage)
def delete_submission_image_source(
    sender: type[SubmissionImage], instance: SubmissionImage, **_kwargs: object
) -> None:
    del sender
    if instance.source.name:
        schedule_file_cleanup([(instance.source.storage, instance.source.name)])


@receiver(post_delete, sender=SubmissionImageVariant)
@receiver(post_delete, sender=ListingImageVariant)
@receiver(post_delete, sender=PropertyImageVariant)
def delete_image_variant_asset(
    sender: type[SubmissionImageVariant] | type[ListingImageVariant] | type[PropertyImageVariant],
    instance: SubmissionImageVariant | ListingImageVariant | PropertyImageVariant,
    **_kwargs: object,
) -> None:
    del sender
    if instance.asset_id is not None:
        schedule_asset_cleanup(instance.asset_id)
    elif isinstance(instance, SubmissionImageVariant) and instance.file.name:
        schedule_file_cleanup([(instance.file.storage, instance.file.name)])


@receiver(post_delete, sender=MediaAsset)
def delete_media_asset_file(
    sender: type[MediaAsset], instance: MediaAsset, **_kwargs: object
) -> None:
    del sender
    if instance.file.name:
        schedule_file_cleanup([(instance.file.storage, instance.file.name)])
