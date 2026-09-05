from django.db.models.deletion import ProtectedError
from django.db.models.signals import post_delete, pre_delete
from django.dispatch import receiver

from apps.common.media import schedule_asset_cleanup
from apps.common.models import MediaAsset

from .models import SubmissionImage, SubmissionImageVariant
from .services import schedule_file_cleanup


@receiver(pre_delete, sender=MediaAsset)
def protect_legacy_variant_file_reference(
    sender: type[MediaAsset], instance: MediaAsset, **_kwargs: object
) -> None:
    del sender
    if (
        instance.file.name
        and SubmissionImageVariant.objects.filter(
            asset__isnull=True,
            file=instance.file.name,
        ).exists()
    ):
        raise ProtectedError(
            "Media Asset file is still referenced by a legacy Submission image variant.",
            {instance},
        )


@receiver(post_delete, sender=SubmissionImage)
def delete_submission_image_source(
    sender: type[SubmissionImage], instance: SubmissionImage, **_kwargs: object
) -> None:
    del sender
    if instance.source.name:
        schedule_file_cleanup([(instance.source.storage, instance.source.name)])


@receiver(post_delete, sender=SubmissionImageVariant)
def delete_image_variant_asset(
    sender: type[SubmissionImageVariant],
    instance: SubmissionImageVariant,
    **_kwargs: object,
) -> None:
    del sender
    if instance.asset_id is not None:
        schedule_asset_cleanup(instance.asset_id)
    elif instance.file.name:
        schedule_file_cleanup([(instance.file.storage, instance.file.name)])
