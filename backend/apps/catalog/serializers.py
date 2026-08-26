from typing import Any, cast

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import (
    FeatureState,
    Listing,
    OutboundPolicy,
    Property,
    PropertyCategory,
    PropertyType,
)
from .money import parse_localized_integer, rial_to_toman, toman_to_rial
from .selectors import PropertySearchFilters, SearchOrdering


class LocationSerializer(serializers.Serializer[Any]):
    city = serializers.CharField()
    district = serializers.CharField()
    district_number = serializers.IntegerField()
    neighborhood = serializers.CharField()


class LocationSuggestionSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=("city", "district", "neighborhood"))
    name = serializers.CharField()
    label = serializers.CharField()  # type: ignore[assignment]


class SupportedCitySerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    name = serializers.CharField()
    label = serializers.CharField()  # type: ignore[assignment]


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


class PropertySearchQuerySerializer(serializers.Serializer[Any]):
    location = serializers.CharField(required=False, allow_blank=True)
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
    room_count = LocalizedIntegerField(required=False, min_value=0)
    property_type = serializers.ListField(
        required=False,
        child=serializers.ChoiceField(choices=PropertyType.choices),
    )
    parking = serializers.ChoiceField(required=False, choices=("present", "absent"))
    elevator = serializers.ChoiceField(required=False, choices=("present", "absent"))
    storage = serializers.ChoiceField(required=False, choices=("present", "absent"))
    balcony = serializers.ChoiceField(required=False, choices=("present", "absent"))
    furnished = serializers.ChoiceField(required=False, choices=("present", "absent"))
    ordering = serializers.ChoiceField(
        required=False, choices=("freshness", "monthly_rent", "deposit", "area")
    )
    page = LocalizedIntegerField(required=False, min_value=1)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        ranges = (
            ("deposit_min_rial", "deposit_max_rial"),
            ("monthly_rent_min_rial", "monthly_rent_max_rial"),
            ("area_min", "area_max"),
        )
        for minimum, maximum in ranges:
            if minimum in attrs and maximum in attrs and attrs[minimum] > attrs[maximum]:
                raise serializers.ValidationError({maximum: "باید بزرگ‌تر یا مساوی حداقل باشد."})
        return attrs

    def validated_filters(self) -> PropertySearchFilters:
        data = self.validated_data
        return PropertySearchFilters(
            location=data.get("location", ""),
            deposit_min_rial=data.get("deposit_min_rial"),
            deposit_max_rial=data.get("deposit_max_rial"),
            monthly_rent_min_rial=data.get("monthly_rent_min_rial"),
            monthly_rent_max_rial=data.get("monthly_rent_max_rial"),
            area_min=data.get("area_min"),
            area_max=data.get("area_max"),
            room_count=data.get("room_count"),
            property_types=tuple(
                PropertyType(property_type) for property_type in data.get("property_type", ())
            ),
            parking=data.get("parking"),
            elevator=data.get("elevator"),
            storage=data.get("storage"),
            balcony=data.get("balcony"),
            furnished=data.get("furnished"),
            ordering=cast(SearchOrdering, data.get("ordering", "freshness")),
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


class SourceDisagreementSerializer(serializers.Serializer[Any]):
    field = serializers.CharField()
    normalized_value = serializers.JSONField()
    source_value = serializers.JSONField()


class PropertySummarySerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    title = serializers.CharField()
    canonical_slug = serializers.CharField()
    location = serializers.SerializerMethodField()
    property_category = serializers.ChoiceField(choices=PropertyCategory.choices)
    property_category_label = serializers.CharField()
    property_type = serializers.ChoiceField(choices=PropertyType.choices)
    property_type_label = serializers.CharField(source="get_property_type_display")
    area_sqm = serializers.IntegerField()
    room_count = OmitNullIntegerField(required=False)
    construction_year = serializers.IntegerField(allow_null=True)
    listing_count = serializers.IntegerField()
    rental_terms = serializers.SerializerMethodField()
    availability_confirmed_at = serializers.DateTimeField(
        source="selected_availability_confirmed_at"
    )

    @extend_schema_field(LocationSerializer)
    def get_location(self, property_: Property) -> dict[str, Any]:
        city = property_.city
        district = property_.district
        neighborhood = property_.neighborhood
        if city is None or district is None or neighborhood is None:
            raise ValueError("A searchable Property must have a complete location")
        return {
            "city": city.name_fa,
            "district": district.name_fa,
            "district_number": district.number,
            "neighborhood": neighborhood.name_fa,
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
