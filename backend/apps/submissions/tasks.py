from celery import shared_task

from .services import (
    cleanup_abandoned_images,
    deliver_decision_notification,
    dispatch_pending_decision_notifications,
    process_image,
)


@shared_task(  # type: ignore[untyped-decorator]
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def process_submission_image(image_id: str) -> None:
    process_image(image_id)


@shared_task(  # type: ignore[untyped-decorator]
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def deliver_submission_decision_notification(notification_id: str) -> None:
    deliver_decision_notification(notification_id)


@shared_task  # type: ignore[untyped-decorator]
def dispatch_pending_submission_decision_notifications() -> int:
    return dispatch_pending_decision_notifications()


@shared_task  # type: ignore[untyped-decorator]
def cleanup_abandoned_submission_images() -> int:
    return cleanup_abandoned_images()
