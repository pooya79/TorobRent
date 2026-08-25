from typing import Any, cast

from rest_framework import serializers

from .models import (
    ExternalContactChannel,
    IdentityVerificationMethod,
    IntakeKind,
    PrivacyActionType,
    SupportClassification,
    SupportExternalContact,
    SupportIdentityVerification,
    SupportPriority,
    SupportPrivacyAction,
    SupportRequest,
    SupportRequestEvent,
    SupportRequestNote,
    SupportRequestStatus,
    SupportRequiredCapability,
    SupportResolutionCategory,
)
from .services import create_support_request


class ContactMessageCreateSerializer(serializers.ModelSerializer[SupportRequest]):
    kind = serializers.ChoiceField(source="intake_kind", choices=IntakeKind.choices)
    website = serializers.CharField(
        required=False,
        allow_blank=True,
        write_only=True,
        label="وب‌سایت",
    )

    class Meta:
        model = SupportRequest
        fields = ("name", "email", "kind", "message", "website")
        extra_kwargs = {
            "name": {
                "error_messages": {
                    "blank": "نام را وارد کنید.",
                    "required": "نام را وارد کنید.",
                    "max_length": "نام نباید بیشتر از ۱۲۰ نویسه باشد.",
                }
            },
            "email": {
                "error_messages": {
                    "blank": "ایمیل را وارد کنید.",
                    "required": "ایمیل را وارد کنید.",
                    "invalid": "یک ایمیل معتبر وارد کنید.",
                    "max_length": "ایمیل نباید بیشتر از ۲۵۴ نویسه باشد.",
                }
            },
            "kind": {
                "error_messages": {
                    "blank": "موضوع پیام را انتخاب کنید.",
                    "required": "موضوع پیام را انتخاب کنید.",
                    "invalid_choice": "موضوع پیام معتبر نیست.",
                }
            },
            "message": {
                "min_length": 10,
                "error_messages": {
                    "blank": "متن پیام را وارد کنید.",
                    "required": "متن پیام را وارد کنید.",
                    "min_length": "متن پیام باید دست‌کم ۱۰ نویسه باشد.",
                    "max_length": "متن پیام نباید بیشتر از ۴۰۰۰ نویسه باشد.",
                },
            },
        }

    def validate_website(self, value: str) -> str:
        if value:
            raise serializers.ValidationError("ارسال پیام پذیرفته نشد.")
        return value

    def create(self, validated_data: dict[str, object]) -> SupportRequest:
        validated_data.pop("website", None)
        request = self.context["request"]
        submitter = request.user if request.user.is_authenticated else None
        return create_support_request(
            submitter=submitter,
            name=cast(str, validated_data["name"]),
            email=cast(str, validated_data["email"]),
            intake_kind=cast(IntakeKind, validated_data["intake_kind"]),
            message=cast(str, validated_data["message"]),
        )


class ContactMessageCreatedSerializer(serializers.Serializer[Any]):
    detail = serializers.CharField()


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
        source="actor.historical_actor_reference", read_only=True
    )
    actor_label = serializers.CharField(source="actor.historical_actor_label", read_only=True)
    actor_email = serializers.EmailField(
        source="actor.historical_actor_email", read_only=True, allow_null=True
    )

    class Meta:
        model = SupportRequestEvent
        fields = (
            "id",
            "event_type",
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

    class Meta:
        model = SupportRequest
        fields = (
            *SUPPORT_REQUEST_QUEUE_FIELDS,
            "message",
            "notes",
            "external_contacts",
            "identity_verifications",
            "privacy_actions",
            "history",
        )
