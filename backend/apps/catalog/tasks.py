from celery import shared_task

from .services import expire_listings


@shared_task  # type: ignore[untyped-decorator]
def expire_due_listings() -> int:
    return expire_listings()
