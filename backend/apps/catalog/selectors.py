import re
import uuid
from dataclasses import dataclass
from typing import Any, Literal, cast

from django.db.models import CharField, Count, OuterRef, Q, QuerySet, Subquery, Value
from django.db.models.functions import Replace

from .models import TEHRAN_CITY_ID, City, District, Listing, Neighborhood, Property, PropertyType

PERSIAN_SEARCH_REPLACEMENTS = (
    ("ي", "ی"),
    ("ى", "ی"),
    ("ك", "ک"),
    ("آ", "ا"),
    ("أ", "ا"),
    ("إ", "ا"),
)


@dataclass(frozen=True)
class LocationSuggestion:
    id: uuid.UUID
    kind: Literal["city", "district", "neighborhood"]
    name: str
    label: str


@dataclass(frozen=True)
class SupportedCity:
    id: uuid.UUID
    name: str
    label: str


type SearchOrdering = Literal["freshness", "monthly_rent", "deposit", "area"]


@dataclass(frozen=True)
class PropertySearchFilters:
    location: str = ""
    deposit_min_rial: int | None = None
    deposit_max_rial: int | None = None
    monthly_rent_min_rial: int | None = None
    monthly_rent_max_rial: int | None = None
    area_min: int | None = None
    area_max: int | None = None
    room_count: int | None = None
    property_types: tuple[PropertyType, ...] = ()
    parking: str | None = None
    elevator: str | None = None
    storage: str | None = None
    balcony: str | None = None
    furnished: str | None = None
    ordering: SearchOrdering = "freshness"


def normalize_persian_search(value: str) -> str:
    normalized = value
    for source, replacement in PERSIAN_SEARCH_REPLACEMENTS:
        normalized = normalized.replace(source, replacement)
    return re.sub(r"[\s\u200c]+", "", normalized).strip()


def _with_normalized_name(queryset: QuerySet[Any, Any]) -> QuerySet[Any, Any]:
    source, replacement = PERSIAN_SEARCH_REPLACEMENTS[0]
    expression = Replace("name_fa", Value(source), Value(replacement), output_field=CharField())
    for source, replacement in PERSIAN_SEARCH_REPLACEMENTS[1:]:
        expression = Replace(expression, Value(source), Value(replacement))
    expression = Replace(expression, Value(" "), Value(""))
    expression = Replace(expression, Value("\u200c"), Value(""))
    return cast(QuerySet[Any, Any], queryset.annotate(search_name=expression))


def autocomplete_locations(query: str, *, limit: int = 10) -> list[LocationSuggestion]:
    normalized_query = normalize_persian_search(query)
    if not normalized_query:
        return []

    suggestions: list[LocationSuggestion] = []
    cities = _with_normalized_name(City.objects.filter(id=TEHRAN_CITY_ID, reviewed=True)).filter(
        search_name__icontains=normalized_query
    )
    suggestions.extend(
        LocationSuggestion(city.id, "city", city.name_fa, city.name_fa)
        for city in cities.order_by("name_fa")[:limit]
    )

    districts = _with_normalized_name(
        District.objects.filter(
            city_id=TEHRAN_CITY_ID, reviewed=True, city__reviewed=True
        ).select_related("city")
    ).filter(search_name__icontains=normalized_query)
    suggestions.extend(
        LocationSuggestion(
            district.id,
            "district",
            district.name_fa,
            f"{district.name_fa}، {district.city.name_fa}",
        )
        for district in districts.order_by("number")[:limit]
    )

    neighborhoods = _with_normalized_name(
        Neighborhood.objects.filter(
            reviewed=True,
            district__city_id=TEHRAN_CITY_ID,
            district__reviewed=True,
            district__city__reviewed=True,
        ).select_related("district__city")
    ).filter(search_name__icontains=normalized_query)
    suggestions.extend(
        LocationSuggestion(
            neighborhood.id,
            "neighborhood",
            neighborhood.name_fa,
            (
                f"{neighborhood.name_fa}، {neighborhood.district.name_fa}، "
                f"{neighborhood.district.city.name_fa}"
            ),
        )
        for neighborhood in neighborhoods.order_by("name_fa")[:limit]
    )
    return suggestions[:limit]


def supported_cities() -> list[SupportedCity]:
    return [
        SupportedCity(city.id, city.name_fa, city.name_fa)
        for city in City.objects.filter(id=TEHRAN_CITY_ID, reviewed=True).order_by("name_fa")
    ]


def search_properties(filters: PropertySearchFilters | None = None) -> QuerySet[Property]:
    filters = filters or PropertySearchFilters()
    active_listings = Listing.objects.active().filter(property_id=OuterRef("pk"))
    listing_ranges = {
        "terms__deposit_rial__gte": filters.deposit_min_rial,
        "terms__deposit_rial__lte": filters.deposit_max_rial,
        "terms__monthly_rent_rial__gte": filters.monthly_rent_min_rial,
        "terms__monthly_rent_rial__lte": filters.monthly_rent_max_rial,
    }
    active_listings = active_listings.filter(**{
        lookup: value for lookup, value in listing_ranges.items() if value is not None
    })

    listing_ordering = {
        "freshness": ("-availability_confirmed_at", "id"),
        "monthly_rent": ("terms__monthly_rent_rial", "id"),
        "deposit": ("terms__deposit_rial", "id"),
        "area": ("-availability_confirmed_at", "id"),
    }[filters.ordering]
    selected_listing = active_listings.order_by(*listing_ordering)
    all_active_listings = Listing.objects.active().filter(property_id=OuterRef("pk"))
    active_listing_counts = (
        all_active_listings
        .order_by()
        .values("property_id")
        .annotate(total=Count("id"))
        .values("total")
    )
    properties = (
        Property.objects
        .filter(city_id=TEHRAN_CITY_ID)
        .select_related("city", "district", "neighborhood")
        .annotate(
            listing_count=Subquery(active_listing_counts),
            selected_listing_id=Subquery(selected_listing.values("id")[:1]),
            selected_availability_confirmed_at=Subquery(
                selected_listing.values("availability_confirmed_at")[:1]
            ),
            selected_deposit_rial=Subquery(selected_listing.values("terms__deposit_rial")[:1]),
            selected_monthly_rent_rial=Subquery(
                selected_listing.values("terms__monthly_rent_rial")[:1]
            ),
            selected_currency=Subquery(selected_listing.values("terms__currency")[:1]),
        )
    )
    properties = properties.filter(selected_listing_id__isnull=False)

    property_filters = {
        "area_sqm__gte": filters.area_min,
        "area_sqm__lte": filters.area_max,
        "room_count": filters.room_count,
        "parking": filters.parking,
        "elevator": filters.elevator,
        "storage": filters.storage,
        "balcony": filters.balcony,
        "furnished": filters.furnished,
    }
    properties = properties.filter(**{
        lookup: value for lookup, value in property_filters.items() if value is not None
    })
    if filters.property_types:
        properties = properties.filter(property_type__in=filters.property_types)

    location = filters.location.strip()
    if location:
        try:
            location_id = uuid.UUID(location)
        except ValueError:
            normalized_location = normalize_persian_search(location)
            city_ids = _with_normalized_name(City.objects.filter(id=TEHRAN_CITY_ID)).filter(
                search_name__icontains=normalized_location
            )
            district_ids = _with_normalized_name(
                District.objects.filter(city_id=TEHRAN_CITY_ID)
            ).filter(search_name__icontains=normalized_location)
            neighborhood_ids = _with_normalized_name(
                Neighborhood.objects.filter(district__city_id=TEHRAN_CITY_ID)
            ).filter(search_name__icontains=normalized_location)
            properties = properties.filter(
                Q(city_id__in=city_ids.values("id"))
                | Q(district_id__in=district_ids.values("id"))
                | Q(neighborhood_id__in=neighborhood_ids.values("id"))
            )
        else:
            properties = properties.filter(
                Q(city_id=location_id) | Q(district_id=location_id) | Q(neighborhood_id=location_id)
            )

    property_ordering = {
        "freshness": ("-selected_availability_confirmed_at", "id"),
        "monthly_rent": ("selected_monthly_rent_rial", "id"),
        "deposit": ("selected_deposit_rial", "id"),
        "area": ("area_sqm", "id"),
    }[filters.ordering]
    return properties.order_by(*property_ordering)
