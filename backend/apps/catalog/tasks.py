from dataclasses import asdict

from celery import shared_task

from .image_evidence import backfill_listing_image_hashes
from .services import expire_listings


@shared_task  # type: ignore[untyped-decorator]
def expire_due_listings() -> int:
    return expire_listings()


@shared_task  # type: ignore[untyped-decorator]
def backfill_listing_image_identity(
    *, limit: int = 100, after_id: str | None = None
) -> dict[str, int | str | None]:
    return asdict(backfill_listing_image_hashes(limit=limit, after_id=after_id))
