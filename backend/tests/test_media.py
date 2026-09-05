from io import BytesIO

import pytest
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.utils import timezone
from PIL import Image

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
