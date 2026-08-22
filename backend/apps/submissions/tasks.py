from celery import shared_task

from .services import cleanup_abandoned_images, process_image


@shared_task(  # type: ignore[untyped-decorator]
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def process_submission_image(image_id: str) -> None:
    process_image(image_id)


@shared_task  # type: ignore[untyped-decorator]
def cleanup_abandoned_submission_images() -> int:
    return cleanup_abandoned_images()
