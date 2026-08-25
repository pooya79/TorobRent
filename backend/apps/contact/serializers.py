from typing import Any, cast

from rest_framework import serializers

from .models import (
    IntakeKind,
    SupportClassification,
    SupportPriority,
    SupportRequest,
    SupportRequestEvent,
    SupportRequestStatus,
    SupportRequiredCapability,
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


SUPPORT_REQUEST_QUEUE_FIELDS = (
    "id",
    "name",
    "email",
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
)


class SupportRequestQueueSerializer(serializers.ModelSerializer[SupportRequest]):
    assignee_email = serializers.EmailField(
        source="assignee.email", read_only=True, allow_null=True
    )

    class Meta:
        model = SupportRequest
        fields = SUPPORT_REQUEST_QUEUE_FIELDS


class SupportRequestEventSerializer(serializers.ModelSerializer[SupportRequestEvent]):
    actor_email = serializers.EmailField(source="actor.email", read_only=True)

    class Meta:
        model = SupportRequestEvent
        fields = (
            "id",
            "event_type",
            "actor_id",
            "actor_email",
            "prior_state",
            "new_state",
            "prior_classification",
            "new_classification",
            "prior_priority",
            "new_priority",
            "escalation_destination",
            "required_capability",
            "prior_assignee_id",
            "new_assignee_id",
            "reason",
            "created_at",
        )


class SupportRequestSerializer(SupportRequestQueueSerializer):
    history = SupportRequestEventSerializer(source="events", many=True, read_only=True)

    class Meta:
        model = SupportRequest
        fields = (*SUPPORT_REQUEST_QUEUE_FIELDS, "message", "operator_note", "history")
