from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from django.conf import settings
from django.core.management import call_command

from apps.common.demo import DemoFixtureKind, demo_id

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


@dataclass(frozen=True)
class DemoCatalog:
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
        id=demo_id(DemoFixtureKind.SOURCE, 1),
        defaults={
            "name": "demo-home-one",
            "domain": "demo-one.invalid",
            "display_name": "نمونه نمایشی یک",
            "is_active": True,
            "is_builtin": False,
            "outbound_policy": OutboundPolicy.EXTERNAL_LINK,
            "allows_external_media": True,
        },
    )
    portal_two, _created = Source.objects.get_or_create(
        id=demo_id(DemoFixtureKind.SOURCE, 2),
        defaults={
            "name": "demo-home-two",
            "domain": "demo-two.invalid",
            "display_name": "نمونه نمایشی دو",
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
        latitude = Decimal("35.700000") + Decimal(index % 10) * Decimal("0.005")
        longitude = Decimal("51.300000") + Decimal(index % 12) * Decimal("0.010")
        property_, created = Property.objects.get_or_create(
            id=demo_id(DemoFixtureKind.PROPERTY, index),
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
                "provenance_note": "داده ساختگی و محلی برای نمایش TorobRent",
                "normalized_at": PUBLISHED_AT,
            },
        )
        if not created and (
            property_.property_type != property_type or property_.room_count != room_count
        ):
            property_.property_type = property_type
            property_.room_count = room_count
            property_.save(update_fields=("property_type", "room_count"))
        if property_.approximate_latitude is None or property_.approximate_longitude is None:
            property_.latitude = property_.latitude or latitude
            property_.longitude = property_.longitude or longitude
            derive_public_location(property_)
            property_.save(
                update_fields=(
                    "latitude",
                    "longitude",
                    "approximate_latitude",
                    "approximate_longitude",
                    "location_precision",
                    "location_radius_meters",
                )
            )
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
            id=demo_id(DemoFixtureKind.TERMS, index),
            defaults={
                "deposit_rial": 0 if index == 1 else index * 1_000_000_000,
                "monthly_rent_rial": 0 if index == 2 else index * 50_000_000,
                "is_negotiable": index % 3 == 0,
                "is_convertible": index % 4 == 0,
            },
        )
        if property_.area_sqm is None:
            raise RuntimeError("Demo Properties must have an area")
        external = source.outbound_policy == OutboundPolicy.EXTERNAL_LINK
        listing, _created = Listing.objects.get_or_create(
            id=demo_id(DemoFixtureKind.LISTING, index),
            defaults={
                "property": property_,
                "source": source,
                "terms": terms,
                "state": _listing_state(index),
                "description": "آگهی ساختگی برای مرور قابلیت‌های نسخه نمایشی.",
                "source_reference": f"DEMO-{index:03d}",
                "source_claims": {"area_sqm": property_.area_sqm + 5} if index > 60 else {},
                "provenance_note": "Fixture نمایشی؛ موجودی زنده یا داده خزنده نیست.",
                "external_url": f"https://{source.domain}/listings/{index}" if external else "",
                "external_media_url": (
                    f"{settings.FRONTEND_ORIGIN.rstrip('/')}/demo-media/"
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


def seed_demo_catalog() -> DemoCatalog:
    _load_locations()
    properties = _seed_properties()
    listings = _seed_listings(properties)
    return DemoCatalog(
        properties=len(properties),
        listings=len(listings),
        first_property=properties[0],
        published_listing=listings[0],
        expired_listing=listings[56],
    )
