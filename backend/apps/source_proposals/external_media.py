"""Candidate-owned first-party media; optional failures never invalidate rental facts."""

import hashlib
from collections.abc import Sequence
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from apps.accounts.models import User

    from .models import SourceReservation

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone

from apps.common.media import (
    FirstPartyImageInput,
    ImageProcessingLimits,
    process_first_party_image,
    schedule_asset_cleanup,
)
from apps.common.models import MediaAsset
from apps.source_extraction.fetching import (
    MAX_SOURCE_IMAGES,
    HttpTransport,
    Resolver,
    SourceImageFetcher,
)

from .models import CandidateImage, CandidateImageVariant, ExternalListingCandidate


def stage_candidate_images(
    candidate: ExternalListingCandidate,
    urls: Sequence[str],
    *,
    transport: HttpTransport | None = None,
    resolver: Resolver | None = None,
) -> None:
    for order, url in enumerate(urls[:MAX_SOURCE_IMAGES]):
        image, _ = CandidateImage.objects.get_or_create(
            candidate=candidate,
            source_order=order,
            defaults={"original_url": url, "position": order},
        )
        process_candidate_image(str(image.pk), transport=transport, resolver=resolver)


@transaction.atomic
def process_candidate_image(
    image_id: str, *, transport: HttpTransport | None = None, resolver: Resolver | None = None
) -> None:
    from apps.catalog.models import Source

    initial = CandidateImage.objects.get(pk=image_id)
    Source.objects.select_for_update().get(pk=initial.candidate.source_id)
    candidate = ExternalListingCandidate.objects.select_for_update().get(pk=initial.candidate_id)
    image = CandidateImage.objects.select_for_update().get(pk=image_id)
    if image.state != "pending":
        return
    url = image.original_url
    from .extraction import authorized

    proposal = candidate.source_proposal
    if candidate.extraction_run is not None:
        approved = authorized(candidate.extraction_run.request)
    else:
        reservations = proposal.reservations.all()
        if candidate.discovery_version is not None:
            reservations = reservations.filter(pk=candidate.discovery_version.reservation_id)
        approved = reservations.filter(
            source=candidate.source,
            revision=proposal.revision,
            released_at__isnull=True,
            expires_at__gt=timezone.now(),
        ).exists()
    if not approved:
        image.state = "failed"
        image.failure_code = "authorization_ended"
        image.unreferenced_at = timezone.now()
        image.save()
        return
    hosts = [
        candidate.source.domain,
        *candidate.source.image_hosts.filter(revoked_at__isnull=True).values_list(
            "host", flat=True
        ),
    ]
    fetcher = SourceImageFetcher(approved_hosts=hosts, transport=transport, resolver=resolver)
    cleanup_owned_image_files(image)
    image.unreferenced_at = timezone.now()
    try:
        record = fetcher.fetch([url]).records[0]
        if record.failure:
            image.failure_code = record.failure.code
        elif record.page is None or record.page.status_code != 200:
            image.failure_code = "http_error"
        else:
            image.content_hash = hashlib.sha256(record.page.body).hexdigest()
            key = default_storage.save(
                f"external-media/{image.pk}/source.upload", ContentFile(record.page.body)
            )
            try:
                result = process_first_party_image(
                    FirstPartyImageInput(
                        default_storage,
                        key,
                        lambda kind: f"external-media/{image.pk}/{kind}.webp",
                    ),
                    limits=ImageProcessingLimits(max_pixels=40_000_000),
                )
            finally:
                default_storage.delete(key)
            if result.status == "failed":
                image.failure_code = "processing_failed"
            else:
                for variant in result.variants:
                    asset = MediaAsset.objects.create(
                        file=variant.file_name,
                        width=variant.width,
                        height=variant.height,
                        byte_size=variant.byte_size,
                    )
                    CandidateImageVariant.objects.create(
                        image=image,
                        kind=variant.kind,
                        asset=asset,
                        width=variant.width,
                        height=variant.height,
                        byte_size=variant.byte_size,
                    )
    except Exception:
        image.failure_code = "processing_failed"
    image.state = "failed" if image.failure_code else "ready"
    image.is_primary = (
        image.state == "ready" and not candidate.images.filter(is_primary=True).exists()
    )
    image.save()
    cleanup_owned_image_files(image)


def review_candidate_images(
    candidate: ExternalListingCandidate, actor: User, choices: list[dict[str, object]]
) -> None:
    from django.core.exceptions import ValidationError

    images = {str(image.pk): image for image in candidate.images.select_for_update()}
    ids = [str(choice["id"]) for choice in choices]
    if len(ids) != len(set(ids)) or set(ids) != set(images):
        raise ValidationError("همه تصاویر همین آگهی را یک بار انتخاب کنید.")
    selected = [
        choice
        for choice in choices
        if not choice["excluded"] and images[str(choice["id"])].state == "ready"
    ]
    if sum(bool(choice["is_primary"]) for choice in selected) != bool(selected):
        raise ValidationError("یک تصویر اصلی انتخاب کنید.")
    candidate.images.update(is_primary=False)
    for position, choice in enumerate(choices):
        image = images[str(choice["id"])]
        if (choice["is_primary"] or choice["accept_as_property"]) and (
            choice["excluded"] or image.state != "ready"
        ):
            raise ValidationError("تصویر ناموفق یا حذف‌شده قابل تأیید نیست.")
        image.position = position
        image.is_primary = bool(choice["is_primary"])
        image.excluded = bool(choice["excluded"])
        image.accepted_by = actor if choice["accept_as_property"] else None
        image.accepted_at = timezone.now() if choice["accept_as_property"] else None
        image.save()
    candidate.corrections["media"] = [{**choice, "id": str(choice["id"])} for choice in choices]


def promote_candidate_images(candidate: ExternalListingCandidate) -> None:
    from apps.catalog.models import (
        ListingImage,
        ListingImageVariant,
        PropertyImage,
        PropertyImageVariant,
    )

    listing = candidate.listing
    assert listing is not None
    # Retain the old staging references for the grace period when a later run replaces images.
    CandidateImage.objects.filter(listing_image__listing=listing).update(
        unreferenced_at=timezone.now()
    )
    listing.images.all().delete()
    for position, image in enumerate(candidate.images.filter(state="ready", excluded=False)):
        image.listing_image = ListingImage.objects.create(
            listing=listing, position=position, is_primary=image.is_primary
        )
        for variant in image.variants.filter(asset__isnull=False):
            assert variant.asset_id is not None
            ListingImageVariant.objects.create(
                image=image.listing_image, kind=variant.kind, asset_id=variant.asset_id
            )
        if image.accepted_at and image.property_image is None:
            from django.db.models import Max

            last = listing.property.images.aggregate(last=Max("position"))["last"]
            image.property_image = PropertyImage.objects.create(
                property=listing.property,
                position=0 if last is None else last + 1,
                is_primary=last is None,
                reviewed_at=image.accepted_at,
                reviewed_by=image.accepted_by,
            )
            for variant in image.variants.filter(asset__isnull=False):
                assert variant.asset_id is not None
                PropertyImageVariant.objects.create(
                    image=image.property_image, kind=variant.kind, asset_id=variant.asset_id
                )
        image.unreferenced_at = None
        image.save()


def stage_discovery_images(reservation: SourceReservation) -> None:
    version = reservation.profile_versions.first()
    if version is None:
        return
    remaining = MAX_SOURCE_IMAGES
    for sample in version.samples:
        urls = sample["normalized"].get("image_urls", [])
        if not isinstance(urls, list | tuple):
            continue
        urls = [url for url in urls if isinstance(url, str)][:remaining]
        if not urls:
            continue
        candidate, _ = ExternalListingCandidate.objects.get_or_create(
            source_proposal=reservation.proposal,
            external_url=sample["canonical_url"],
            discovery_version=version,
            extraction_run=None,
            defaults={
                "source": reservation.source,
                "simulated": False,
                "title": "پیش‌نمایش تصاویر کشف",
            },
        )
        stage_candidate_images(candidate, urls)
        remaining -= len(urls)


def stage_run_images(run_id: str) -> None:
    from apps.catalog.models import Source

    from .models import ExtractionRun

    run = ExtractionRun.objects.get(pk=run_id)
    for candidate in run.candidates.all():
        urls = list(
            candidate.images.order_by("source_order").values_list("original_url", flat=True)
        )
        stage_candidate_images(candidate, urls)
        with transaction.atomic():
            Source.objects.select_for_update().get(pk=candidate.source_id)
            candidate = ExternalListingCandidate.objects.select_for_update().get(pk=candidate.pk)
            # A delayed older run must never replace a newer run's media or a review decision.
            if (
                candidate.listing is not None
                and candidate.listing.source_reference == str(candidate.pk)
                and candidate.state == "published"
                and not candidate.images.filter(state="pending").exists()
            ):
                promote_candidate_images(candidate)
    with transaction.atomic():
        run = ExtractionRun.objects.select_for_update().get(pk=run_id)
        run.errors = [error for error in run.errors if not error["code"].startswith("image_")]
        for image in CandidateImage.objects.filter(candidate__extraction_run=run, state="failed"):
            run.errors.append({
                "code": f"image_{image.failure_code}",
                "detail": "دریافت یا پردازش تصویر ناموفق بود.",
                "transient": False,
                "candidate_id": str(image.candidate_id),
                "image_id": str(image.pk),
            })
        run.save(update_fields=("errors",))


def cleanup_owned_image_files(image: CandidateImage) -> None:
    """The durable image ID owns files even if its processing transaction was interrupted."""
    directory = f"external-media/{image.pk}"
    try:
        _, files = default_storage.listdir(directory)
    except FileNotFoundError:
        return
    for file in files:
        name = f"{directory}/{file}"
        asset = MediaAsset.objects.filter(file=name).first()
        if asset is None:
            default_storage.delete(name)
        else:
            schedule_asset_cleanup(asset.pk)
