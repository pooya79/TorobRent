from typing import Any

from rest_framework import serializers

from .models import IntakeKind, SupportRequest, SupportRequestEvent


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
        return SupportRequest.objects.create(submitter=submitter, **validated_data)


class ContactMessageCreatedSerializer(serializers.Serializer[Any]):
    detail = serializers.CharField()


SUPPORT_REQUEST_QUEUE_FIELDS = (
    "id",
    "name",
    "email",
    "intake_kind",
    "classification",
    "status",
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
            "reason",
            "created_at",
        )


class SupportRequestSerializer(SupportRequestQueueSerializer):
    history = SupportRequestEventSerializer(source="events", many=True, read_only=True)

    class Meta:
        model = SupportRequest
        fields = (*SUPPORT_REQUEST_QUEUE_FIELDS, "message", "operator_note", "history")
