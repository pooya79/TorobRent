from celery import shared_task


@shared_task(soft_time_limit=600, time_limit=660)  # type: ignore[untyped-decorator]
def discover_source(reservation_id: str) -> None:
    from .discovery_workflow import run_discovery

    run_discovery(reservation_id)


@shared_task  # type: ignore[untyped-decorator]
def expire_source_reservations() -> None:
    from .discovery_workflow import expire_reservations

    expire_reservations()
