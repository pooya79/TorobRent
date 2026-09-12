import hashlib
import logging
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from io import BytesIO
from uuid import UUID

from django.core.files.base import ContentFile
from django.core.files.storage import Storage
from django.db import models, transaction
from django.db.models.deletion import ProtectedError
from PIL import Image, ImageOps

from .models import MediaAsset

logger = logging.getLogger(__name__)

ALLOWED_IMAGE_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})
PROCESSING_FAILURE_REASON = "پردازش تصویر ناموفق بود. فایل را جایگزین و دوباره تلاش کنید."
ROLLBACK_ATTEMPTS = 3


class MediaVariantKind(models.TextChoices):
    SMALL = "small", "کوچک"
    MEDIUM = "medium", "متوسط"
    LARGE = "large", "بزرگ"


RESPONSIVE_IMAGE_WIDTHS = {
    MediaVariantKind.SMALL: 480,
    MediaVariantKind.MEDIUM: 960,
    MediaVariantKind.LARGE: 1440,
}

PILLOW_DECOMPRESSION_BOMB_PIXEL_LIMIT = (
    Image.MAX_IMAGE_PIXELS * 2 if Image.MAX_IMAGE_PIXELS is not None else None
)


@dataclass(frozen=True)
class ImageProcessingLimits:
    max_bytes: int = 10 * 1024 * 1024
    max_pixels: int | None = PILLOW_DECOMPRESSION_BOMB_PIXEL_LIMIT


class ImageProcessingStatus(StrEnum):
    READY = "ready"
    FAILED = "failed"


@dataclass(frozen=True)
class FirstPartyImageInput:
    """A stored input image and the naming policy for its first-party variants."""

    storage: Storage
    input_key: str
    variant_key: Callable[[MediaVariantKind], str]


@dataclass(frozen=True)
class ProcessedVariantAsset:
    kind: MediaVariantKind
    file_name: str
    width: int
    height: int
    byte_size: int


@dataclass(frozen=True)
class ImageIdentity:
    raw_content_sha256: str
    normalized_pixel_sha256: str
    perceptual_dhash: str

    def perceptual_distance(self, other: ImageIdentity) -> int:
        return perceptual_hash_distance(self.perceptual_dhash, other.perceptual_dhash)


def perceptual_hash_distance(left: str, right: str) -> int:
    return (int(left, 16) ^ int(right, 16)).bit_count()


@dataclass(frozen=True)
class ImageProcessingResult:
    status: ImageProcessingStatus
    variants: tuple[ProcessedVariantAsset, ...] = ()
    identity: ImageIdentity | None = None
    failure_reason: str = ""


def _image_identity(encoded: bytes, corrected: Image.Image) -> ImageIdentity:
    normalized = hashlib.sha256()
    normalized.update(corrected.width.to_bytes(4, "big"))
    normalized.update(corrected.height.to_bytes(4, "big"))
    normalized.update(corrected.tobytes())

    grayscale = corrected.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    pixels = grayscale.tobytes()
    difference_bits = 0
    for row in range(8):
        for column in range(8):
            difference_bits = (difference_bits << 1) | int(
                pixels[row * 9 + column] > pixels[row * 9 + column + 1]
            )
    return ImageIdentity(
        raw_content_sha256=hashlib.sha256(encoded).hexdigest(),
        normalized_pixel_sha256=normalized.hexdigest(),
        perceptual_dhash=f"{difference_bits:016x}",
    )


def compute_image_identity(encoded: bytes) -> ImageIdentity:
    """Measure encoded and visual identity without external services or mutable state."""

    with Image.open(BytesIO(encoded)) as uploaded:
        corrected = ImageOps.exif_transpose(uploaded).convert("RGB")
    return _image_identity(encoded, corrected)


def schedule_asset_cleanup(asset_id: UUID) -> None:
    """Delete an asset after commit when its last protected reference has gone."""

    transaction.on_commit(lambda: _delete_orphaned_asset(asset_id))


def _delete_orphaned_asset(asset_id: UUID) -> None:
    try:
        MediaAsset.objects.get(id=asset_id).delete()
    except MediaAsset.DoesNotExist, ProtectedError:
        return


def _render_variant(source: Image.Image, width: int) -> tuple[ContentFile[bytes], int, int]:
    variant = source.copy()
    variant.thumbnail((width, width * 4), Image.Resampling.LANCZOS)
    output = BytesIO()
    variant.save(output, format="WEBP", quality=82, method=6, optimize=True)
    return ContentFile(output.getvalue()), variant.width, variant.height


def _rollback_files(storage: Storage, file_names: list[str]) -> None:
    for file_name in file_names:
        for attempt in range(ROLLBACK_ATTEMPTS):
            try:
                storage.delete(file_name)
                break
            except Exception:
                logger.exception(
                    "First-party image rollback failed",
                    extra={"file_name": file_name, "attempt": attempt + 1},
                )


def process_first_party_image(
    image_input: FirstPartyImageInput, *, limits: ImageProcessingLimits | None = None
) -> ImageProcessingResult:
    """Create responsive first-party assets without depending on a referencing domain model."""

    written_files: list[str] = []
    limits = limits or ImageProcessingLimits()
    try:
        if image_input.storage.size(image_input.input_key) > limits.max_bytes:
            raise ValueError("Encoded image exceeds its byte limit.")
        with (
            image_input.storage.open(image_input.input_key, "rb") as input_file,
        ):
            encoded = input_file.read()
        with Image.open(BytesIO(encoded)) as uploaded:
            if uploaded.format not in ALLOWED_IMAGE_FORMATS:
                raise ValueError("Unsupported decoded image format.")
            if (
                limits.max_pixels is not None
                and uploaded.width * uploaded.height > limits.max_pixels
            ):
                raise ValueError("Decoded image exceeds its pixel limit.")
            corrected = ImageOps.exif_transpose(uploaded).convert("RGB")
        identity = _image_identity(encoded, corrected)

        variants: list[ProcessedVariantAsset] = []
        for kind, width in RESPONSIVE_IMAGE_WIDTHS.items():
            content, rendered_width, rendered_height = _render_variant(corrected, width)
            file_name = image_input.storage.save(image_input.variant_key(kind), content)
            written_files.append(file_name)
            variants.append(
                ProcessedVariantAsset(
                    kind=kind,
                    file_name=file_name,
                    width=rendered_width,
                    height=rendered_height,
                    byte_size=content.size,
                )
            )
        return ImageProcessingResult(
            status=ImageProcessingStatus.READY,
            variants=tuple(variants),
            identity=identity,
        )
    except Exception:
        logger.exception(
            "First-party image processing failed", extra={"input_key": image_input.input_key}
        )
        _rollback_files(image_input.storage, written_files)
        return ImageProcessingResult(
            status=ImageProcessingStatus.FAILED,
            failure_reason=PROCESSING_FAILURE_REASON,
        )
