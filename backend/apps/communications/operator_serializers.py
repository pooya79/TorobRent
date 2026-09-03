from typing import Any

from rest_framework import serializers

from .models import (
    ConversationModerationEvent,
    ConversationReport,
    ConversationReportDecision,
)


class ConversationModerationEventSerializer(
    serializers.ModelSerializer[ConversationModerationEvent]
):
    actor_label = serializers.SerializerMethodField()

    class Meta:
        model = ConversationModerationEvent
        fields = (
            "id",
            "event_type",
            "actor_label",
            "internal_note",
            "metadata",
            "created_at",
        )

    def get_actor_label(self, event: ConversationModerationEvent) -> str:
        return event.actor.email or str(event.actor_id)


class FrozenConversationParticipantsSerializer(serializers.Serializer[Any]):
    renter_id = serializers.UUIDField()
    submitter_id = serializers.UUIDField()


class FrozenConversationMessageSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    author_id = serializers.UUIDField()
    author_display_name = serializers.CharField()
    body = serializers.CharField()
    created_at = serializers.DateTimeField()
    edited_at = serializers.DateTimeField(allow_null=True)


class FrozenConversationEvidenceSerializer(serializers.Serializer[Any]):
    inquiry_id = serializers.UUIDField()
    target_message_id = serializers.UUIDField(allow_null=True)
    participants = FrozenConversationParticipantsSerializer()
    messages = FrozenConversationMessageSerializer(many=True)


class ConversationReportQueueSerializer(serializers.ModelSerializer[ConversationReport]):
    target = serializers.SerializerMethodField()

    class Meta:
        model = ConversationReport
        fields = ("id", "status", "target", "created_at")

    def get_target(self, report: ConversationReport) -> str:
        return report.target_kind


class ConversationReportDetailSerializer(ConversationReportQueueSerializer):
    evidence = FrozenConversationEvidenceSerializer(allow_null=True)
    reporter = serializers.SerializerMethodField()
    audit_history = ConversationModerationEventSerializer(
        source="moderation_events",
        many=True,
        read_only=True,
    )
    pair_restricted = serializers.SerializerMethodField()
    suspended_account_ids = serializers.SerializerMethodField()

    class Meta:
        model = ConversationReport
        fields = (
            "id",
            "status",
            "target",
            "created_at",
            "explanation",
            "evidence",
            "evidence_retention_status",
            "evidence_released_at",
            "reporter",
            "pair_restricted",
            "suspended_account_ids",
            "audit_history",
        )

    def get_reporter(self, report: ConversationReport) -> dict[str, str]:
        return {"display_name": report.reporter_display_name_snapshot or "حذف‌شده"}

    def get_pair_restricted(self, report: ConversationReport) -> bool:
        return hasattr(report, "pair_restriction")

    def get_suspended_account_ids(self, report: ConversationReport) -> list[str]:
        return [str(item.account_id) for item in report.initiation_suspensions.all()]


class ConversationReportDecisionSerializer(serializers.Serializer[Any]):
    decision = serializers.ChoiceField(choices=ConversationReportDecision.choices)
    internal_note = serializers.CharField(max_length=2000, allow_blank=True, default="")
    restrict_pair = serializers.BooleanField(default=False)
    suspend_account_id = serializers.UUIDField(required=False, allow_null=True, default=None)


class ConversationReportDecisionResultSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    status = serializers.ChoiceField(choices=ConversationReportDecision.choices)
    pair_restricted = serializers.BooleanField()
    suspended_account_id = serializers.UUIDField(allow_null=True)
    decided_at = serializers.DateTimeField()


class ConversationEvidenceReleaseSerializer(serializers.Serializer[Any]):
    internal_note = serializers.CharField(max_length=2000, allow_blank=True, default="")


class ConversationEvidenceReleaseResultSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    evidence_retention_status = serializers.CharField()
    evidence_released_at = serializers.DateTimeField()
