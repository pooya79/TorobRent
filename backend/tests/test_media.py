import uuid
from io import BytesIO

import pytest
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.utils import timezone
from PIL import Image

from apps.catalog.image_evidence import backfill_listing_image_hashes
from apps.catalog.models import (
    Listing,
    ListingImage,
    ListingImageVariant,
    OutboundPolicy,
    Property,
    PropertyImage,
    PropertyImageVariant,
    RentalTerms,
    Source,
)
from apps.common.media import (
    FirstPartyImageInput,
    ImageProcessingLimits,
    ImageProcessingStatus,
    MediaVariantKind,
    compute_image_identity,
    process_first_party_image,
)
from apps.common.models import MediaAsset


def encoded_image(*, image_format: str = "JPEG", size: tuple[int, int] = (1200, 1600)) -> bytes:
    content = BytesIO()
    image = Image.new("RGB", size, "#a25f3a")
    exif = Image.Exif()
    exif[274] = 6
    exif[315] = "Private photographer metadata"
    image.save(content, format=image_format, exif=exif)
    return content.getvalue()


def patterned_image(
    *,
    image_format: str = "PNG",
    size: tuple[int, int] = (96, 72),
    quality: int = 95,
) -> bytes:
    image = Image.new("RGB", size, "white")
    for x in range(size[0]):
        for y in range(size[1]):
            image.putpixel(
                (x, y),
                ((x * 7 + y * 3) % 256, (x * 2 + y * 11) % 256, (x * 13 + y) % 256),
            )
    content = BytesIO()
    image.save(content, format=image_format, quality=quality)
    return content.getvalue()


def test_image_identity_distinguishes_encoding_from_visual_similarity():
    original = patterned_image()
    byte_identical = bytes(original)

    with Image.open(BytesIO(original)) as image:
        reencoded_output = BytesIO()
        image.save(reencoded_output, format="WEBP", lossless=True)
        reencoded = reencoded_output.getvalue()
        recompressed_output = BytesIO()
        image.save(recompressed_output, format="WEBP", quality=76)
        recompressed = recompressed_output.getvalue()
        resized_image = image.resize((48, 36), Image.Resampling.LANCZOS)
        resized = BytesIO()
        resized_image.save(resized, format="WEBP", quality=76)

    original_hashes = compute_image_identity(original)
    identical_hashes = compute_image_identity(byte_identical)
    reencoded_hashes = compute_image_identity(reencoded)
    recompressed_hashes = compute_image_identity(recompressed)
    resized_hashes = compute_image_identity(resized.getvalue())

    assert identical_hashes.raw_content_sha256 == original_hashes.raw_content_sha256
    assert reencoded_hashes.raw_content_sha256 != original_hashes.raw_content_sha256
    assert reencoded_hashes.normalized_pixel_sha256 == original_hashes.normalized_pixel_sha256
    assert recompressed_hashes.normalized_pixel_sha256 != original_hashes.normalized_pixel_sha256
    assert original_hashes.perceptual_distance(recompressed_hashes) <= 10
    assert original_hashes.perceptual_distance(resized_hashes) <= 10


@pytest.mark.django_db(transaction=True)
def test_listing_image_hash_backfill_is_bounded_and_idempotent():
    property_ = Property.objects.create()
    listing = Listing.objects.create(
        property=property_,
        source=Source.objects.create(
            name="hash-backfill",
            domain="hash-backfill.example",
            display_name="Hash backfill",
            outbound_policy=OutboundPolicy.EXTERNAL_LINK,
        ),
        terms=RentalTerms.objects.create(deposit_rial=1, monthly_rent_rial=0),
    )
    images = []
    for position in range(3):
        image = ListingImage.objects.create(
            id=uuid.UUID(int=position + 1),
            listing=listing,
            position=position,
            is_primary=position == 0,
            raw_content_sha256="a" * 64 if position == 2 else "",
            normalized_pixel_sha256="b" * 64 if position == 2 else "",
            perceptual_dhash="c" * 16 if position == 2 else "",
        )
        if position != 0:
            asset = MediaAsset(width=96, height=72, byte_size=1)
            asset.file.save(
                f"hash-backfill/{position}.png",
                ContentFile(patterned_image()),
                save=True,
            )
            ListingImageVariant.objects.create(
                image=image,
                kind=MediaVariantKind.LARGE,
                asset=asset,
            )
        images.append(image)

    first_batch = backfill_listing_image_hashes(limit=1)
    assert first_batch.inspected == 1
    assert first_batch.updated == 0
    assert first_batch.next_cursor == str(images[0].id)
    second_batch = backfill_listing_image_hashes(limit=1, after_id=first_batch.next_cursor)
    assert second_batch.updated == 1
    assert ListingImage.objects.exclude(raw_content_sha256="").count() == 2
    final_batch = backfill_listing_image_hashes(limit=1, after_id=second_batch.next_cursor)
    assert final_batch.inspected == 0
    assert final_batch.updated == 0
    assert final_batch.next_cursor is None

    preserved = ListingImage.objects.get(id=images[2].id)
    assert preserved.raw_content_sha256 == "a" * 64


def test_non_submission_caller_receives_processed_asset_metadata(tmp_path):
    storage = FileSystemStorage(location=tmp_path)
    source_name = storage.save("candidate/source.upload", ContentFile(encoded_image()))

    result = process_first_party_image(
        FirstPartyImageInput(
            storage=storage,
            input_key=source_name,
            variant_key=lambda kind: f"candidate/variants/{kind}.webp",
        )
    )

    assert result.status is ImageProcessingStatus.READY
    assert [(variant.kind, variant.width) for variant in result.variants] == [
        (MediaVariantKind.SMALL, 480),
        (MediaVariantKind.MEDIUM, 960),
        (MediaVariantKind.LARGE, 1440),
    ]
    medium = result.variants[1]
    with storage.open(medium.file_name, "rb") as processed_file:
        processed = Image.open(processed_file)
        assert processed.format == "WEBP"
        assert processed.mode == "RGB"
        assert processed.size == (960, 720)
        assert not processed.getexif()


def test_processing_failure_is_terminal_and_removes_partial_variants(
    tmp_path, monkeypatch: pytest.MonkeyPatch
):
    storage = FileSystemStorage(location=tmp_path)
    source_name = storage.save("candidate/source.upload", ContentFile(encoded_image(size=(80, 60))))
    original_save = storage.save
    save_count = 0
    delete_count = 0

    def fail_second_variant(name: str, content: ContentFile[bytes], max_length: int | None = None):
        nonlocal save_count
        save_count += 1
        if save_count == 2:
            raise OSError("storage unavailable")
        return original_save(name, content, max_length=max_length)

    monkeypatch.setattr(storage, "save", fail_second_variant)

    def fail_first_delete(name: str):
        nonlocal delete_count
        delete_count += 1
        if delete_count == 1:
            raise OSError("transient cleanup failure")
        FileSystemStorage.delete(storage, name)

    monkeypatch.setattr(storage, "delete", fail_first_delete)

    result = process_first_party_image(
        FirstPartyImageInput(
            storage=storage,
            input_key=source_name,
            variant_key=lambda kind: f"candidate/variants/{kind}.webp",
        )
    )

    assert result.status is ImageProcessingStatus.FAILED
    assert result.failure_reason
    assert result.variants == ()
    assert list(tmp_path.glob("candidate/variants/*")) == []


@pytest.mark.parametrize(
    "limits",
    [
        ImageProcessingLimits(max_bytes=100, max_pixels=1_000_000),
        ImageProcessingLimits(max_bytes=1_000_000, max_pixels=4_799),
    ],
)
def test_first_party_input_limits_fail_without_publishing_variants(tmp_path, limits):
    storage = FileSystemStorage(location=tmp_path)
    source_name = storage.save("candidate/source.upload", ContentFile(encoded_image(size=(80, 60))))

    result = process_first_party_image(
        FirstPartyImageInput(
            storage=storage,
            input_key=source_name,
            variant_key=lambda kind: f"candidate/variants/{kind}.webp",
        ),
        limits=limits,
    )

    assert result.status is ImageProcessingStatus.FAILED
    assert result.variants == ()
    assert not storage.exists("candidate/variants/small.webp")


@pytest.mark.django_db(transaction=True)
def test_media_asset_survives_until_its_last_non_submission_reference_is_deleted(
    tmp_path, settings
):
    settings.MEDIA_ROOT = tmp_path
    property_ = Property.objects.create()
    listing = Listing.objects.create(
        property=property_,
        source=Source.objects.create(
            name="candidate-source",
            domain="candidate.example.com",
            display_name="Candidate Source",
            outbound_policy=OutboundPolicy.EXTERNAL_LINK,
        ),
        terms=RentalTerms.objects.create(deposit_rial=1, monthly_rent_rial=0),
    )
    listing_image = ListingImage.objects.create(listing=listing, position=0, is_primary=True)
    property_image = PropertyImage.objects.create(
        property=property_,
        position=0,
        is_primary=True,
        reviewed_at=timezone.now(),
    )
    asset = MediaAsset(width=20, height=10, byte_size=7)
    asset.file.save("candidate/variants/small.webp", ContentFile(b"content"), save=True)
    ListingImageVariant.objects.create(
        image=listing_image,
        kind=MediaVariantKind.SMALL,
        asset=asset,
    )
    PropertyImageVariant.objects.create(
        image=property_image,
        kind=MediaVariantKind.SMALL,
        asset=asset,
    )

    listing_image.delete()

    assert MediaAsset.objects.filter(id=asset.id).exists()
    assert asset.file.storage.exists(asset.file.name)

    property_image.delete()

    assert not MediaAsset.objects.filter(id=asset.id).exists()
    assert not asset.file.storage.exists(asset.file.name)
