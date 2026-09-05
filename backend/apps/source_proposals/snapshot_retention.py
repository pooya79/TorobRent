"""Expire temporary review input without deleting durable extraction evidence."""

from django.utils import timezone

from .models import SourceProfileSnapshots


def cleanup_source_snapshots(*, batch_size: int = 200) -> int:
    ids = list(
        SourceProfileSnapshots.objects
        .filter(expires_at__lte=timezone.now())
        .order_by("expires_at", "pk")
        .values_list("pk", flat=True)[: max(0, min(batch_size, 200))]
    )
    deleted, _ = SourceProfileSnapshots.objects.filter(pk__in=ids).delete()
    return deleted
