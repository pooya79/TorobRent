from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import MediaAsset


@receiver(post_delete, sender=MediaAsset)
def delete_media_asset_file(
    sender: type[MediaAsset], instance: MediaAsset, **_kwargs: object
) -> None:
    del sender
    if instance.file.name:
        storage = instance.file.storage
        file_name = instance.file.name
        transaction.on_commit(lambda: storage.delete(file_name))
