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
    group = serializers.SerializerMethodField()

    class Meta:
        model = SystemNotification
        fields = ("id", "kind", "title", "preview", "created_at", "read", "group")

    @extend_schema_field(serializers.ChoiceField(choices=MessageKind.choices))
    def get_kind(self, notification: SystemNotification) -> str:
        return MessageKind.SYSTEM_NOTIFICATION

    def get_title(self, notification: SystemNotification) -> str:
        source_proposal_event = notification.originating_source_proposal_event
        if source_proposal_event is not None:
            return {
                "changes_requested": "منبع پیشنهادی نیازمند اصلاح است",
                "rejected": "منبع پیشنهادی شما رد شد",
                "approved": "منبع پیشنهادی شما تایید شد",
            }[source_proposal_event.new_state]
        submission_event = notification.originating_event
        assert submission_event is not None
        return {
            "changes_requested": "اصلاح پیشنهاد لازم است",
            "rejected": "پیشنهاد شما رد شد",
            "published": "پیشنهاد شما منتشر شد",
        }[submission_event.new_state]

    def get_preview(self, notification: SystemNotification) -> str:
        source_proposal_event = notification.originating_source_proposal_event
        event = source_proposal_event or notification.originating_event
        assert event is not None
        if source_proposal_event is not None and event.new_state == "approved":
            return "منبع پیشنهادی شما بررسی و تایید شد."
        if event.new_state == "published":
            return "پیشنهاد شما بررسی و منتشر شد."
        if event.reason:
            return event.reason
        return "نتیجه بررسی پیشنهاد شما ثبت شد."

    def get_read(self, notification: SystemNotification) -> bool:
        return hasattr(notification, "read_state")

    @extend_schema_field(
        inline_serializer(
            name="MessageGroup",
            fields={
                "kind": serializers.ChoiceField(choices=("submission", "source_proposal")),
                "id": serializers.UUIDField(),
                "label": serializers.CharField(),
            },
        )
    )
    def get_group(self, notification: SystemNotification) -> dict[str, str]:
        source_proposal_event = notification.originating_source_proposal_event
        if source_proposal_event is not None:
            proposal = source_proposal_event.proposal
            return {
                "kind": "source_proposal",
                "id": str(proposal.id),
                "label": proposal.website_name or proposal.normalized_domain or "منبع پیشنهادی",
            }
        submission_event = notification.originating_event
        assert submission_event is not None
        submission = submission_event.submission
        return {
            "kind": "submission",
            "id": str(submission.id),
            "label": "پیشنهاد ملک",
        }


class MessageDetailSerializer(MessageSummarySerializer):
    body = serializers.SerializerMethodField()
    target = serializers.SerializerMethodField()

    class Meta:
        model = SystemNotification
        fields = ("id", "kind", "title", "body", "created_at", "read", "target", "group")

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
        if notification.originating_source_proposal_event is not None:
            proposal = notification.target_source_proposal
            if (
                proposal is None
                or proposal.submitter_id != notification.recipient_id
                or not notification.recipient.is_submitter
                or not notification.recipient.phone_verified
            ):
                return None
            return {
                "label": "مشاهده منبع پیشنهادی",
                "href": f"/source-proposal?proposal={proposal.id}",
            }
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
