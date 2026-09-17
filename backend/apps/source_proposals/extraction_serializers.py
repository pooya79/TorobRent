from typing import Any

from django.db.models import Count
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
        for row in (
            run.candidates
            .filter(state="published")
            .values("publication_outcome")
            .annotate(total=Count("id"))
        ):
            counts[row["publication_outcome"] or "unclassified"] = row["total"]
        return counts

    ready_count = serializers.SerializerMethodField()

    def get_ready_count(self, run: ExtractionRun) -> int:
        return run.candidates.filter(
            state="pending", superseded=False, validation_errors={}, exclusion_hold__isnull=True
        ).count()

    skipped_pages = serializers.SerializerMethodField()

    @extend_schema_field(ExcludedPageSerializer(many=True))
    def get_skipped_pages(self, run: ExtractionRun) -> list[dict[str, Any]]:
        return (
            []
            if self.context.get("summary") and not self.context.get("technical")
            else run.skipped_pages
        )

    withdrawals = serializers.SerializerMethodField()

    @extend_schema_field(serializers.JSONField())
    def get_withdrawals(self, run: ExtractionRun) -> list[dict[str, Any]]:
        return (
            []
            if self.context.get("summary") and not self.context.get("technical")
            else run.withdrawals
        )

    candidates = serializers.SerializerMethodField()

    @extend_schema_field(ExternalListingCandidateSerializer(many=True))
    def get_candidates(self, run: ExtractionRun) -> list[dict[str, Any]]:
        if self.context.get("summary"):
            return []
        return list(ExternalListingCandidateSerializer(run.candidates.all(), many=True).data)

    decisions = serializers.SerializerMethodField()

    @extend_schema_field(ExtractionRunDecisionSerializer(many=True))
    def get_decisions(self, run: ExtractionRun) -> list[dict[str, Any]]:
        if self.context.get("summary") and not self.context.get("technical"):
            return []
        return list(ExtractionRunDecisionSerializer(run.decisions.all(), many=True).data)

    errors = ExtractionErrorSerializer(many=True, read_only=True)  # type: ignore[assignment]

    class Meta:
        model = ExtractionRun
        fields = (
            "id",
            "profile_version",
            "pipeline_version",
            "revision",
            "candidates",
            "ready_count",
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
        from .source_processing.authorization import authorized

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
