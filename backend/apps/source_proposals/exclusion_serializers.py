from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import SourceExclusion, SourceExclusionAction


class SourceExclusionPreviewRequestSerializer(serializers.Serializer[Any]):
    kind = serializers.ChoiceField(choices=("exact", "path_prefix"))
    url = serializers.CharField(max_length=1000, trim_whitespace=False)


class ExclusionListingSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    url = serializers.CharField()


class SourceExclusionPreviewSerializer(SourceExclusionPreviewRequestSerializer):
    known_pages = serializers.ListField(child=serializers.CharField())
    published_listings = ExclusionListingSerializer(many=True)
    known_page_count = serializers.IntegerField()
    published_listing_count = serializers.IntegerField()


class SourceExclusionActionSerializer(serializers.ModelSerializer[SourceExclusionAction]):
    class Meta:
        model = SourceExclusionAction
        fields = ("id", "action", "reason", "listing_ids", "created_at")
        read_only_fields = fields


class SourceExclusionSerializer(serializers.ModelSerializer[SourceExclusion]):
    active = serializers.SerializerMethodField()
    actions = SourceExclusionActionSerializer(many=True, read_only=True)

    @extend_schema_field(serializers.BooleanField())
    def get_active(self, exclusion: SourceExclusion) -> bool:
        return not any(a.action == "remove" for a in exclusion.actions.all())

    class Meta:
        model = SourceExclusion
        fields = ("id", "kind", "url", "reason", "created_at", "active", "actions")
        read_only_fields = fields


class SourceExclusionAddSerializer(SourceExclusionPreviewRequestSerializer):
    reason = serializers.CharField(max_length=2000)
    confirmed = serializers.BooleanField()


class SourceExclusionChangeSerializer(serializers.Serializer[Any]):
    exclusion_id = serializers.UUIDField()
    reason = serializers.CharField(max_length=2000)
    confirmed = serializers.BooleanField()


class SourceExclusionWithdrawSerializer(SourceExclusionChangeSerializer):
    listing_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=100)
