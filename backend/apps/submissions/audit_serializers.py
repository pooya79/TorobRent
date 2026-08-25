from collections.abc import Mapping
from typing import Any, cast

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.catalog.models import FeatureState, ListingState, PropertyType


class SparseAuditSerializer(serializers.Serializer[Any]):
    def to_internal_value(self, data: Any) -> dict[str, Any]:
        if isinstance(data, Mapping) and data.keys() - self.fields.keys():
            raise serializers.ValidationError("Unsupported audit field.")
        return cast(dict[str, Any], super().to_internal_value(data))

    def to_representation(self, instance: Any) -> dict[str, Any]:
        data = super().to_representation(instance)
        if not isinstance(instance, Mapping):
            return data
        return {field: value for field, value in data.items() if field in instance}


class AuditedNormalizedPropertySerializer(SparseAuditSerializer):
    city_id = serializers.UUIDField(required=False)
    district_id = serializers.UUIDField(required=False)
    neighborhood_id = serializers.UUIDField(required=False)
    property_type = serializers.ChoiceField(choices=PropertyType.choices, required=False)
    area_sqm = serializers.IntegerField(required=False)
    room_count = serializers.IntegerField(required=False)
    construction_year = serializers.IntegerField(allow_null=True, required=False)
    floor = serializers.IntegerField(allow_null=True, required=False)
    total_floors = serializers.IntegerField(allow_null=True, required=False)
    units_per_floor = serializers.IntegerField(allow_null=True, required=False)
    parking = serializers.ChoiceField(choices=FeatureState.choices, required=False)
    elevator = serializers.ChoiceField(choices=FeatureState.choices, required=False)
    storage = serializers.ChoiceField(choices=FeatureState.choices, required=False)
    balcony = serializers.ChoiceField(choices=FeatureState.choices, required=False)
    furnished = serializers.ChoiceField(choices=FeatureState.choices, required=False)
    operator_location_notes = serializers.CharField(allow_blank=True, required=False)


class AuditedSourceMetadataSerializer(SparseAuditSerializer):
    source_reference = serializers.CharField(required=False)
    source_claims = serializers.JSONField(required=False)
    provenance_note = serializers.CharField(required=False)


class AuditedFormattingSerializer(SparseAuditSerializer):
    description = serializers.CharField(required=False)


class NormalizedCorrectionsAuditSerializer(SparseAuditSerializer):
    property = AuditedNormalizedPropertySerializer(required=False)
    source_metadata = AuditedSourceMetadataSerializer(required=False)
    formatting = AuditedFormattingSerializer(required=False)


class PublicationResultAuditSerializer(SparseAuditSerializer):
    listing_id = serializers.UUIDField(required=False)
    property_id = serializers.UUIDField(required=False)
    state = serializers.ChoiceField(choices=ListingState.choices, required=False)
    published_at = serializers.DateTimeField(required=False, allow_null=True)
    available_until = serializers.DateTimeField(required=False, allow_null=True)


class DecisionCorrectionAuditSerializer(SparseAuditSerializer):
    internal_note = serializers.CharField(required=False)
    normalized_corrections = NormalizedCorrectionsAuditSerializer(required=False)
    publication_result = PublicationResultAuditSerializer(required=False)


def validate_decision_correction(value: dict[str, object]) -> None:
    serializer = DecisionCorrectionAuditSerializer(data=value)
    try:
        serializer.is_valid(raise_exception=True)
    except serializers.ValidationError:
        raise DjangoValidationError(
            "A break-glass correction contains an unsupported audit field."
        ) from None
