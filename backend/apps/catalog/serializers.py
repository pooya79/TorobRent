from typing import Any

from rest_framework import serializers

from .models import FeatureState, Listing, OutboundPolicy, Property, PropertyType
from .money import rial_to_toman


class LocationSerializer(serializers.Serializer[Any]):
    city = serializers.CharField()
    district = serializers.CharField()
    district_number = serializers.IntegerField()
    neighborhood = serializers.CharField()


class FeaturesSerializer(serializers.Serializer[Any]):
    parking = serializers.ChoiceField(choices=FeatureState.choices)
    elevator = serializers.ChoiceField(choices=FeatureState.choices)
    storage = serializers.ChoiceField(choices=FeatureState.choices)
    balcony = serializers.ChoiceField(choices=FeatureState.choices)
    furnished = serializers.ChoiceField(choices=FeatureState.choices)


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


class ListingPublicSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    source = SourcePublicSerializer()  # type: ignore[assignment]
    rental_terms = RentalTermsPublicSerializer()
    description = serializers.CharField()
    source_claims = serializers.JSONField()
    external_url = serializers.URLField(allow_blank=True)
    is_negotiable = serializers.BooleanField()
    is_convertible = serializers.BooleanField()
    availability_confirmed_at = serializers.DateTimeField()
    available_until = serializers.DateTimeField()


class PropertyDetailSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    title = serializers.CharField()
    canonical_slug = serializers.CharField()
    location = LocationSerializer()
    property_type = serializers.ChoiceField(choices=PropertyType.choices)
    property_type_label = serializers.CharField()
    area_sqm = serializers.IntegerField()
    room_count = serializers.IntegerField()
    construction_year = serializers.IntegerField(allow_null=True)
    floor = serializers.IntegerField(allow_null=True)
    total_floors = serializers.IntegerField(allow_null=True)
    units_per_floor = serializers.IntegerField(allow_null=True)
    heating = serializers.CharField()
    cooling = serializers.CharField()
    features = FeaturesSerializer()
    listings = ListingPublicSerializer(many=True)


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
                "source_claims": listing.source_claims,
                "external_url": listing.external_url,
                "is_negotiable": listing.terms.is_negotiable,
                "is_convertible": listing.terms.is_convertible,
                "availability_confirmed_at": listing.availability_confirmed_at,
                "available_until": listing.available_until,
            }
            for listing in listings
        ],
    }
