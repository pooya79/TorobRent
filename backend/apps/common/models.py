import uuid

from django.db import models


class MediaAsset(models.Model):
    """A processed first-party file shared by referencing domain records."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    file = models.FileField(max_length=500, unique=True)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    byte_size = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "submissions_mediaasset"

    def __str__(self) -> str:
        return self.file.name or ""
