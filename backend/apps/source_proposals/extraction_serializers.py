from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .candidate_serializers import ExternalListingCandidateSerializer
from .models import ExtractionRequest, ExtractionRun, ExtractionRunDecision, PublicationOutcome


class ExtractionErrorSerializer(serializers.Serializer[Any]):
    url = serializers.CharField(required=False)
    code = serializers.CharField()
    detail = serializers.CharField()
    transient = serializers.BooleanField()


class ExtractionRunDecisionSerializer(serializers.ModelSerializer[ExtractionRunDecision]):
    class Meta:
        model = ExtractionRunDecision
        fields = ("id", "actor", "revision", "candidate_ids", "created_at")


class ExcludedPageSerializer(serializers.Serializer[Any]):
    url = serializers.CharField()
    exclusion_id = serializers.UUIDField()
    reason = serializers.CharField()


class PublicationOutcomesSerializer(serializers.Serializer[Any]):
    new = serializers.IntegerField(min_value=0)
    updated = serializers.IntegerField(min_value=0)
    unchanged = serializers.IntegerField(min_value=0)
    unclassified = serializers.IntegerField(min_value=0)


class ExtractionRunSerializer(serializers.ModelSerializer[ExtractionRun]):
    publication_outcomes = serializers.SerializerMethodField()

    @extend_schema_field(PublicationOutcomesSerializer)
    def get_publication_outcomes(self, run: ExtractionRun) -> dict[str, int]:
        counts = {**dict.fromkeys(PublicationOutcome.values, 0), "unclassified": 0}
        for candidate in run.candidates.all():
            if candidate.state == "published":
                counts[candidate.publication_outcome or "unclassified"] += 1
        return counts

    skipped_pages = ExcludedPageSerializer(many=True, read_only=True)
    candidates = ExternalListingCandidateSerializer(many=True, read_only=True)
    decisions = ExtractionRunDecisionSerializer(many=True, read_only=True)
    errors = ExtractionErrorSerializer(many=True, read_only=True)  # type: ignore[assignment]

    class Meta:
        model = ExtractionRun
        fields = (
            "id",
            "profile_version",
            "pipeline_version",
            "revision",
            "candidates",
            "decisions",
            "state",
            "attempts",
            "started_at",
            "completed_at",
            "attempted_pages",
            "discovery_stop_reason",
            "usable_results",
            "discovered",
            "extracted",
            "published",
            "publication_outcomes",
            "needs_attention",
            "rejected",
            "failed",
            "errors",
            "withdrawals",
            "skipped_pages",
        )
        read_only_fields = fields


class ExtractionRequestSerializer(serializers.ModelSerializer[ExtractionRequest]):
    max_pages = serializers.IntegerField(
        source="profile_version.reservation.max_pages", read_only=True
    )
    target_detail_pages = serializers.IntegerField(
        source="profile_version.reservation.target_detail_pages", read_only=True
    )
    is_current = serializers.SerializerMethodField()

    def get_is_current(self, request: ExtractionRequest) -> bool:
        from .extraction import authorized

        return authorized(request)

    run = ExtractionRunSerializer(read_only=True, allow_null=True)

    class Meta:
        model = ExtractionRequest
        fields = (
            "id",
            "is_current",
            "assignment",
            "requester",
            "profile_version",
            "delivery_error",
            "submitted_url",
            "canonical_url",
            "max_pages",
            "target_detail_pages",
            "state",
            "created_at",
            "updated_at",
            "run",
        )
        read_only_fields = fields


class ExtractionSubmitSerializer(serializers.Serializer[Any]):
    assignment = serializers.IntegerField(min_value=1)
    url = serializers.CharField(max_length=1000, trim_whitespace=False)
