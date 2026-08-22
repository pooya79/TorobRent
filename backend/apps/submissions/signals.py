from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import SubmissionImage, SubmissionImageVariant
from .services import schedule_file_cleanup


@receiver(post_delete, sender=SubmissionImage)
def delete_submission_image_source(
    sender: type[SubmissionImage], instance: SubmissionImage, **_kwargs: object
) -> None:
    del sender
    if instance.source.name:
        schedule_file_cleanup([(instance.source.storage, instance.source.name)])


@receiver(post_delete, sender=SubmissionImageVariant)
def delete_submission_image_variant(
    sender: type[SubmissionImageVariant], instance: SubmissionImageVariant, **_kwargs: object
) -> None:
    del sender
    if instance.file.name:
        schedule_file_cleanup([(instance.file.storage, instance.file.name)])
