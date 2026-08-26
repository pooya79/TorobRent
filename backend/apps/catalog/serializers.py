from decimal import Decimal
from typing import Any

from django.core.files.storage import default_storage
from drf_spectacular.utils import extend_schema_field, extend_schema_serializer
from rest_framework import serializers

from .models import (
    FeatureState,
    Listing,
    LocationPrecision,
    OutboundPolicy,
    Property,
    PropertyCategory,
    PropertyType,
    property_category_for_type,
)
from .money import parse_localized_integer, rial_to_toman, toman_to_rial
from .selectors import (
    BedroomCountRange,
    MapViewportBounds,
    PropertySearchFilters,
    SearchOrdering,
)


class LocationSerializer(serializers.Serializer[Any]):
    city = serializers.CharField()
    district = serializers.CharField()
    district_number = serializers.IntegerField()
    neighborhood = serializers.CharField()


class ApproximateLocationSerializer(serializers.Serializer[Any]):
    latitude = serializers.DecimalField(max_digits=9, decimal_places=6, coerce_to_string=True)
    longitude = serializers.DecimalField(max_digits=9, decimal_places=6, coerce_to_string=True)
    precision = serializers.ChoiceField(choices=LocationPrecision.choices)
    radius_meters = serializers.IntegerField(min_value=1)


def approximate_location_data(property_: Property) -> dict[str, Any] | None:
    if (
        property_.approximate_latitude is None
        or property_.approximate_longitude is None
        or not property_.location_precision
        or property_.location_radius_meters is None
    ):
        return None
    return {
        "latitude": str(property_.approximate_latitude),
        "longitude": str(property_.approximate_longitude),
        "precision": property_.location_precision,
        "radius_meters": property_.location_radius_meters,
    }


class LocationSuggestionSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=("city", "district", "neighborhood"))
    name = serializers.CharField()
    label = serializers.CharField()  # type: ignore[assignment]


class SupportedCitySerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    name = serializers.CharField()
    label = serializers.CharField()  # type: ignore[assignment]


class CatalogStatisticsSerializer(serializers.Serializer[Any]):
    searchable_property_count = serializers.IntegerField(min_value=0)
    active_listing_count = serializers.IntegerField(min_value=0)
    covered_neighborhood_count = serializers.IntegerField(min_value=0)


class FeaturesSerializer(serializers.Serializer[Any]):
    parking = serializers.ChoiceField(choices=FeatureState.choices)
    elevator = serializers.ChoiceField(choices=FeatureState.choices)
    storage = serializers.ChoiceField(choices=FeatureState.choices)
    balcony = serializers.ChoiceField(choices=FeatureState.choices)
    furnished = serializers.ChoiceField(choices=FeatureState.choices)


class LocalizedIntegerField(serializers.IntegerField):
    def to_internal_value(self, data: Any) -> int:
        if isinstance(data, str):
            try:
                data = parse_localized_integer(data)
            except ValueError:
                self.fail("invalid")
        return super().to_internal_value(data)


class OmitNullIntegerField(serializers.IntegerField):
    def get_attribute(self, instance: Any) -> Any:
        value = super().get_attribute(instance)
        if value is None:
            raise serializers.SkipField
        return value


class TomanRialField(LocalizedIntegerField):
    def to_internal_value(self, data: Any) -> int:
        return toman_to_rial(super().to_internal_value(data))


@extend_schema_field({
    "oneOf": [
        {"type": "integer", "minimum": 0},
        {"type": "string", "enum": [BedroomCountRange.THREE_OR_MORE.value]},
    ]
})
class BedroomCountQueryField(serializers.Field[Any, Any, Any, Any]):
    default_error_messages = {"invalid": "یک عدد صحیح نامنفی یا مقدار سه‌خواب‌و‌بیشتر وارد کنید."}

    def to_internal_value(self, data: Any) -> int | BedroomCountRange:
        if data == BedroomCountRange.THREE_OR_MORE:
            return BedroomCountRange.THREE_OR_MORE
        if isinstance(data, str):
            try:
                data = parse_localized_integer(data)
            except ValueError:
                self.fail("invalid")
        if isinstance(data, bool) or not isinstance(data, int) or data < 0:
            self.fail("invalid")
        return data

    def to_representation(self, value: Any) -> Any:
        return value


class SearchOrderingQueryField(serializers.ChoiceField):
    legacy_aliases = {"freshness": SearchOrdering.NEWEST, "area": SearchOrdering.AREA_ASC}

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(
            choices=(*tuple(SearchOrdering), *self.legacy_aliases),
            help_text=(
                "Use the five canonical sort modes. `freshness` and `area` remain supported "
                "as deprecated aliases for `newest` and `area_asc`."
            ),
            **kwargs,
        )

    def to_internal_value(self, data: Any) -> str:
        return super().to_internal_value(self.legacy_aliases.get(data, data))


class PropertySearchQuerySerializer(serializers.Serializer[Any]):
    location = serializers.CharField(required=False, allow_blank=True)
    district = serializers.ListField(required=False, child=serializers.UUIDField())
    neighborhood = serializers.ListField(required=False, child=serializers.UUIDField())
    property_category = serializers.ChoiceField(
        required=False,
        choices=PropertyCategory.choices,
    )
    deposit_min_toman = TomanRialField(required=False, min_value=0, source="deposit_min_rial")
    deposit_max_toman = TomanRialField(required=False, min_value=0, source="deposit_max_rial")
    monthly_rent_min_toman = TomanRialField(
        required=False, min_value=0, source="monthly_rent_min_rial"
    )
    monthly_rent_max_toman = TomanRialField(
        required=False, min_value=0, source="monthly_rent_max_rial"
    )
    area_min = LocalizedIntegerField(required=False, min_value=1)
    area_max = LocalizedIntegerField(required=False, min_value=1)
    construction_year_min = LocalizedIntegerField(required=False, min_value=1200, max_value=1500)
    construction_year_max = LocalizedIntegerField(required=False, min_value=1200, max_value=1500)
    bedroom_count = BedroomCountQueryField(required=False)
    room_count = BedroomCountQueryField(
        required=False, help_text="Deprecated alias for bedroom_count"
    )
    property_type = serializers.ListField(
        required=False,
        child=serializers.ChoiceField(choices=PropertyType.choices),
    )
    parking = serializers.ChoiceField(required=False, choices=("present", "absent"))
    elevator = serializers.ChoiceField(required=False, choices=("present", "absent"))
    storage = serializers.ChoiceField(required=False, choices=("present", "absent"))
    balcony = serializers.ChoiceField(required=False, choices=("present", "absent"))
    furnished = serializers.ChoiceField(required=False, choices=("present", "absent"))
    ordering = SearchOrderingQueryField(required=False)
    page = LocalizedIntegerField(required=False, min_value=1)
    viewport_north = serializers.DecimalField(
        required=False,
        max_digits=9,
        decimal_places=6,
        min_value=Decimal("-90"),
        max_value=Decimal("90"),
    )
    viewport_east = serializers.DecimalField(
        required=False,
        max_digits=9,
        decimal_places=6,
        min_value=Decimal("-180"),
        max_value=Decimal("180"),
    )
    viewport_south = serializers.DecimalField(
        required=False,
        max_digits=9,
        decimal_places=6,
        min_value=Decimal("-90"),
        max_value=Decimal("90"),
    )
    viewport_west = serializers.DecimalField(
        required=False,
        max_digits=9,
        decimal_places=6,
        min_value=Decimal("-180"),
        max_value=Decimal("180"),
    )
    viewport_zoom = LocalizedIntegerField(required=False, min_value=0, max_value=22)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        ranges = (
            ("deposit_min_rial", "deposit_max_rial"),
            ("monthly_rent_min_rial", "monthly_rent_max_rial"),
            ("area_min", "area_max"),
            ("construction_year_min", "construction_year_max"),
        )
        for minimum, maximum in ranges:
            if minimum in attrs and maximum in attrs and attrs[minimum] > attrs[maximum]:
                raise serializers.ValidationError({maximum: "باید بزرگ‌تر یا مساوی حداقل باشد."})
        viewport_fields = (
            "viewport_north",
            "viewport_east",
            "viewport_south",
            "viewport_west",
        )
        present_viewport_fields = [field for field in viewport_fields if field in attrs]
        if present_viewport_fields and len(present_viewport_fields) != len(viewport_fields):
            raise serializers.ValidationError({
                "viewport_north": "هر چهار مرز محدوده نقشه باید ارسال شوند."
            })
        if "viewport_zoom" in attrs and not present_viewport_fields:
            raise serializers.ValidationError({
                "viewport_zoom": "بزرگ‌نمایی فقط همراه محدوده نقشه معتبر است."
            })
        if len(present_viewport_fields) == len(viewport_fields):
            if attrs["viewport_south"] >= attrs["viewport_north"]:
                raise serializers.ValidationError({
                    "viewport_north": "مرز شمالی باید بالاتر از مرز جنوبی باشد."
                })
            if attrs["viewport_west"] >= attrs["viewport_east"]:
                raise serializers.ValidationError({
                    "viewport_east": "مرز شرقی باید بعد از مرز غربی باشد."
                })
        category = attrs.get("property_category")
        if "bedroom_count" in attrs and "room_count" in attrs:
            raise serializers.ValidationError({
                "bedroom_count": "فقط یکی از پارامترهای تعداد اتاق خواب را وارد کنید."
            })
        property_types = attrs.get("property_type", ())
        inferred_categories = {
            property_category_for_type(property_type) for property_type in property_types
        }
        effective_category = category
        if effective_category is None and len(inferred_categories) == 1:
            effective_category = next(iter(inferred_categories))
        if effective_category == PropertyCategory.COMMERCIAL and (
            "bedroom_count" in attrs or "room_count" in attrs
        ):
            raise serializers.ValidationError({
                "bedroom_count": "تعداد اتاق خواب فقط برای ملک مسکونی معتبر است."
            })
        if category is not None:
            incompatible_types = [
                property_type
                for property_type in property_types
                if property_category_for_type(property_type) != category
            ]
            if incompatible_types:
                raise serializers.ValidationError({
                    "property_type": "نوع ملک باید با دسته‌بندی ملک سازگار باشد."
                })
        return attrs

    def validated_filters(self) -> PropertySearchFilters:
        data = self.validated_data
        viewport = None
        if "viewport_north" in data:
            viewport = MapViewportBounds(
                north=data["viewport_north"],
                east=data["viewport_east"],
                south=data["viewport_south"],
                west=data["viewport_west"],
                zoom=data.get("viewport_zoom", 11),
            )
        return PropertySearchFilters(
            location=data.get("location", ""),
            district_ids=tuple(data.get("district", ())),
            neighborhood_ids=tuple(data.get("neighborhood", ())),
            property_category=(
                PropertyCategory(data["property_category"]) if "property_category" in data else None
            ),
            deposit_min_rial=data.get("deposit_min_rial"),
            deposit_max_rial=data.get("deposit_max_rial"),
            monthly_rent_min_rial=data.get("monthly_rent_min_rial"),
            monthly_rent_max_rial=data.get("monthly_rent_max_rial"),
            area_min=data.get("area_min"),
            area_max=data.get("area_max"),
            construction_year_min=data.get("construction_year_min"),
            construction_year_max=data.get("construction_year_max"),
            bedroom_count=data.get("bedroom_count", data.get("room_count")),
            property_types=tuple(
                PropertyType(property_type) for property_type in data.get("property_type", ())
            ),
            parking=data.get("parking"),
            elevator=data.get("elevator"),
            storage=data.get("storage"),
            balcony=data.get("balcony"),
            furnished=data.get("furnished"),
            ordering=SearchOrdering(data.get("ordering", SearchOrdering.NEWEST)),
            viewport=viewport,
        )


class SourcePublicSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    name = serializers.CharField()
    display_name = serializers.CharField()
    outbound_policy = serializers.ChoiceField(choices=OutboundPolicy.choices)


class RentalTermsPublicSerializer(serializers.Serializer[Any]):
    deposit_rial = serializers.IntegerField()
    monthly_rent_rial = serializers.IntegerField()
    currency = serializers.ChoiceField(choices=("IRR",))
    deposit_toman = serializers.IntegerField()
    monthly_rent_toman = serializers.IntegerField()


class PropertyImageSummarySerializer(serializers.Serializer[Any]):
    url = serializers.CharField()
    width = serializers.IntegerField(min_value=1)
    height = serializers.IntegerField(min_value=1)


class SourceDisagreementSerializer(serializers.Serializer[Any]):
    field = serializers.CharField()
    normalized_value = serializers.JSONField()
    source_value = serializers.JSONField()


def property_location_data(property_: Property) -> dict[str, Any]:
    city = property_.city
    district = property_.district
    neighborhood = property_.neighborhood
    if city is None or district is None or neighborhood is None:
        raise ValueError("A public Property must have a complete location")
    return {
        "city": city.name_fa,
        "district": district.name_fa,
        "district_number": district.number,
        "neighborhood": neighborhood.name_fa,
    }


class PropertySummarySerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    title = serializers.CharField()
    canonical_slug = serializers.CharField()
    location = serializers.SerializerMethodField()
    approximate_location = serializers.SerializerMethodField()
    property_category = serializers.ChoiceField(choices=PropertyCategory.choices)
    property_category_label = serializers.CharField()
    property_type = serializers.ChoiceField(choices=PropertyType.choices)
    property_type_label = serializers.CharField(source="get_property_type_display")
    area_sqm = serializers.IntegerField()
    room_count = OmitNullIntegerField(required=False)
    construction_year = serializers.IntegerField(allow_null=True)
    primary_image = serializers.SerializerMethodField()
    listing_count = serializers.IntegerField()
    is_favorite = serializers.BooleanField(required=False)
    rental_terms = serializers.SerializerMethodField()
    availability_confirmed_at = serializers.DateTimeField(
        source="selected_availability_confirmed_at"
    )

    @extend_schema_field(LocationSerializer)
    def get_location(self, property_: Property) -> dict[str, Any]:
        return property_location_data(property_)

    @extend_schema_field(ApproximateLocationSerializer(allow_null=True))
    def get_approximate_location(self, property_: Property) -> dict[str, Any] | None:
        return approximate_location_data(property_)

    @extend_schema_field(PropertyImageSummarySerializer(allow_null=True))
    def get_primary_image(self, property_: Property) -> dict[str, Any] | None:
        file_name = property_.primary_image_file  # type: ignore[attr-defined]
        if not file_name:
            return None
        return {
            "url": default_storage.url(str(file_name)),
            "width": property_.primary_image_width,  # type: ignore[attr-defined]
            "height": property_.primary_image_height,  # type: ignore[attr-defined]
        }

    @extend_schema_field(RentalTermsPublicSerializer)
    def get_rental_terms(self, property_: Property) -> dict[str, Any]:
        deposit_rial = property_.selected_deposit_rial  # type: ignore[attr-defined]
        monthly_rent_rial = property_.selected_monthly_rent_rial  # type: ignore[attr-defined]
        return {
            "deposit_rial": deposit_rial,
            "monthly_rent_rial": monthly_rent_rial,
            "currency": property_.selected_currency,  # type: ignore[attr-defined]
            "deposit_toman": rial_to_toman(deposit_rial),
            "monthly_rent_toman": rial_to_toman(monthly_rent_rial),
        }


class ActiveFavoriteSummarySerializer(PropertySummarySerializer):
    saved_at = serializers.DateTimeField(source="favorite_saved_at")


class UnavailableFavoriteSummarySerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    title = serializers.CharField()
    location = serializers.SerializerMethodField()
    property_category = serializers.ChoiceField(choices=PropertyCategory.choices)
    property_category_label = serializers.CharField()
    property_type = serializers.ChoiceField(choices=PropertyType.choices)
    property_type_label = serializers.CharField(source="get_property_type_display")
    area_sqm = serializers.IntegerField()
    room_count = OmitNullIntegerField(required=False)
    saved_at = serializers.DateTimeField(source="favorite_saved_at")

    @extend_schema_field(LocationSerializer)
    def get_location(self, property_: Property) -> dict[str, Any]:
        return property_location_data(property_)


@extend_schema_serializer(many=False)
class FavoriteCollectionSerializer(serializers.Serializer[Any]):
    active = ActiveFavoriteSummarySerializer(many=True)
    unavailable = UnavailableFavoriteSummarySerializer(many=True)


class FacetCountSerializer(serializers.Serializer[Any]):
    value = serializers.CharField()
    count = serializers.IntegerField(min_value=0)


class FeatureStateFacetSerializer(serializers.Serializer[Any]):
    present = serializers.IntegerField(min_value=0)
    absent = serializers.IntegerField(min_value=0)
    unknown = serializers.IntegerField(min_value=0)


class FeatureFacetsSerializer(serializers.Serializer[Any]):
    parking = FeatureStateFacetSerializer()
    elevator = FeatureStateFacetSerializer()
    storage = FeatureStateFacetSerializer()
    balcony = FeatureStateFacetSerializer()
    furnished = FeatureStateFacetSerializer()


class CatalogFacetsSerializer(serializers.Serializer[Any]):
    property_types = FacetCountSerializer(many=True)
    bedroom_counts = FacetCountSerializer(many=True)
    features = FeatureFacetsSerializer()


class MapClusterSerializer(serializers.Serializer[Any]):
    id = serializers.CharField()
    latitude = serializers.DecimalField(max_digits=9, decimal_places=6)
    longitude = serializers.DecimalField(max_digits=9, decimal_places=6)
    property_count = serializers.IntegerField(min_value=2)
    property_ids = serializers.ListField(child=serializers.UUIDField())


class CatalogMapSerializer(serializers.Serializer[Any]):
    total_property_count = serializers.IntegerField(min_value=0)
    mappable_property_count = serializers.IntegerField(min_value=0)
    clusters = MapClusterSerializer(many=True)
    markers = PropertySummarySerializer(many=True)


@extend_schema_serializer(many=False)
class PropertySearchPageSerializer(serializers.Serializer[Any]):
    count = serializers.IntegerField(min_value=0)
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = PropertySummarySerializer(many=True)
    facets = CatalogFacetsSerializer()
    map = CatalogMapSerializer()


class ListingPublicSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    source = SourcePublicSerializer()  # type: ignore[assignment]
    rental_terms = RentalTermsPublicSerializer()
    description = serializers.CharField()
    source_reference = serializers.CharField()
    source_claims = serializers.JSONField()
    disagreements = SourceDisagreementSerializer(many=True)
    continuation_url = serializers.URLField(allow_null=True)
    media_url = serializers.URLField(allow_null=True)
    is_negotiable = serializers.BooleanField()
    is_convertible = serializers.BooleanField()
    availability_confirmed_at = serializers.DateTimeField()
    available_until = serializers.DateTimeField()


class PropertyDetailSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    title = serializers.CharField()
    canonical_slug = serializers.CharField()
    location = LocationSerializer()
    approximate_location = ApproximateLocationSerializer(allow_null=True)
    property_category = serializers.ChoiceField(choices=PropertyCategory.choices)
    property_category_label = serializers.CharField()
    property_type = serializers.ChoiceField(choices=PropertyType.choices)
    property_type_label = serializers.CharField()
    area_sqm = serializers.IntegerField()
    room_count = OmitNullIntegerField(required=False)
    construction_year = serializers.IntegerField(allow_null=True)
    floor = serializers.IntegerField(allow_null=True)
    total_floors = serializers.IntegerField(allow_null=True)
    units_per_floor = serializers.IntegerField(allow_null=True)
    heating = serializers.CharField()
    cooling = serializers.CharField()
    features = FeaturesSerializer()
    listings = ListingPublicSerializer(many=True)


class EventSessionSerializer(serializers.Serializer[Any]):
    event_session = serializers.UUIDField()


class PhoneRevealSerializer(serializers.Serializer[Any]):
    phone = serializers.CharField()


class ExternalContinuationSerializer(serializers.Serializer[Any]):
    url = serializers.URLField()


COMPARABLE_SOURCE_CLAIMS = (
    "property_type",
    "area_sqm",
    "room_count",
    "construction_year",
    "floor",
    "total_floors",
    "units_per_floor",
    "parking",
    "elevator",
    "storage",
    "balcony",
    "furnished",
    "heating",
    "cooling",
)


def source_disagreements(
    property_: Property, source_claims: dict[str, Any]
) -> list[dict[str, Any]]:
    disagreements = []
    for field in COMPARABLE_SOURCE_CLAIMS:
        if field not in source_claims:
            continue
        normalized_value = getattr(property_, field)
        source_value = source_claims[field]
        if normalized_value == source_value:
            continue
        disagreements.append({
            "field": field,
            "normalized_value": normalized_value,
            "source_value": source_value,
        })
    return disagreements


def property_detail_data(property_: Property, listings: list[Listing]) -> dict[str, Any]:
    city = property_.city
    district = property_.district
    neighborhood = property_.neighborhood
    if city is None or district is None or neighborhood is None:
        raise ValueError("A public Property must have a complete location")
    return {
        "id": property_.id,
        "title": property_.title,
        "canonical_slug": property_.canonical_slug,
        "location": {
            "city": city.name_fa,
            "district": district.name_fa,
            "district_number": district.number,
            "neighborhood": neighborhood.name_fa,
        },
        "approximate_location": approximate_location_data(property_),
        "property_category": property_.property_category,
        "property_category_label": property_.property_category_label,
        "property_type": property_.property_type,
        "property_type_label": property_.get_property_type_display(),
        "area_sqm": property_.area_sqm,
        "room_count": property_.room_count,
        "construction_year": property_.construction_year,
        "floor": property_.floor,
        "total_floors": property_.total_floors,
        "units_per_floor": property_.units_per_floor,
        "heating": property_.heating,
        "cooling": property_.cooling,
        "features": {
            "parking": property_.parking,
            "elevator": property_.elevator,
            "storage": property_.storage,
            "balcony": property_.balcony,
            "furnished": property_.furnished,
        },
        "listings": [
            {
                "id": listing.id,
                "source": {
                    "id": listing.source.id,
                    "name": listing.source.name,
                    "display_name": listing.source.display_name,
                    "outbound_policy": listing.source.outbound_policy,
                },
                "rental_terms": {
                    "deposit_rial": listing.terms.deposit_rial,
                    "monthly_rent_rial": listing.terms.monthly_rent_rial,
                    "currency": listing.terms.currency,
                    "deposit_toman": rial_to_toman(listing.terms.deposit_rial),
                    "monthly_rent_toman": rial_to_toman(listing.terms.monthly_rent_rial),
                },
                "description": listing.description,
                "source_reference": listing.source_reference,
                "source_claims": listing.source_claims,
                "disagreements": source_disagreements(property_, listing.source_claims),
                "continuation_url": (
                    listing.external_url
                    if listing.source.outbound_policy == OutboundPolicy.EXTERNAL_LINK
                    else None
                ),
                "media_url": (
                    listing.external_media_url
                    if listing.source.allows_external_media and listing.external_media_url
                    else None
                ),
                "is_negotiable": listing.terms.is_negotiable,
                "is_convertible": listing.terms.is_convertible,
                "availability_confirmed_at": listing.availability_confirmed_at,
                "available_until": listing.available_until,
            }
            for listing in listings
        ],
    }
