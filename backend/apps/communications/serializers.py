from datetime import datetime, timedelta
from typing import Any

from django.utils import timezone
from drf_spectacular.utils import extend_schema_field, inline_serializer
from rest_framework import serializers

from apps.contact.models import (
    IntakeKind,
    SupportMessage,
    SupportMessageAuthor,
    SupportRequest,
    SupportRequestEventType,
    SupportRequestStatus,
)

from .models import MessageKind, SystemNotification

MessageItem = SystemNotification | SupportRequest


class SupportRequestCreateSerializer(serializers.Serializer[Any]):
    intake_kind = serializers.ChoiceField(choices=IntakeKind.choices)
    subject = serializers.CharField(max_length=120)
    message = serializers.CharField(max_length=2000)


class SupportRequestCreatedSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    href = serializers.CharField()


class SupportMessageCreateSerializer(serializers.Serializer[Any]):
    body = serializers.CharField(max_length=2000)


class SupportMessageSerializer(serializers.ModelSerializer[SupportMessage]):
    class Meta:
        model = SupportMessage
        fields = ("id", "author_kind", "is_initial", "body", "created_at", "edited_at")


class MessageListQuerySerializer(serializers.Serializer[Any]):
    kind = serializers.ChoiceField(
        choices=("all", *MessageKind.values),
        default="all",
    )
    unread = serializers.BooleanField(default=False)


class MessageSummarySerializer(serializers.Serializer[MessageItem]):
    id = serializers.UUIDField(read_only=True)
    kind = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()
    preview = serializers.SerializerMethodField()
    created_at = serializers.SerializerMethodField()
    read = serializers.SerializerMethodField()
    group = serializers.SerializerMethodField()

    @extend_schema_field(serializers.ChoiceField(choices=MessageKind.choices))
    def get_kind(self, item: MessageItem) -> str:
        return (
            MessageKind.SYSTEM_NOTIFICATION
            if isinstance(item, SystemNotification)
            else MessageKind.SUPPORT_REQUEST
        )

    @extend_schema_field(serializers.DateTimeField())
    def get_created_at(self, item: MessageItem) -> datetime:
        return item.created_at if isinstance(item, SystemNotification) else item.public_updated_at

    def get_title(self, notification: MessageItem) -> str:
        if isinstance(notification, SupportRequest):
            return notification.subject or notification.get_intake_kind_display()
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

    def get_preview(self, notification: MessageItem) -> str:
        if isinstance(notification, SupportRequest):
            latest = notification.messages.last()
            return latest.body if latest is not None else notification.message
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

    def get_read(self, notification: MessageItem) -> bool:
        if isinstance(notification, SupportRequest):
            return (
                notification.requester_read_at is not None
                and notification.requester_read_at >= notification.public_updated_at
            )
        return hasattr(notification, "read_state")

    @extend_schema_field(
        inline_serializer(
            name="MessageGroup",
            fields={
                "kind": serializers.ChoiceField(
                    choices=("submission", "source_proposal", "support_request")
                ),
                "id": serializers.UUIDField(),
                "label": serializers.CharField(),
            },
        )
    )
    def get_group(self, notification: MessageItem) -> dict[str, str]:
        if isinstance(notification, SupportRequest):
            return {
                "kind": "support_request",
                "id": str(notification.id),
                "label": "پشتیبانی",
            }
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
    public_status = serializers.SerializerMethodField()
    reply_allowed = serializers.SerializerMethodField()
    entries = serializers.SerializerMethodField()

    def get_body(self, notification: MessageItem) -> str:
        return self.get_preview(notification)

    @extend_schema_field(
        inline_serializer(
            name="MessageTarget",
            fields={"label": serializers.CharField(), "href": serializers.CharField()},
            allow_null=True,
        )
    )
    def get_target(self, notification: MessageItem) -> dict[str, str] | None:
        if isinstance(notification, SupportRequest):
            return None
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

    @staticmethod
    def public_status_for(support_request: SupportRequest) -> str:
        event = (
            support_request.events
            .filter(
                event_type__in=(
                    SupportRequestEventType.ASSIGNED,
                    SupportRequestEventType.RELEASED,
                    SupportRequestEventType.REOPENED,
                    SupportRequestEventType.RESOLVED,
                )
            )
            .order_by("-created_at", "-id")
            .first()
        )
        if event is None:
            return "received"
        if event.event_type == SupportRequestEventType.RESOLVED:
            return "resolved"
        if event.event_type == SupportRequestEventType.ASSIGNED or (
            event.event_type == SupportRequestEventType.REOPENED
            and event.new_state == SupportRequestStatus.IN_PROGRESS
        ):
            return "in_progress"
        return "received"

    def get_public_status(self, item: MessageItem) -> str | None:
        if isinstance(item, SystemNotification):
            return None
        return self.public_status_for(item)

    def get_reply_allowed(self, item: MessageItem) -> bool:
        if isinstance(item, SystemNotification):
            return False
        if item.status != SupportRequestStatus.RESOLVED:
            return True
        return bool(item.resolved_at and item.resolved_at >= timezone.now() - timedelta(days=14))

    @extend_schema_field(
        inline_serializer(
            name="SupportThreadEntry",
            fields={
                "id": serializers.UUIDField(),
                "kind": serializers.ChoiceField(
                    choices=("requester_message", "operator_reply", "status")
                ),
                "body": serializers.CharField(required=False),
                "status": serializers.ChoiceField(
                    choices=("received", "in_progress", "resolved"), required=False
                ),
                "created_at": serializers.DateTimeField(),
                "edited_at": serializers.DateTimeField(required=False, allow_null=True),
                "editable": serializers.BooleanField(required=False),
            },
            many=True,
        )
    )
    def get_entries(self, item: MessageItem) -> list[dict[str, object]]:
        if isinstance(item, SystemNotification):
            return []
        messages = list(item.messages.all())
        entries: list[dict[str, object]] = [
            {
                "id": item.id,
                "kind": "status",
                "status": "received",
                "created_at": item.created_at,
            },
        ]
        if not any(message.is_initial for message in messages):
            entries.append({
                "id": item.id,
                "kind": "requester_message",
                "body": item.message,
                "created_at": item.created_at,
                "edited_at": None,
                "editable": False,
            })
        for message in messages:
            entries.append({
                "id": message.id,
                "kind": (
                    "operator_reply"
                    if message.author_kind == SupportMessageAuthor.OPERATOR
                    else "requester_message"
                ),
                "body": message.body,
                "created_at": message.created_at,
                "edited_at": message.edited_at,
                "editable": (
                    message.author_kind == SupportMessageAuthor.REQUESTER
                    and message.created_at >= timezone.now() - timedelta(minutes=15)
                ),
            })
        for event in item.events.filter(
            event_type__in=(
                SupportRequestEventType.ASSIGNED,
                SupportRequestEventType.RELEASED,
                SupportRequestEventType.REOPENED,
                SupportRequestEventType.RESOLVED,
            )
        ):
            entries.append({
                "id": event.id,
                "kind": "status",
                "status": (
                    "resolved"
                    if event.event_type == SupportRequestEventType.RESOLVED
                    else (
                        "in_progress"
                        if event.event_type == SupportRequestEventType.ASSIGNED
                        or event.new_state == SupportRequestStatus.IN_PROGRESS
                        else "received"
                    )
                ),
                "created_at": event.created_at,
            })
        return sorted(entries, key=lambda entry: (entry["created_at"], str(entry["id"])))


class MessageReadUpdateSerializer(serializers.Serializer[Any]):
    read = serializers.BooleanField()


class UnreadCountSerializer(serializers.Serializer[Any]):
    count = serializers.IntegerField(min_value=0)
