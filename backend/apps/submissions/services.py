import logging
from datetime import timedelta
from io import BytesIO
from uuid import UUID

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile, File
from django.core.files.storage import Storage
from django.core.files.uploadedfile import UploadedFile
from django.db import models, transaction
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError

from .models import (
    Submission,
    SubmissionImage,
    SubmissionImageStatus,
    SubmissionImageVariant,
    SubmissionImageVariantKind,
    SubmissionStep,
)

ALLOWED_IMAGE_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})
VARIANT_WIDTHS = {
    SubmissionImageVariantKind.SMALL: 480,
    SubmissionImageVariantKind.MEDIUM: 960,
    SubmissionImageVariantKind.LARGE: 1440,
}
MAX_SUBMISSION_IMAGES = 12
PROCESSING_FAILURE_REASON = "پردازش تصویر ناموفق بود. فایل را جایگزین و دوباره تلاش کنید."

logger = logging.getLogger(__name__)


def validate_image_upload(upload: UploadedFile[bytes]) -> None:
    if upload.size > settings.SUBMISSION_IMAGE_MAX_BYTES:
        raise ValidationError(
            "هر تصویر باید حداکثر "
            f"{settings.SUBMISSION_IMAGE_MAX_BYTES // (1024 * 1024)} مگابایت باشد."
        )
    try:
        image = Image.open(upload)
        image.verify()
        image_format = image.format
    except UnidentifiedImageError, OSError, SyntaxError:
        raise ValidationError("فایل بارگذاری‌شده یک تصویر معتبر نیست.") from None
    finally:
        upload.seek(0)
    if image_format not in ALLOWED_IMAGE_FORMATS:
        raise ValidationError("فقط تصویرهای JPEG، PNG و WebP پذیرفته می‌شوند.")


@transaction.atomic
def add_submission_image(*, submission: Submission, upload: UploadedFile[bytes]) -> SubmissionImage:
    validate_image_upload(upload)
    submission = Submission.objects.select_for_update().get(id=submission.id)
    position = submission.images.count()
    if position >= MAX_SUBMISSION_IMAGES:
        raise ValidationError("هر Submission می‌تواند حداکثر ۱۲ تصویر داشته باشد.")
    if submission.media_complete:
        submission.media_complete = False
        submission.save(update_fields=("media_complete", "updated_at"))
    image = SubmissionImage.objects.create(
        submission=submission,
        source=upload,
        position=position,
        is_primary=position == 0,
    )
    from .tasks import process_submission_image

    transaction.on_commit(lambda: process_submission_image.delay(str(image.id)))
    return image


def _file_is_referenced(name: str) -> bool:
    return (
        SubmissionImage.objects.filter(source=name).exists()
        or SubmissionImageVariant.objects.filter(file=name).exists()
    )


def _delete_unreferenced_files(files: list[tuple[Storage, str]]) -> None:
    for storage, name in files:
        if name and not _file_is_referenced(name):
            storage.delete(name)


def _image_files(image: SubmissionImage) -> list[tuple[Storage, str]]:
    files: list[tuple[Storage, str]] = []
    if image.source.name:
        files.append((image.source.storage, image.source.name))
    for variant in image.variants.all():
        if variant.file.name:
            files.append((variant.file.storage, variant.file.name))
    return files


def schedule_file_cleanup(files: list[tuple[Storage, str]]) -> None:
    transaction.on_commit(lambda: _delete_unreferenced_files(files))


@transaction.atomic
def reorder_submission_images(
    *, submission: Submission, image_ids: list[UUID], primary_image_id: UUID
) -> list[SubmissionImage]:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    images = list(submission.images.select_for_update())
    current_ids = {image.id for image in images}
    requested_ids = set(image_ids)
    if len(image_ids) != len(requested_ids) or requested_ids != current_ids:
        raise ValidationError("ترتیب باید دقیقاً شامل همه تصویرهای این Submission باشد.")
    if primary_image_id not in requested_ids:
        raise ValidationError("تصویر اصلی باید یکی از تصویرهای همین Submission باشد.")
    submission.images.update(position=models.F("position") + MAX_SUBMISSION_IMAGES)
    submission.images.update(is_primary=False)
    for position, image_id in enumerate(image_ids):
        submission.images.filter(id=image_id).update(
            position=position,
            is_primary=image_id == primary_image_id,
        )
    return list(submission.images.prefetch_related("variants"))


def submission_media_is_complete(submission: Submission) -> bool:
    image_count = submission.images.count()
    return (
        1 <= image_count <= MAX_SUBMISSION_IMAGES
        and submission.images.filter(status=SubmissionImageStatus.READY).count() == image_count
        and submission.images.filter(is_primary=True).count() == 1
    )


@transaction.atomic
def complete_submission_media_step(*, submission: Submission) -> Submission:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    if not submission_media_is_complete(submission):
        image_count = submission.images.count()
        if not 1 <= image_count <= MAX_SUBMISSION_IMAGES:
            raise ValidationError("برای ادامه، بین یک تا دوازده تصویر لازم است.")
        if submission.images.filter(status=SubmissionImageStatus.READY).count() != image_count:
            raise ValidationError("پردازش همه تصویرها باید با موفقیت تمام شود.")
        raise ValidationError("دقیقاً یک تصویر اصلی انتخاب کنید.")
    submission.media_complete = True
    if submission.current_step != SubmissionStep.REVIEW:
        submission.current_step = SubmissionStep.CONTACT
    submission.save(update_fields=("media_complete", "current_step", "updated_at"))
    return submission


def ensure_submission_media_complete(*, submission: Submission) -> None:
    if not submission.media_complete or not submission_media_is_complete(submission):
        raise ValidationError("مرحله تصاویر را پیش از بازبینی کامل کنید.")


@transaction.atomic
def remove_submission_image(*, submission: Submission, image_id: UUID | str) -> None:
    submission = Submission.objects.select_for_update().get(id=submission.id)
    image = submission.images.select_for_update().get(id=image_id)
    files = _image_files(image)
    removed_primary = image.is_primary
    image.delete()
    remaining = list(submission.images.order_by("position"))
    submission.images.update(position=models.F("position") + MAX_SUBMISSION_IMAGES)
    if removed_primary and remaining:
        submission.images.update(is_primary=False)
    for position, remaining_image in enumerate(remaining):
        submission.images.filter(id=remaining_image.id).update(
            position=position,
            is_primary=True if removed_primary and position == 0 else remaining_image.is_primary,
        )
    submission.media_complete = submission_media_is_complete(submission)
    submission.save(update_fields=("media_complete", "updated_at"))
    schedule_file_cleanup(files)


def cleanup_abandoned_images() -> int:
    cutoff = timezone.now() - timedelta(hours=settings.SUBMISSION_ABANDONED_IMAGE_HOURS)
    temporary_statuses = (
        SubmissionImageStatus.PENDING,
        SubmissionImageStatus.PROCESSING,
        SubmissionImageStatus.FAILED,
    )
    candidate_ids = list(
        SubmissionImage.objects.filter(
            status__in=temporary_statuses,
            updated_at__lt=cutoff,
        ).values_list("id", flat=True)
    )
    removed = 0
    for image_id in candidate_ids:
        with transaction.atomic():
            image = (
                SubmissionImage.objects
                .select_for_update()
                .select_related("submission")
                .filter(
                    id=image_id,
                    status__in=temporary_statuses,
                    updated_at__lt=cutoff,
                )
                .first()
            )
            if image is None:
                continue
            remove_submission_image(submission=image.submission, image_id=image.id)
            removed += 1
    return removed


@transaction.atomic
def retry_submission_image(
    *, image: SubmissionImage, upload: UploadedFile[bytes]
) -> SubmissionImage:
    validate_image_upload(upload)
    image = (
        SubmissionImage.objects.select_for_update().select_related("submission").get(id=image.id)
    )
    if image.status != SubmissionImageStatus.FAILED:
        raise ValidationError("فقط پردازش ناموفق را می‌توان دوباره تلاش کرد.")
    superseded_files = _image_files(image)
    image.variants.all().delete()
    image.source.save("source.upload", upload, save=False)
    image.status = SubmissionImageStatus.PENDING
    image.failure_reason = ""
    image.processed_at = None
    image.save()
    if image.submission.media_complete:
        image.submission.media_complete = False
        image.submission.save(update_fields=("media_complete", "updated_at"))
    schedule_file_cleanup(superseded_files)
    from .tasks import process_submission_image

    transaction.on_commit(lambda: process_submission_image.delay(str(image.id)))
    return image


def _render_variant(source: Image.Image, width: int) -> tuple[ContentFile[bytes], int, int, int]:
    variant = source.copy()
    variant.thumbnail((width, width * 4), Image.Resampling.LANCZOS)
    output = BytesIO()
    variant.save(output, format="WEBP", quality=82, method=6, optimize=True)
    content = output.getvalue()
    return ContentFile(content), variant.width, variant.height, len(content)


def _open_source(image: SubmissionImage) -> File[bytes]:
    if not image.source.name:
        raise ValueError("تصویر منبع برای پردازش موجود نیست.")
    return image.source.storage.open(image.source.name, "rb")


def process_image(image_id: str) -> None:
    with transaction.atomic():
        image = SubmissionImage.objects.select_for_update().get(id=image_id)
        if image.status == SubmissionImageStatus.READY:
            return
        image.status = SubmissionImageStatus.PROCESSING
        image.failure_reason = ""
        image.save(update_fields=("status", "failure_reason", "updated_at"))
    try:
        with _open_source(image) as source_file, Image.open(source_file) as uploaded:
            corrected = ImageOps.exif_transpose(uploaded).convert("RGB")
            rendered = {
                kind: _render_variant(corrected, width) for kind, width in VARIANT_WIDTHS.items()
            }
    except Exception:
        logger.exception("Submission image rendering failed", extra={"image_id": image_id})
        _mark_image_failed(image_id)
        return

    written_files: list[tuple[Storage, str]] = []
    try:
        with transaction.atomic():
            image = SubmissionImage.objects.select_for_update().get(id=image_id)
            if image.status == SubmissionImageStatus.READY:
                return
            image.variants.all().delete()
            for kind, (content, width, height, byte_size) in rendered.items():
                variant = SubmissionImageVariant(
                    image=image,
                    kind=kind,
                    width=width,
                    height=height,
                    byte_size=byte_size,
                )
                variant.file.save(f"{kind}.webp", content, save=False)
                if variant.file.name:
                    written_files.append((variant.file.storage, variant.file.name))
                variant.save()
            image.status = SubmissionImageStatus.READY
            image.processed_at = timezone.now()
            cleanup_files = [(image.source.storage, image.source.name)] if image.source.name else []
            image.source = ""
            image.save(update_fields=("source", "status", "processed_at", "updated_at"))
            schedule_file_cleanup(cleanup_files)
    except Exception:
        logger.exception("Submission image persistence failed", extra={"image_id": image_id})
        _delete_unreferenced_files(written_files)
        _mark_image_failed(image_id)


@transaction.atomic
def _mark_image_failed(image_id: str) -> None:
    image = SubmissionImage.objects.select_for_update().get(id=image_id)
    if image.status == SubmissionImageStatus.READY:
        return
    image.status = SubmissionImageStatus.FAILED
    image.failure_reason = PROCESSING_FAILURE_REASON
    image.processed_at = None
    image.save(update_fields=("status", "failure_reason", "processed_at", "updated_at"))
