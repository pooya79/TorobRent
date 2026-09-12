from typing import Any

from rest_framework import serializers

from .models import Listing, Property, PropertyMatchDecision


def _source_data(listing: Listing) -> dict[str, object]:
    return {
        "id": listing.source_id,
        "name": listing.source.display_name,
        "domain": listing.source.domain,
    }


def property_search_data(property_: Property) -> dict[str, object]:
    return {
        "id": property_.id,
        "title": property_.title,
        "property_type": property_.property_type,
        "area_sqm": property_.area_sqm,
        "room_count": property_.room_count,
        "city": property_.city.name_fa if property_.city else None,
        "neighborhood": property_.neighborhood.name_fa if property_.neighborhood else None,
        "listings": [
            {
                "id": listing.id,
                "source": _source_data(listing),
                "source_reference": listing.source_reference,
            }
            for listing in property_.listings.all()
        ],
    }


def property_evidence_data(property_: Property) -> dict[str, object]:
    return {
        "id": property_.id,
        "normalized_facts": {
            "city": property_.city.name_fa if property_.city else None,
            "district": property_.district.name_fa if property_.district else None,
            "neighborhood": (property_.neighborhood.name_fa if property_.neighborhood else None),
            "property_type": property_.property_type,
            "area_sqm": property_.area_sqm,
            "room_count": property_.room_count,
            "construction_year": property_.construction_year,
            "floor": property_.floor,
            "total_floors": property_.total_floors,
            "units_per_floor": property_.units_per_floor,
            "parking": property_.parking,
            "elevator": property_.elevator,
            "storage": property_.storage,
            "balcony": property_.balcony,
            "furnished": property_.furnished,
            "heating": property_.heating,
            "cooling": property_.cooling,
        },
        "provenance_note": property_.provenance_note,
        "exact_location": {
            "latitude": property_.latitude,
            "longitude": property_.longitude,
            "operator_notes": property_.operator_location_notes,
        },
        "listings": [
            {
                "id": listing.id,
                "source": _source_data(listing),
                "source_reference": listing.source_reference,
                "source_claims": listing.source_claims,
                "provenance_note": listing.provenance_note,
            }
            for listing in property_.listings.all()
        ],
    }


class CatalogCurationSourceSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    name = serializers.CharField()
    domain = serializers.CharField()


class CatalogCurationListingSummarySerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    source = CatalogCurationSourceSerializer()  # type: ignore[assignment]
    source_reference = serializers.CharField()


class CatalogCurationPropertySearchSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    title = serializers.CharField()
    property_type = serializers.CharField()
    area_sqm = serializers.IntegerField(allow_null=True)
    room_count = serializers.IntegerField(allow_null=True)
    city = serializers.CharField(allow_null=True)
    neighborhood = serializers.CharField(allow_null=True)
    listings = CatalogCurationListingSummarySerializer(many=True)


class CatalogCurationPropertySearchPageSerializer(serializers.Serializer[Any]):
    count = serializers.IntegerField(min_value=0)
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = CatalogCurationPropertySearchSerializer(many=True)


class CatalogCurationExactLocationSerializer(serializers.Serializer[Any]):
    latitude = serializers.DecimalField(max_digits=9, decimal_places=6, allow_null=True)
    longitude = serializers.DecimalField(max_digits=9, decimal_places=6, allow_null=True)
    operator_notes = serializers.CharField()


class CatalogCurationListingEvidenceSerializer(CatalogCurationListingSummarySerializer):
    source_claims = serializers.JSONField()
    provenance_note = serializers.CharField()


class CatalogCurationPropertyEvidenceSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    normalized_facts = serializers.DictField()
    provenance_note = serializers.CharField()
    exact_location = CatalogCurationExactLocationSerializer()
    listings = CatalogCurationListingEvidenceSerializer(many=True)


class MatchSignalSerializer(serializers.Serializer[Any]):
    key = serializers.CharField()
    label = serializers.CharField()  # type: ignore[assignment]
    compared_values = serializers.DictField()
    classification = serializers.ChoiceField(
        choices=("support", "contradiction", "neutral", "blocker")
    )
    contribution = serializers.IntegerField()


class PropertyMatchClaimSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    actor_id = serializers.UUIDField()
    expires_at = serializers.DateTimeField()


class PropertyMatchClaimRequestSerializer(serializers.Serializer[Any]):
    properties = serializers.ListField(child=serializers.UUIDField(), min_length=2, max_length=2)
    revision = serializers.CharField(max_length=64)


class PropertyMatchFactSerializer(serializers.Serializer[Any]):
    key = serializers.CharField()
    label = serializers.CharField()  # type: ignore[assignment]
    values = serializers.DictField()
    display_values = serializers.DictField()
    conflicting = serializers.BooleanField()


class PropertyMatchImageSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    property_id = serializers.UUIDField()
    url = serializers.CharField()


class PropertyComparisonSerializer(serializers.Serializer[Any]):
    scoring_version = serializers.CharField()
    score = serializers.IntegerField(min_value=0, max_value=100)
    band = serializers.ChoiceField(choices=("likely", "possible", "below_threshold"))
    is_calibrated_probability = serializers.BooleanField()
    signals = MatchSignalSerializer(many=True)
    properties = CatalogCurationPropertyEvidenceSerializer(many=True)
    revision = serializers.CharField()
    claim = PropertyMatchClaimSerializer(allow_null=True)
    suggested_survivor_id = serializers.UUIDField()
    decision_fields = PropertyMatchFactSerializer(many=True)
    property_images = PropertyMatchImageSerializer(many=True)


class PropertyMatchApproveRequestSerializer(PropertyMatchClaimRequestSerializer):
    claim_id = serializers.UUIDField()
    survivor_id = serializers.UUIDField()
    survivor_confirmed = serializers.BooleanField()
    fact_choices = serializers.DictField(child=serializers.UUIDField())
    image_ids = serializers.ListField(child=serializers.UUIDField(), max_length=100)
    images_confirmed = serializers.BooleanField()
    warning_confirmed = serializers.BooleanField(default=False)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=4000, default="")


class PropertyMatchDecisionSerializer(serializers.ModelSerializer[PropertyMatchDecision]):
    actor_id = serializers.UUIDField()
    survivor_id = serializers.UUIDField()
    redundant_id = serializers.UUIDField()
    grouping_event_ids: serializers.PrimaryKeyRelatedField[Any] = (
        serializers.PrimaryKeyRelatedField(source="grouping_events", many=True, read_only=True)
    )

    class Meta:
        model = PropertyMatchDecision
        fields = (
            "id",
            "actor_id",
            "origin",
            "survivor_id",
            "redundant_id",
            "before_revision",
            "after_revision",
            "evidence",
            "after_snapshot",
            "selected_facts",
            "selected_image_ids",
            "affected_listing_ids",
            "grouping_event_ids",
            "reason",
            "created_at",
        )
        read_only_fields = fields
