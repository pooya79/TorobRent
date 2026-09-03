from datetime import timedelta
from typing import Any

from django.utils import timezone
from rest_framework import serializers

from .models import (
    ExternalContactChannel,
    IdentityVerificationMethod,
    PrivacyActionType,
    SupportClassification,
    SupportExternalContact,
    SupportIdentityVerification,
    SupportMessage,
    SupportMessageAuthor,
    SupportPriority,
    SupportPrivacyAction,
    SupportRequest,
    SupportRequestEvent,
    SupportRequestNote,
    SupportRequestStatus,
    SupportRequiredCapability,
    SupportResolutionCategory,
)


class SupportTriageSerializer(serializers.Serializer[Any]):
    classification = serializers.ChoiceField(
        choices=SupportClassification.choices,
        required=False,
    )
    priority = serializers.ChoiceField(choices=SupportPriority.choices, required=False)
    status = serializers.ChoiceField(
        choices=((SupportRequestStatus.ESCALATED, "Escalated"),),
        required=False,
    )
    escalation_destination = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=120,
    )
    required_capability = serializers.ChoiceField(
        choices=SupportRequiredCapability.choices,
        required=False,
        allow_blank=True,
    )
    reason = serializers.CharField(required=False, allow_blank=True, max_length=1000)

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        if not any(field in attrs for field in ("classification", "priority", "status")):
            raise serializers.ValidationError("At least one triage change is required.")
        if attrs.get("status") == SupportRequestStatus.ESCALATED and not (
            attrs.get("escalation_destination") or attrs.get("required_capability")
        ):
            raise serializers.ValidationError(
                "An escalation destination or required capability is required."
            )
        return attrs


class SupportReassignmentSerializer(serializers.Serializer[Any]):
    assignee_email = serializers.EmailField()
    reason = serializers.CharField(max_length=1000)


class SupportResolutionSerializer(serializers.Serializer[Any]):
    category = serializers.ChoiceField(choices=SupportResolutionCategory.choices)
    summary = serializers.CharField(max_length=1000)


class SupportWorkloadSummarySerializer(serializers.Serializer[dict[str, int]]):
    unclaimed_count = serializers.IntegerField(min_value=0)
    assigned_to_me_count = serializers.IntegerField(min_value=0)
    urgent_count = serializers.IntegerField(min_value=0)
    aging_count = serializers.IntegerField(min_value=0)
    aging_after_hours = serializers.IntegerField(min_value=1)


class SupportReopenSerializer(serializers.Serializer[Any]):
    reason = serializers.CharField(max_length=1000)


class SupportRequestNoteCreateSerializer(serializers.Serializer[Any]):
    body = serializers.CharField(max_length=2000)
    corrects_note = serializers.UUIDField(required=False, allow_null=True)


class SupportReplyCreateSerializer(serializers.Serializer[Any]):
    body = serializers.CharField(max_length=2000)


class SupportReplySerializer(serializers.ModelSerializer[SupportMessage]):
    editable = serializers.SerializerMethodField()

    class Meta:
        model = SupportMessage
        fields = (
            "id",
            "author_kind",
            "is_initial",
            "body",
            "created_at",
            "edited_at",
            "editable",
        )

    def get_editable(self, message: SupportMessage) -> bool:
        request = self.context.get("request")
        return bool(
            request
            and request.user.is_authenticated
            and message.author_kind == SupportMessageAuthor.OPERATOR
            and message.author_id == request.user.id
            and message.created_at >= timezone.now() - timedelta(minutes=15)
        )


class SupportRequestNoteSerializer(serializers.ModelSerializer[SupportRequestNote]):
    actor_reference = serializers.UUIDField(
        source="actor.historical_actor_reference", read_only=True
    )
    actor_label = serializers.CharField(source="actor.historical_actor_label", read_only=True)
    actor_email = serializers.EmailField(
        source="actor.historical_actor_email", read_only=True, allow_null=True
    )

    class Meta:
        model = SupportRequestNote
        fields = (
            "id",
            "actor_id",
            "actor_reference",
            "actor_label",
            "actor_email",
            "body",
            "corrects_note",
            "created_at",
        )


class SupportExternalContactCreateSerializer(serializers.Serializer[Any]):
    channel = serializers.ChoiceField(choices=ExternalContactChannel.choices)
    occurred_at = serializers.DateTimeField()
    outcome = serializers.CharField(max_length=120)
    summary = serializers.CharField(max_length=1000)


class SupportExternalContactSerializer(serializers.ModelSerializer[SupportExternalContact]):
    actor_reference = serializers.UUIDField(
        source="actor.historical_actor_reference", read_only=True
    )
    actor_label = serializers.CharField(source="actor.historical_actor_label", read_only=True)
    actor_email = serializers.EmailField(
        source="actor.historical_actor_email", read_only=True, allow_null=True
    )

    class Meta:
        model = SupportExternalContact
        fields = (
            "id",
            "actor_id",
            "actor_reference",
            "actor_label",
            "actor_email",
            "channel",
            "occurred_at",
            "outcome",
            "summary",
            "created_at",
        )


class SupportIdentityVerificationCreateSerializer(serializers.Serializer[Any]):
    method = serializers.ChoiceField(choices=IdentityVerificationMethod.choices)
    verified_at = serializers.DateTimeField()
    summary = serializers.CharField(max_length=1000)


class SupportIdentityVerificationSerializer(
    serializers.ModelSerializer[SupportIdentityVerification]
):
    actor_reference = serializers.UUIDField(
        source="actor.historical_actor_reference", read_only=True
    )
    actor_label = serializers.CharField(source="actor.historical_actor_label", read_only=True)
    actor_email = serializers.EmailField(
        source="actor.historical_actor_email", read_only=True, allow_null=True
    )

    class Meta:
        model = SupportIdentityVerification
        fields = (
            "id",
            "actor_id",
            "actor_reference",
            "actor_label",
            "actor_email",
            "method",
            "verified_at",
            "summary",
            "created_at",
        )


class SupportPrivacyActionCreateSerializer(serializers.Serializer[Any]):
    action = serializers.ChoiceField(choices=PrivacyActionType.choices)
    completed_at = serializers.DateTimeField()
    summary = serializers.CharField(max_length=1000)


class SupportPrivacyActionSerializer(serializers.ModelSerializer[SupportPrivacyAction]):
    actor_reference = serializers.UUIDField(
        source="actor.historical_actor_reference", read_only=True
    )
    actor_label = serializers.CharField(source="actor.historical_actor_label", read_only=True)
    actor_email = serializers.EmailField(
        source="actor.historical_actor_email", read_only=True, allow_null=True
    )

    class Meta:
        model = SupportPrivacyAction
        fields = (
            "id",
            "actor_id",
            "actor_reference",
            "actor_label",
            "actor_email",
            "action",
            "completed_at",
            "summary",
            "created_at",
        )


SUPPORT_REQUEST_QUEUE_FIELDS = (
    "id",
    "name",
    "email",
    "account_linked_at_intake",
    "intake_kind",
    "subject",
    "classification",
    "priority",
    "priority_locked",
    "status",
    "escalation_destination",
    "required_capability",
    "assignee_id",
    "assignee_email",
    "assigned_at",
    "created_at",
    "updated_at",
    "resolved_by_id",
    "resolved_at",
    "resolution_category",
    "resolution_summary",
    "personal_content_redacted_at",
)


class SupportRequestQueueSerializer(serializers.ModelSerializer[SupportRequest]):
    assignee_email = serializers.EmailField(
        source="assignee.email", read_only=True, allow_null=True
    )

    class Meta:
        model = SupportRequest
        fields = SUPPORT_REQUEST_QUEUE_FIELDS


class SupportRequestEventSerializer(serializers.ModelSerializer[SupportRequestEvent]):
    actor_reference = serializers.UUIDField(
        source="actor.historical_actor_reference", read_only=True, allow_null=True
    )
    actor_label = serializers.CharField(
        source="actor.historical_actor_label", read_only=True, allow_null=True
    )
    actor_email = serializers.EmailField(
        source="actor.historical_actor_email", read_only=True, allow_null=True
    )

    class Meta:
        model = SupportRequestEvent
        fields = (
            "id",
            "event_type",
            "requester_initiated",
            "actor_id",
            "actor_reference",
            "actor_label",
            "actor_email",
            "prior_state",
            "new_state",
            "classification",
            "prior_classification",
            "new_classification",
            "prior_priority",
            "new_priority",
            "escalation_destination",
            "required_capability",
            "prior_assignee_id",
            "new_assignee_id",
            "reason",
            "resolution_category",
            "resolution_summary",
            "created_at",
        )


class SupportRequestSerializer(SupportRequestQueueSerializer):
    history = SupportRequestEventSerializer(source="events", many=True, read_only=True)
    notes = SupportRequestNoteSerializer(many=True, read_only=True)
    external_contacts = SupportExternalContactSerializer(many=True, read_only=True)
    identity_verifications = SupportIdentityVerificationSerializer(many=True, read_only=True)
    privacy_actions = SupportPrivacyActionSerializer(many=True, read_only=True)
    replies = SupportReplySerializer(source="messages", many=True, read_only=True)

    class Meta:
        model = SupportRequest
        fields = (
            *SUPPORT_REQUEST_QUEUE_FIELDS,
            "message",
            "notes",
            "external_contacts",
            "identity_verifications",
            "privacy_actions",
            "replies",
            "history",
        )
