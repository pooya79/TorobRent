import re
import uuid
from dataclasses import dataclass
from typing import Any, Literal, cast

from django.db.models import CharField, Count, OuterRef, Q, QuerySet, Subquery, Value
from django.db.models.functions import Replace

from .models import TEHRAN_CITY_ID, City, District, Listing, Neighborhood, Property

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


def search_properties(location: str = "") -> QuerySet[Property]:
    active_listings = Listing.objects.active().filter(property_id=OuterRef("pk"))
    freshest_listing = active_listings.order_by("-availability_confirmed_at", "id")
    active_listing_counts = (
        active_listings.order_by().values("property_id").annotate(total=Count("id")).values("total")
    )
    properties = (
        Property.objects
        .filter(city_id=TEHRAN_CITY_ID)
        .select_related("city", "district", "neighborhood")
        .annotate(
            listing_count=Subquery(active_listing_counts),
            freshest_listing_id=Subquery(freshest_listing.values("id")[:1]),
            freshest_availability_confirmed_at=Subquery(
                freshest_listing.values("availability_confirmed_at")[:1]
            ),
            freshest_deposit_rial=Subquery(freshest_listing.values("terms__deposit_rial")[:1]),
            freshest_monthly_rent_rial=Subquery(
                freshest_listing.values("terms__monthly_rent_rial")[:1]
            ),
            freshest_currency=Subquery(freshest_listing.values("terms__currency")[:1]),
        )
    )
    properties = properties.filter(freshest_listing_id__isnull=False)

    location = location.strip()
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

    return properties.order_by("-freshest_availability_confirmed_at", "id")
