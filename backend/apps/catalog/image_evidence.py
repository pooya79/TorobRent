"""Deterministic image identity evidence for source-specific Listing Images."""

import logging
from dataclasses import dataclass
from uuid import UUID

from django.db.models import Q

from apps.common.media import compute_image_identity

from .models import ListingImage

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class HashBackfillBatch:
    inspected: int
    updated: int
    next_cursor: str | None


def backfill_listing_image_hashes(
    *, limit: int = 100, after_id: UUID | str | None = None
) -> HashBackfillBatch:
    """Fill at most ``limit`` legacy Listing Images from their largest retained variant."""

    if not 1 <= limit <= 1_000:
        raise ValueError("limit must be between 1 and 1000")
    missing_hashes = ListingImage.objects.filter(
        Q(raw_content_sha256="") | Q(normalized_pixel_sha256="") | Q(perceptual_dhash="")
    )
    if after_id is not None:
        missing_hashes = missing_hashes.filter(id__gt=after_id)
    images = list(missing_hashes.prefetch_related("variants__asset").order_by("id")[:limit])
    updated = 0
    for image in images:
        variants = [variant for variant in image.variants.all() if variant.asset.file.name]
        if not variants:
            continue
        variant = max(variants, key=lambda item: (item.asset.width, item.asset.height, item.kind))
        try:
            with variant.asset.file.open("rb") as retained_file:
                identity = compute_image_identity(retained_file.read())
        except Exception:
            logger.exception(
                "Listing image hash backfill failed",
                extra={"listing_image_id": str(image.id)},
            )
            continue
        changes = {}
        if not image.raw_content_sha256:
            changes["raw_content_sha256"] = identity.raw_content_sha256
        if not image.normalized_pixel_sha256:
            changes["normalized_pixel_sha256"] = identity.normalized_pixel_sha256
        if not image.perceptual_dhash:
            changes["perceptual_dhash"] = identity.perceptual_dhash
        if changes:
            ListingImage.objects.filter(id=image.id).update(**changes)
            updated += 1
    return HashBackfillBatch(
        inspected=len(images),
        updated=updated,
        next_cursor=str(images[-1].id) if images else None,
    )
