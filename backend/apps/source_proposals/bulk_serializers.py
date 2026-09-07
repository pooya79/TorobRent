from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .exception_serializers import SourceExceptionRetrySerializer
from .serializers import ExternalListingCandidateSerializer


class SourceBulkPreviewRequestSerializer(SourceExceptionRetrySerializer):
    action = serializers.ChoiceField(choices=["publish", "exclude", "request_action"])
    reason = serializers.CharField(max_length=4000, required=False, default="", allow_blank=True)


class SourceBulkItemSerializer(serializers.Serializer[dict[str, object]]):
    id = serializers.UUIDField()
    url = serializers.URLField()
    status = serializers.ChoiceField(choices=["eligible", "blocked", "excluded", "obsolete"])
    detail = serializers.CharField()
    candidate_id = serializers.UUIDField(allow_null=True)
    candidate = serializers.SerializerMethodField()

    @extend_schema_field(ExternalListingCandidateSerializer(allow_null=True))
    def get_candidate(self, item: dict[str, Any]) -> Any:
        return item["candidate"]

    action_eligible = serializers.BooleanField()
    published_listing_count = serializers.IntegerField()


class SourceBulkPreviewSerializer(serializers.Serializer[dict[str, object]]):
    token = serializers.CharField()
    source_id = serializers.UUIDField()
    items = SourceBulkItemSerializer(many=True)


class SourceBulkApplyRequestSerializer(serializers.Serializer[dict[str, object]]):
    token = serializers.CharField(max_length=16000)
    confirmed = serializers.BooleanField()


class SourceBulkResultSerializer(serializers.Serializer[dict[str, object]]):
    affected = serializers.IntegerField()
