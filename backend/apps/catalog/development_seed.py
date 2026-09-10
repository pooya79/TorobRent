from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management import call_command
from PIL import Image

from apps.common.development_seed import DevelopmentFixtureKind, development_fixture_id
from apps.common.media import (
    FirstPartyImageInput,
    ImageProcessingStatus,
    MediaVariantKind,
    process_first_party_image,
)
from apps.common.models import MediaAsset

from .locations import derive_public_location
from .models import (
    TEHRAN_CITY_ID,
    City,
    FeatureState,
    Listing,
    ListingImage,
    ListingImageVariant,
    ListingPriceObservation,
    ListingState,
    Neighborhood,
    OutboundPolicy,
    Property,
    PropertyImage,
    PropertyImageVariant,
    PropertyType,
    RentalTerms,
    Source,
    property_type_requires_room_count,
)

ACTIVE_UNTIL = datetime(2099, 12, 31, tzinfo=UTC)
PUBLISHED_AT = datetime(2026, 1, 1, tzinfo=UTC)
DEVELOPMENT_LATITUDE_ORIGIN = Decimal("35.650000")
DEVELOPMENT_LONGITUDE_ORIGIN = Decimal("51.300000")
DEVELOPMENT_LOCATION_STEP = Decimal("0.025000")
DEVELOPMENT_MEDIA_DIRECTORY = Path(__file__).parent / "fixtures" / "development_media"
DEVELOPMENT_MEDIA_NAMES_BY_PROPERTY_TYPE = {
    PropertyType.APARTMENT: ("living-room", "bedroom", "kitchen-balcony"),
    PropertyType.HOUSE: ("living-room", "kitchen-balcony", "bedroom"),
    PropertyType.VILLA: ("kitchen-balcony", "living-room", "bedroom"),
    PropertyType.OFFICE: ("office",),
    PropertyType.SHOP: ("shop",),
    PropertyType.WAREHOUSE: ("warehouse-workshop",),
    PropertyType.WORKSHOP: ("warehouse-workshop",),
}


@dataclass(frozen=True)
class DevelopmentCatalog:
    properties: int
    listings: int
    first_property: Property
    published_listing: Listing
    expired_listing: Listing


def _load_locations() -> None:
    if not City.objects.filter(id=TEHRAN_CITY_ID).exists():
        call_command("loaddata", "catalog_seed", verbosity=0)


def _seed_sources() -> tuple[Source, Source, Source]:
    direct = Source.objects.get(is_builtin=True)
    portal_one, _created = Source.objects.get_or_create(
        id=development_fixture_id(DevelopmentFixtureKind.SOURCE, 1),
        defaults={
            "name": "development-home-one",
            "domain": "development-one.invalid",
            "display_name": "نمونه ساختگی یک",
            "is_active": True,
            "is_builtin": False,
            "outbound_policy": OutboundPolicy.EXTERNAL_LINK,
            "allows_external_media": True,
        },
    )
    portal_two, _created = Source.objects.get_or_create(
        id=development_fixture_id(DevelopmentFixtureKind.SOURCE, 2),
        defaults={
            "name": "development-home-two",
            "domain": "development-two.invalid",
            "display_name": "نمونه ساختگی دو",
            "is_active": True,
            "is_builtin": False,
            "outbound_policy": OutboundPolicy.EXTERNAL_LINK,
            "allows_external_media": False,
        },
    )
    return direct, portal_one, portal_two


def _seed_properties() -> list[Property]:
    neighborhoods = list(
        Neighborhood.objects.select_related("district").order_by("district__number", "name_fa")[:60]
    )
    if len(neighborhoods) != 60:
        raise RuntimeError("The catalog location fixture must provide at least 60 neighborhoods")
    properties: list[Property] = []
    feature_states = tuple(FeatureState.values)
    property_types = tuple(PropertyType.values)
    for index, neighborhood in enumerate(neighborhoods, start=1):
        property_type = property_types[(index - 1) % len(property_types)]
        room_count = (index - 1) % 5 if property_type_requires_room_count(property_type) else None
        row, column = divmod(index - 1, 10)
        latitude = DEVELOPMENT_LATITUDE_ORIGIN + row * DEVELOPMENT_LOCATION_STEP
        longitude = DEVELOPMENT_LONGITUDE_ORIGIN + column * DEVELOPMENT_LOCATION_STEP
        property_, created = Property.objects.get_or_create(
            id=development_fixture_id(DevelopmentFixtureKind.PROPERTY, index),
            defaults={
                "city_id": TEHRAN_CITY_ID,
                "district": neighborhood.district,
                "neighborhood": neighborhood,
                "property_type": property_type,
                "area_sqm": 45 + index * 2,
                "room_count": room_count,
                "construction_year": 1380 + index % 25,
                "floor": index % 8,
                "total_floors": 8,
                "units_per_floor": 2,
                "parking": feature_states[(index - 1) % len(feature_states)],
                "elevator": feature_states[index % len(feature_states)],
                "storage": feature_states[(index + 1) % len(feature_states)],
                "balcony": feature_states[(index + 2) % len(feature_states)],
                "furnished": feature_states[(index + 3) % len(feature_states)],
                "heating": "پکیج",
                "cooling": "کولر آبی",
                "latitude": latitude,
                "longitude": longitude,
                "provenance_note": "داده ساختگی و محلی برای توسعه TorobRent",
                "normalized_at": PUBLISHED_AT,
            },
        )
        update_fields = {
            "approximate_latitude",
            "approximate_longitude",
            "location_precision",
            "location_radius_meters",
        }
        if not created and (
            property_.property_type != property_type or property_.room_count != room_count
        ):
            property_.property_type = property_type
            property_.room_count = room_count
            update_fields.update(("property_type", "room_count"))
        if property_.latitude is None or property_.longitude is None:
            property_.latitude = latitude
            property_.longitude = longitude
            update_fields.update(("latitude", "longitude"))
        derive_public_location(property_)
        property_.save(update_fields=tuple(sorted(update_fields)))
        properties.append(property_)
    return properties


def _listing_state(index: int) -> ListingState:
    return {
        55: ListingState.DRAFT,
        56: ListingState.PENDING,
        57: ListingState.EXPIRED,
        58: ListingState.REJECTED,
        59: ListingState.UNAVAILABLE,
        60: ListingState.ARCHIVED,
    }.get(index, ListingState.PUBLISHED)


def _seed_media_assets() -> dict[str, dict[MediaVariantKind, MediaAsset]]:
    assets_by_name: dict[str, dict[MediaVariantKind, MediaAsset]] = {}
    for media_name in sorted({
        name for names in DEVELOPMENT_MEDIA_NAMES_BY_PROPERTY_TYPE.values() for name in names
    }):
        source_path = DEVELOPMENT_MEDIA_DIRECTORY / f"{media_name}.jpg"
        variant_names = {
            kind: f"external-media/development/{media_name}/{kind}.webp"
            for kind in MediaVariantKind
        }
        if not all(default_storage.exists(file_name) for file_name in variant_names.values()):
            for file_name in variant_names.values():
                default_storage.delete(file_name)
            input_key = f"external-media/development/{media_name}/source.upload"
            default_storage.delete(input_key)
            default_storage.save(input_key, ContentFile(source_path.read_bytes()))

            def variant_key(kind: MediaVariantKind, name: str = media_name) -> str:
                return f"external-media/development/{name}/{kind}.webp"

            try:
                result = process_first_party_image(
                    FirstPartyImageInput(
                        storage=default_storage,
                        input_key=input_key,
                        variant_key=variant_key,
                    )
                )
            finally:
                default_storage.delete(input_key)
            if result.status != ImageProcessingStatus.READY:
                raise RuntimeError(f"Could not process development image {source_path.name}")

        assets: dict[MediaVariantKind, MediaAsset] = {}
        for kind, file_name in variant_names.items():
            with (
                default_storage.open(file_name, "rb") as image_file,
                Image.open(image_file) as image,
            ):
                width, height = image.size
            asset, _created = MediaAsset.objects.update_or_create(
                file=file_name,
                defaults={
                    "width": width,
                    "height": height,
                    "byte_size": default_storage.size(file_name),
                },
            )
            assets[kind] = asset
        assets_by_name[media_name] = assets
    return assets_by_name


def _seed_listing_images(
    listings: list[Listing], assets_by_name: dict[str, dict[MediaVariantKind, MediaAsset]]
) -> None:
    for index, listing in enumerate(listings, start=1):
        media_names = DEVELOPMENT_MEDIA_NAMES_BY_PROPERTY_TYPE[
            PropertyType(listing.property.property_type)
        ]
        permits_images = listing.source.is_builtin or listing.source.allows_external_media
        if not permits_images:
            continue
        image_count = 1 + (index * 17) % len(media_names)
        for position in range(image_count):
            media_name = media_names[(index + position - 1) % len(media_names)]
            listing_image, _created = ListingImage.objects.get_or_create(
                id=development_fixture_id(
                    DevelopmentFixtureKind.LISTING_IMAGE, index * 10 + position
                ),
                defaults={
                    "listing": listing,
                    "position": position,
                    "is_primary": position == 0,
                },
            )
            for kind, asset in assets_by_name[media_name].items():
                ListingImageVariant.objects.get_or_create(
                    image=listing_image,
                    kind=kind,
                    defaults={"asset": asset},
                )


def _seed_property_images(
    properties: list[Property], assets_by_name: dict[str, dict[MediaVariantKind, MediaAsset]]
) -> None:
    for index, property_ in enumerate(properties, start=1):
        if index % 2 == 0:
            continue
        media_names = DEVELOPMENT_MEDIA_NAMES_BY_PROPERTY_TYPE[
            PropertyType(property_.property_type)
        ]
        image_count = 1 + (index * 11) % len(media_names)
        for position in range(image_count):
            media_name = media_names[(index + position - 1) % len(media_names)]
            property_image, _created = PropertyImage.objects.get_or_create(
                id=development_fixture_id(
                    DevelopmentFixtureKind.PROPERTY_IMAGE, index * 10 + position
                ),
                defaults={
                    "property": property_,
                    "position": position,
                    "is_primary": position == 0,
                    "reviewed_at": PUBLISHED_AT,
                },
            )
            for kind, asset in assets_by_name[media_name].items():
                PropertyImageVariant.objects.get_or_create(
                    image=property_image,
                    kind=kind,
                    defaults={"asset": asset},
                )


def _historical_price(current: int, *, percentage: int, zero_value: int) -> int:
    if current == 0:
        return zero_value
    return current * percentage // 100


def _seed_price_history(listings: list[Listing]) -> None:
    observed_at = datetime.now(tz=UTC)
    history_points = (
        (PUBLISHED_AT, 80, 200_000_000, 20_000_000),
        (PUBLISHED_AT + timedelta(days=90), 90, 100_000_000, 10_000_000),
    )
    for listing in listings:
        if listing.state != ListingState.PUBLISHED:
            continue
        for recorded_at, percentage, zero_deposit, zero_rent in history_points:
            ListingPriceObservation.objects.get_or_create(
                listing=listing,
                recorded_at=recorded_at,
                defaults={
                    "deposit_rial": _historical_price(
                        listing.terms.deposit_rial,
                        percentage=percentage,
                        zero_value=zero_deposit,
                    ),
                    "monthly_rent_rial": _historical_price(
                        listing.terms.monthly_rent_rial,
                        percentage=percentage,
                        zero_value=zero_rent,
                    ),
                },
            )
        latest = listing.price_history.order_by("-recorded_at", "-id").first()
        current_pair = (listing.terms.deposit_rial, listing.terms.monthly_rent_rial)
        if latest is None or (latest.deposit_rial, latest.monthly_rent_rial) != current_pair:
            ListingPriceObservation.objects.create(
                listing=listing,
                recorded_at=observed_at,
                deposit_rial=current_pair[0],
                monthly_rent_rial=current_pair[1],
            )


def _seed_listings(properties: list[Property]) -> list[Listing]:
    sources = _seed_sources()
    listings: list[Listing] = []
    for index in range(1, 81):
        property_ = properties[(index - 1) % len(properties)]
        source = sources[(index - 1) % len(sources)]
        terms, _created = RentalTerms.objects.get_or_create(
            id=development_fixture_id(DevelopmentFixtureKind.TERMS, index),
            defaults={
                "deposit_rial": 0 if index == 1 else index * 1_000_000_000,
                "monthly_rent_rial": 0 if index == 2 else index * 50_000_000,
                "is_negotiable": index % 3 == 0,
                "is_convertible": index % 4 == 0,
            },
        )
        if property_.area_sqm is None:
            raise RuntimeError("Development Properties must have an area")
        external = source.outbound_policy == OutboundPolicy.EXTERNAL_LINK
        listing, _created = Listing.objects.get_or_create(
            id=development_fixture_id(DevelopmentFixtureKind.LISTING, index),
            defaults={
                "property": property_,
                "source": source,
                "terms": terms,
                "state": _listing_state(index),
                "description": "آگهی ساختگی برای مرور قابلیت‌ها در محیط توسعه.",
                "source_reference": f"DEV-{index:03d}",
                "source_claims": {"area_sqm": property_.area_sqm + 5} if index > 60 else {},
                "provenance_note": "داده توسعه؛ موجودی زنده یا داده خزنده نیست.",
                "external_url": f"https://{source.domain}/listings/{index}" if external else "",
                "external_media_url": "",
                "direct_phone": "02100000000" if not external else "",
                "published_at": PUBLISHED_AT,
                "availability_confirmed_at": PUBLISHED_AT,
                "available_until": ACTIVE_UNTIL,
            },
        )
        listings.append(listing)
    return listings


def seed_development_catalog() -> DevelopmentCatalog:
    _load_locations()
    properties = _seed_properties()
    listings = _seed_listings(properties)
    assets_by_name = _seed_media_assets()
    _seed_listing_images(listings, assets_by_name)
    _seed_property_images(properties, assets_by_name)
    _seed_price_history(listings)
    return DevelopmentCatalog(
        properties=len(properties),
        listings=len(listings),
        first_property=properties[0],
        published_listing=listings[0],
        expired_listing=listings[56],
    )
