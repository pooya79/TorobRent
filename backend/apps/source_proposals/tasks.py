from typing import Any

from celery import shared_task


@shared_task(soft_time_limit=600, time_limit=660)  # type: ignore[untyped-decorator]
def discover_source(reservation_id: str) -> None:
    from .discovery_workflow import run_discovery

    run_discovery(reservation_id)


@shared_task  # type: ignore[untyped-decorator]
def expire_source_reservations() -> None:
    from .discovery_workflow import expire_reservations

    expire_reservations()


@shared_task(
    bind=True,
    max_retries=3,
    soft_time_limit=600,
    time_limit=660,
    acks_late=True,
    reject_on_worker_lost=True,
)  # type: ignore[untyped-decorator]
def extract_source(self: Any, request_id: str) -> None:
    from .extraction import run_extraction

    if run_extraction(request_id):
        raise self.retry(countdown=720)
