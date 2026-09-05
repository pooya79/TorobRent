from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import (
    CandidateImage,
    CandidateImageVariant,
    ExternalListingCandidate,
    ExternalListingCandidateEvent,
)


class ExternalCandidateSourceSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    display_name = serializers.CharField()
    domain = serializers.CharField()
    is_active = serializers.BooleanField()


class ExternalListingCandidateEventSerializer(
    serializers.ModelSerializer[ExternalListingCandidateEvent]
):
    actor_label = serializers.CharField(
        source="actor.email", read_only=True, default="انتشار خودکار"
    )

    class Meta:
        model = ExternalListingCandidateEvent
        fields = (
            "id",
            "actor_label",
            "revision",
            "prior_state",
            "new_state",
            "reason",
            "corrections",
            "created_at",
        )


class CandidateImageVariantSerializer(serializers.ModelSerializer[CandidateImageVariant]):
    url = serializers.SerializerMethodField()

    class Meta:
        model = CandidateImageVariant
        fields = ("kind", "width", "height", "byte_size", "url")

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_url(self, variant: CandidateImageVariant) -> str | None:
        return (
            f"/api/v1/operator/external-listing-candidates/{variant.image.candidate_id}/media/{variant.pk}/"
            if variant.asset_id
            else None
        )


class CandidateImageSerializer(serializers.ModelSerializer[CandidateImage]):
    variants = CandidateImageVariantSerializer(many=True, read_only=True)

    class Meta:
        model = CandidateImage
        fields = (
            "id",
            "original_url",
            "source_order",
            "position",
            "is_primary",
            "excluded",
            "state",
            "failure_code",
            "content_hash",
            "variants",
            "accepted_at",
            "accepted_by",
        )


class ExternalListingCandidateSerializer(serializers.ModelSerializer[ExternalListingCandidate]):
    source = ExternalCandidateSourceSerializer(read_only=True)  # type: ignore[assignment]
    source_proposal_id = serializers.UUIDField(read_only=True)
    listing_id = serializers.UUIDField(read_only=True, allow_null=True)
    media = CandidateImageSerializer(source="images", many=True, read_only=True)
    history = ExternalListingCandidateEventSerializer(source="events", many=True, read_only=True)

    class Meta:
        model = ExternalListingCandidate
        fields = (
            "id",
            "source_proposal_id",
            "extraction_run",
            "city",
            "district",
            "neighborhood",
            "source_claims",
            "evidence",
            "conflicts",
            "validation_errors",
            "corrections",
            "source",
            "listing_id",
            "state",
            "revision",
            "simulated",
            "title",
            "external_url",
            "property_type",
            "area_sqm",
            "room_count",
            "deposit_rial",
            "monthly_rent_rial",
            "description",
            "media",
            "history",
            "created_at",
            "updated_at",
        )


class CandidateCorrectionValuesSerializer(serializers.ModelSerializer[ExternalListingCandidate]):
    class Meta:
        model = ExternalListingCandidate
        fields = (
            "city",
            "district",
            "neighborhood",
            "property_type",
            "area_sqm",
            "room_count",
            "deposit_rial",
            "monthly_rent_rial",
            "description",
            "title",
        )
        extra_kwargs = {name: {"required": False} for name in fields}

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        neighborhood = attrs.get("neighborhood")
        if neighborhood is not None:
            attrs.setdefault("district", neighborhood.district)
            attrs.setdefault("city", neighborhood.district.city)
        return attrs


class CandidateImageChoiceSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    excluded = serializers.BooleanField()
    is_primary = serializers.BooleanField()
    accept_as_property = serializers.BooleanField()


class CandidateCorrectionSerializer(serializers.Serializer[Any]):
    reviewed_revision = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(max_length=2000)
    values = CandidateCorrectionValuesSerializer()
    media = CandidateImageChoiceSerializer(many=True, required=False)
