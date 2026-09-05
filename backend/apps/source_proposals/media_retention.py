"""Retire bytes while preserving candidate provenance and processing evidence."""

from datetime import timedelta
from functools import partial

from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from apps.catalog.models import Listing, ListingState, Source
from apps.common.media import schedule_asset_cleanup
from apps.common.models import MediaAsset

from .external_media import cleanup_owned_image_files
from .models import CandidateImage


def cleanup_external_images(*, batch_size: int = 200) -> int:
    retired = 0
    images = list(
        CandidateImage.objects.order_by(
            F("retention_checked_at").asc(nulls_first=True), "created_at", "pk"
        ).values_list("pk", "candidate__source_id")[: max(0, min(batch_size, 200))]
    )
    for image_id, source_id in images:
        with transaction.atomic():
            Source.objects.select_for_update().get(pk=source_id)
            image = CandidateImage.objects.select_for_update().get(pk=image_id)
            image.retention_checked_at = timezone.now()
            image.save(update_fields=("retention_checked_at",))
            if image.state == "retired":
                cleanup_owned_image_files(image)
                continue
            assets = MediaAsset.objects.filter(candidate_variants__image=image)
            referenced = assets.filter(
                Q(listing_variants__image__listing__in=Listing.objects.active())
                | Q(property_variants__isnull=False)
            ).exists()
            if referenced:
                if image.unreferenced_at is not None:
                    image.unreferenced_at = None
                    image.save(update_fields=("unreferenced_at",))
                continue
            now = timezone.now()
            if image.unreferenced_at is None:
                withdrawn_at = now
                if image.listing_image is not None:
                    listing = image.listing_image.listing
                    if listing.state != ListingState.PUBLISHED:
                        withdrawn_at = min(now, listing.updated_at)
                    elif listing.available_until and listing.available_until < now:
                        withdrawn_at = listing.available_until
                image.unreferenced_at = withdrawn_at
                image.save(update_fields=("unreferenced_at",))
            if image.unreferenced_at > now - timedelta(days=30):
                continue
            asset_ids = list(assets.values_list("pk", flat=True))
            if image.listing_image is not None:
                image.listing_image.delete()
                image.listing_image = None
            image.variants.update(asset=None)
            image.state = "retired"
            image.is_primary = False
            image.save()
            for asset_id in asset_ids:
                schedule_asset_cleanup(asset_id)
            transaction.on_commit(partial(cleanup_owned_image_files, image))
            retired += 1
    return retired
