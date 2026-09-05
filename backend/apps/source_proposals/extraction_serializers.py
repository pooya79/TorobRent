from typing import Any

from rest_framework import serializers

from .candidate_serializers import ExternalListingCandidateSerializer
from .models import ExtractionRequest, ExtractionRun, ExtractionRunDecision


class ExtractionErrorSerializer(serializers.Serializer[Any]):
    code = serializers.CharField()
    detail = serializers.CharField()
    transient = serializers.BooleanField()


class ExtractionRunDecisionSerializer(serializers.ModelSerializer[ExtractionRunDecision]):
    class Meta:
        model = ExtractionRunDecision
        fields = ("id", "actor", "revision", "candidate_ids", "created_at")


class ExtractionRunSerializer(serializers.ModelSerializer[ExtractionRun]):
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
            "discovered",
            "extracted",
            "published",
            "needs_attention",
            "rejected",
            "failed",
            "errors",
            "withdrawals",
        )
        read_only_fields = fields


class ExtractionRequestSerializer(serializers.ModelSerializer[ExtractionRequest]):
    run = ExtractionRunSerializer(read_only=True, allow_null=True)

    class Meta:
        model = ExtractionRequest
        fields = (
            "id",
            "assignment",
            "requester",
            "profile_version",
            "submitted_url",
            "canonical_url",
            "state",
            "created_at",
            "updated_at",
            "run",
        )
        read_only_fields = fields


class ExtractionSubmitSerializer(serializers.Serializer[Any]):
    assignment = serializers.IntegerField(min_value=1)
    url = serializers.CharField(max_length=1000, trim_whitespace=False)
