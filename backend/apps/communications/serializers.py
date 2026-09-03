from typing import Any

from drf_spectacular.utils import extend_schema_field, inline_serializer
from rest_framework import serializers

from .models import MessageKind, SystemNotification


class MessageListQuerySerializer(serializers.Serializer[Any]):
    kind = serializers.ChoiceField(
        choices=("all", *MessageKind.values),
        default="all",
    )
    unread = serializers.BooleanField(default=False)


class MessageSummarySerializer(serializers.ModelSerializer[SystemNotification]):
    kind = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()
    preview = serializers.SerializerMethodField()
    read = serializers.SerializerMethodField()

    class Meta:
        model = SystemNotification
        fields = ("id", "kind", "title", "preview", "created_at", "read")

    @extend_schema_field(serializers.ChoiceField(choices=MessageKind.choices))
    def get_kind(self, notification: SystemNotification) -> str:
        return MessageKind.SYSTEM_NOTIFICATION

    def get_title(self, notification: SystemNotification) -> str:
        return {
            "changes_requested": "اصلاح پیشنهاد لازم است",
            "rejected": "پیشنهاد شما رد شد",
            "published": "پیشنهاد شما منتشر شد",
        }[notification.originating_event.new_state]

    def get_preview(self, notification: SystemNotification) -> str:
        event = notification.originating_event
        if event.new_state == "published":
            return "پیشنهاد شما بررسی و منتشر شد."
        if event.reason:
            return event.reason
        return "نتیجه بررسی پیشنهاد شما ثبت شد."

    def get_read(self, notification: SystemNotification) -> bool:
        return hasattr(notification, "read_state")


class MessageDetailSerializer(MessageSummarySerializer):
    body = serializers.SerializerMethodField()
    target = serializers.SerializerMethodField()

    class Meta:
        model = SystemNotification
        fields = ("id", "kind", "title", "body", "created_at", "read", "target")

    def get_body(self, notification: SystemNotification) -> str:
        return self.get_preview(notification)

    @extend_schema_field(
        inline_serializer(
            name="MessageTarget",
            fields={"label": serializers.CharField(), "href": serializers.CharField()},
            allow_null=True,
        )
    )
    def get_target(self, notification: SystemNotification) -> dict[str, str] | None:
        submission = notification.target_submission
        if (
            submission is None
            or submission.submitter_id != notification.recipient_id
            or not notification.recipient.is_submitter
            or not notification.recipient.phone_verified
        ):
            return None
        return {
            "label": "مشاهده پیشنهاد",
            "href": f"/dashboard#submission-{submission.id}",
        }


class MessageReadUpdateSerializer(serializers.Serializer[Any]):
    read = serializers.BooleanField()


class UnreadCountSerializer(serializers.Serializer[Any]):
    count = serializers.IntegerField(min_value=0)
