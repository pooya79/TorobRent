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
    SupportRequestEvent,
    SupportRequestEventType,
    SupportRequestStatus,
)

from .models import ListingInquiry, MessageKind, SystemNotification

MessageItem = SystemNotification | SupportRequest | ListingInquiry
PUBLIC_SUPPORT_EVENT_TYPES = (
    SupportRequestEventType.ASSIGNED,
    SupportRequestEventType.ESCALATED,
    SupportRequestEventType.RELEASED,
    SupportRequestEventType.REOPENED,
    SupportRequestEventType.RESOLVED,
)


def public_status_for_event(event: SupportRequestEvent) -> str:
    if event.event_type == SupportRequestEventType.RESOLVED:
        return "resolved"
    if event.event_type in (
        SupportRequestEventType.ASSIGNED,
        SupportRequestEventType.ESCALATED,
    ) or (
        event.event_type == SupportRequestEventType.REOPENED
        and event.new_state == SupportRequestStatus.IN_PROGRESS
    ):
        return "in_progress"
    return "received"


class SupportRequestCreateSerializer(serializers.Serializer[Any]):
    intake_kind = serializers.ChoiceField(choices=IntakeKind.choices)
    subject = serializers.CharField(max_length=120)
    message = serializers.CharField(max_length=2000)


class SupportRequestCreatedSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    href = serializers.CharField()


class ListingInquiryCreateSerializer(serializers.Serializer[Any]):
    listing_id = serializers.UUIDField()
    body = serializers.CharField(max_length=2000)


class ListingInquiryCreatedSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    href = serializers.CharField()


class ListingInquiryMessageSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    body = serializers.CharField()
    created_at = serializers.DateTimeField()


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
        if isinstance(item, SystemNotification):
            return MessageKind.SYSTEM_NOTIFICATION
        if isinstance(item, ListingInquiry):
            return MessageKind.LISTING_INQUIRY
        return MessageKind.SUPPORT_REQUEST

    @extend_schema_field(serializers.DateTimeField())
    def get_created_at(self, item: MessageItem) -> datetime:
        if isinstance(item, SystemNotification):
            return item.created_at
        if isinstance(item, ListingInquiry):
            return item.latest_activity_at
        return item.public_updated_at

    def get_title(self, notification: MessageItem) -> str:
        if isinstance(notification, ListingInquiry):
            return f"پرسش درباره {notification.listing.property.title}"
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
        if isinstance(notification, ListingInquiry):
            latest_inquiry_message = notification.messages.last()
            return latest_inquiry_message.body if latest_inquiry_message is not None else ""
        if isinstance(notification, SupportRequest):
            latest_support_message = notification.messages.last()
            return (
                latest_support_message.body
                if latest_support_message is not None
                else notification.message
            )
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
        if isinstance(notification, ListingInquiry):
            request = self.context.get("request")
            user_id = getattr(getattr(request, "user", None), "id", None)
            read_at = (
                notification.renter_read_at
                if user_id == notification.renter_id
                else notification.submitter_read_at
            )
            return read_at is not None and read_at >= notification.latest_activity_at
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
                    choices=(
                        "submission",
                        "source_proposal",
                        "support_request",
                        "listing_inquiry",
                    )
                ),
                "id": serializers.UUIDField(),
                "label": serializers.CharField(),
            },
        )
    )
    def get_group(self, notification: MessageItem) -> dict[str, str]:
        if isinstance(notification, ListingInquiry):
            return {
                "kind": "listing_inquiry",
                "id": str(notification.listing_id),
                "label": notification.listing.property.title,
            }
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
    counterpart = serializers.SerializerMethodField()

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
        if isinstance(notification, ListingInquiry):
            property_ = notification.listing.property
            return {
                "label": "مشاهده ملک",
                "href": f"/properties/{property_.id}/{property_.canonical_slug}",
            }
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
            .filter(event_type__in=PUBLIC_SUPPORT_EVENT_TYPES)
            .order_by("-created_at", "-id")
            .first()
        )
        if event is None:
            return "received"
        return public_status_for_event(event)

    def get_public_status(self, item: MessageItem) -> str | None:
        if isinstance(item, (SystemNotification, ListingInquiry)):
            return None
        return self.public_status_for(item)

    def get_reply_allowed(self, item: MessageItem) -> bool:
        if isinstance(item, SystemNotification):
            return False
        if isinstance(item, ListingInquiry):
            return True
        if item.status != SupportRequestStatus.RESOLVED:
            return True
        return bool(item.resolved_at and item.resolved_at >= timezone.now() - timedelta(days=14))

    @extend_schema_field(
        inline_serializer(
            name="SupportThreadEntry",
            fields={
                "id": serializers.UUIDField(),
                "kind": serializers.ChoiceField(
                    choices=(
                        "requester_message",
                        "operator_reply",
                        "renter_message",
                        "submitter_message",
                        "status",
                    )
                ),
                "body": serializers.CharField(required=False),
                "status": serializers.ChoiceField(
                    choices=("received", "in_progress", "resolved"), required=False
                ),
                "created_at": serializers.DateTimeField(),
                "edited_at": serializers.DateTimeField(required=False, allow_null=True),
                "editable": serializers.BooleanField(required=False),
                "author_name": serializers.CharField(required=False),
                "mine": serializers.BooleanField(required=False),
            },
            many=True,
        )
    )
    def get_entries(self, item: MessageItem) -> list[dict[str, object]]:
        if isinstance(item, SystemNotification):
            return []
        if isinstance(item, ListingInquiry):
            request = self.context.get("request")
            user_id = getattr(getattr(request, "user", None), "id", None)
            return [
                {
                    "id": message.id,
                    "kind": (
                        "renter_message"
                        if message.author_id == item.renter_id
                        else "submitter_message"
                    ),
                    "body": message.body,
                    "created_at": message.created_at,
                    "author_name": message.author.display_name,
                    "mine": message.author_id == user_id,
                }
                for message in item.messages.all()
            ]
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
        for event in item.events.filter(event_type__in=PUBLIC_SUPPORT_EVENT_TYPES):
            entries.append({
                "id": event.id,
                "kind": "status",
                "status": public_status_for_event(event),
                "created_at": event.created_at,
            })
        return sorted(entries, key=lambda entry: (entry["created_at"], str(entry["id"])))

    @extend_schema_field(
        inline_serializer(
            name="ListingInquiryCounterpart",
            fields={
                "display_name": serializers.CharField(),
                "role": serializers.ChoiceField(choices=("renter", "submitter")),
                "identity_verified": serializers.BooleanField(),
            },
            allow_null=True,
        )
    )
    def get_counterpart(self, item: MessageItem) -> dict[str, object] | None:
        if not isinstance(item, ListingInquiry):
            return None
        request = self.context.get("request")
        user_id = getattr(getattr(request, "user", None), "id", None)
        if user_id == item.renter_id:
            account = item.submitter
            role = "submitter"
        else:
            account = item.renter
            role = "renter"
        return {
            "display_name": account.display_name,
            "role": role,
            "identity_verified": False,
        }


class MessageReadUpdateSerializer(serializers.Serializer[Any]):
    read = serializers.BooleanField()


class UnreadCountSerializer(serializers.Serializer[Any]):
    count = serializers.IntegerField(min_value=0)
