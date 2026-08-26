import re
import uuid
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Any, Literal, cast

from django.db.models import CharField, Count, Exists, OuterRef, Q, QuerySet, Subquery, Value
from django.db.models.functions import Replace

from .models import (
    PROPERTY_TYPES_BY_CATEGORY,
    TEHRAN_CITY_ID,
    City,
    District,
    Favorite,
    Listing,
    Neighborhood,
    Property,
    PropertyCategory,
    PropertyType,
)

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


@dataclass(frozen=True)
class CatalogStatistics:
    searchable_property_count: int
    active_listing_count: int
    covered_neighborhood_count: int


type SearchOrdering = Literal["freshness", "monthly_rent", "deposit", "area"]


class BedroomCountRange(StrEnum):
    THREE_OR_MORE = "3_plus"


type BedroomCountFilter = int | BedroomCountRange


@dataclass(frozen=True)
class PropertySearchFilters:
    location: str = ""
    property_category: PropertyCategory | None = None
    deposit_min_rial: int | None = None
    deposit_max_rial: int | None = None
    monthly_rent_min_rial: int | None = None
    monthly_rent_max_rial: int | None = None
    area_min: int | None = None
    area_max: int | None = None
    bedroom_count: BedroomCountFilter | None = None
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


def catalog_statistics() -> CatalogStatistics:
    counts = (
        Listing.objects
        .active()
        .filter(property__city_id=TEHRAN_CITY_ID)
        .aggregate(
            searchable_property_count=Count("property_id", distinct=True),
            active_listing_count=Count("id"),
            covered_neighborhood_count=Count("property__neighborhood_id", distinct=True),
        )
    )
    return CatalogStatistics(**counts)


def search_properties(
    filters: PropertySearchFilters | None = None,
    *,
    favorite_account_id: uuid.UUID | None = None,
) -> QuerySet[Property]:
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
    if favorite_account_id is not None:
        properties = properties.annotate(
            is_favorite=Exists(
                Favorite.objects.filter(
                    account_id=favorite_account_id,
                    property_id=OuterRef("pk"),
                )
            )
        )

    property_filters = {
        "area_sqm__gte": filters.area_min,
        "area_sqm__lte": filters.area_max,
        "parking": filters.parking,
        "elevator": filters.elevator,
        "storage": filters.storage,
        "balcony": filters.balcony,
        "furnished": filters.furnished,
    }
    properties = properties.filter(**{
        lookup: value for lookup, value in property_filters.items() if value is not None
    })
    if filters.bedroom_count == BedroomCountRange.THREE_OR_MORE:
        properties = properties.filter(room_count__gte=3)
    elif filters.bedroom_count is not None:
        properties = properties.filter(room_count=filters.bedroom_count)
    if filters.property_types:
        properties = properties.filter(property_type__in=filters.property_types)
    elif filters.property_category is not None:
        properties = properties.filter(
            property_type__in=PROPERTY_TYPES_BY_CATEGORY[filters.property_category]
        )

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


def favorite_properties(
    account_id: uuid.UUID,
) -> tuple[QuerySet[Property], QuerySet[Property]]:
    favorite = Favorite.objects.filter(account_id=account_id, property_id=OuterRef("pk"))
    active_listings = Listing.objects.active().filter(property_id=OuterRef("pk"))
    selected_listing = active_listings.order_by("-availability_confirmed_at", "id")
    active_listing_counts = (
        active_listings.order_by().values("property_id").annotate(total=Count("id")).values("total")
    )
    favorites = (
        Property.objects
        .filter(favorites__account_id=account_id)
        .select_related("city", "district", "neighborhood")
        .annotate(
            favorite_saved_at=Subquery(favorite.values("saved_at")[:1]),
            has_active_listing=Exists(active_listings),
        )
    )
    active = favorites.filter(has_active_listing=True).annotate(
        listing_count=Subquery(active_listing_counts),
        selected_availability_confirmed_at=Subquery(
            selected_listing.values("availability_confirmed_at")[:1]
        ),
        selected_deposit_rial=Subquery(selected_listing.values("terms__deposit_rial")[:1]),
        selected_monthly_rent_rial=Subquery(
            selected_listing.values("terms__monthly_rent_rial")[:1]
        ),
        selected_currency=Subquery(selected_listing.values("terms__currency")[:1]),
        is_favorite=Value(True),
    )
    unavailable = favorites.filter(has_active_listing=False)
    ordering = ("-favorite_saved_at", "id")
    return active.order_by(*ordering), unavailable.order_by(*ordering)


type FacetFeature = Literal["parking", "elevator", "storage", "furnished"]
FACET_FEATURES: tuple[FacetFeature, ...] = ("parking", "elevator", "storage", "furnished")


def _without_feature_filter(
    filters: PropertySearchFilters, feature: FacetFeature
) -> PropertySearchFilters:
    if feature == "parking":
        return replace(filters, parking=None)
    if feature == "elevator":
        return replace(filters, elevator=None)
    if feature == "storage":
        return replace(filters, storage=None)
    return replace(filters, furnished=None)


def catalog_facets(filters: PropertySearchFilters) -> dict[str, Any]:
    property_type_rows = (
        search_properties(replace(filters, property_types=()))
        .order_by()
        .values("property_type")
        .annotate(count=Count("id"))
    )
    property_type_counts = {row["property_type"]: row["count"] for row in property_type_rows}
    property_types = (
        PROPERTY_TYPES_BY_CATEGORY[filters.property_category]
        if filters.property_category is not None
        else tuple(PropertyType)
    )

    bedroom_counts: list[dict[str, Any]] = []
    if filters.property_category != PropertyCategory.COMMERCIAL:
        bedroom_base = search_properties(replace(filters, bedroom_count=None)).order_by()
        grouped_bedrooms = bedroom_base.aggregate(
            one=Count("id", filter=Q(room_count=1)),
            two=Count("id", filter=Q(room_count=2)),
            three_plus=Count("id", filter=Q(room_count__gte=3)),
        )
        bedroom_counts = [
            {"value": "1", "count": grouped_bedrooms["one"]},
            {"value": "2", "count": grouped_bedrooms["two"]},
            {
                "value": BedroomCountRange.THREE_OR_MORE.value,
                "count": grouped_bedrooms["three_plus"],
            },
        ]

    features: dict[str, dict[str, int]] = {}
    for feature in FACET_FEATURES:
        feature_base = search_properties(_without_feature_filter(filters, feature)).order_by()
        counts = feature_base.aggregate(
            present=Count("id", filter=Q(**{feature: "present"})),
            absent=Count("id", filter=Q(**{feature: "absent"})),
            unknown=Count("id", filter=Q(**{feature: "unknown"})),
        )
        features[feature] = counts

    return {
        "property_types": [
            {"value": property_type.value, "count": property_type_counts.get(property_type, 0)}
            for property_type in property_types
        ],
        "bedroom_counts": bedroom_counts,
        "features": features,
    }
