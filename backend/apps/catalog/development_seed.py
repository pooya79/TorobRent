from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from django.conf import settings
from django.core.management import call_command

from apps.common.development_seed import DevelopmentFixtureKind, development_fixture_id

from .locations import derive_public_location
from .models import (
    TEHRAN_CITY_ID,
    City,
    FeatureState,
    Listing,
    ListingState,
    Neighborhood,
    OutboundPolicy,
    Property,
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
                "external_media_url": (
                    f"{settings.FRONTEND_ORIGIN.rstrip('/')}/sample-media/"
                    f"property-{index % 3 + 1}.svg"
                    if source.allows_external_media
                    else ""
                ),
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
    return DevelopmentCatalog(
        properties=len(properties),
        listings=len(listings),
        first_property=properties[0],
        published_listing=listings[0],
        expired_listing=listings[56],
    )
