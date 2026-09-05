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


@shared_task(soft_time_limit=240, time_limit=300)  # type: ignore[untyped-decorator]
def cleanup_external_images() -> int:
    from .media_retention import cleanup_external_images as cleanup

    return cleanup()


@shared_task(
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
    soft_time_limit=240,
    time_limit=300,
    acks_late=True,
    reject_on_worker_lost=True,
)  # type: ignore[untyped-decorator]
def process_run_images(run_id: str) -> None:
    from .external_media import stage_run_images

    stage_run_images(run_id)


@shared_task(
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
    soft_time_limit=240,
    time_limit=300,
    acks_late=True,
    reject_on_worker_lost=True,
)  # type: ignore[untyped-decorator]
def process_discovery_images(reservation_id: str) -> None:
    from .external_media import stage_discovery_images
    from .models import SourceReservation

    stage_discovery_images(SourceReservation.objects.get(pk=reservation_id))


@shared_task(soft_time_limit=240, time_limit=300)  # type: ignore[untyped-decorator]
def cleanup_source_snapshots(*, batch_size: int = 200) -> int:
    from .snapshot_retention import cleanup_source_snapshots as cleanup

    return cleanup(batch_size=batch_size)
