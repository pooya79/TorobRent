"""Source correspondence has operational retention and current, purpose-specific access."""

from uuid import UUID

from django.db import models, transaction
from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User
from apps.source_proposals.models import SourceProposal, SourceProposalReviewClaim

from .models import SourceConversation, SourceConversationMessage, SourceConversationReadState


class SourceConversationUnavailable(APIException):
    status_code = 409
    default_detail = "حساب نماینده حذف شده و گفت‌وگو فقط خواندنی است."
    default_code = "source_conversation_unavailable"


def conversation_proposals_for(actor: User) -> QuerySet[SourceProposal]:
    # Re-read permissions: long-lived authenticated User instances may cache revoked grants.
    actor = User.objects.get(pk=actor.pk)
    if not actor.is_active or not (actor.email_verified or actor.phone_verified):
        return SourceProposal.objects.none()
    current_claim = SourceProposalReviewClaim.objects.filter(
        proposal_id=models.OuterRef("pk"),
        revision=models.OuterRef("revision"),
        released_at__isnull=True,
        expires_at__gt=timezone.now(),
    ).values("operator_id")[:1]
    proposals = SourceProposal.objects.annotate(current_reviewer=models.Subquery(current_claim))
    access = models.Q(submitter=actor)
    if has_capability(actor, OperatorCapability.REVIEW_SOURCE_PROPOSALS):
        access |= models.Q(source__responsible_operator=actor) | (
            models.Q(source__responsible_operator__isnull=True)
            & (models.Q(current_reviewer=actor.pk) | models.Q(current_reviewer__isnull=True))
        )
    # A correction starts a new draft revision; its operational correspondence stays open.
    return proposals.filter(access).exclude(state="draft", revision=1)


def source_conversations_for(actor: User, *, unread: bool = False) -> QuerySet[SourceConversation]:
    read_state = SourceConversationReadState.objects.filter(
        conversation_id=models.OuterRef("pk"),
        account=actor,
        read_at__gte=models.OuterRef("latest_activity_at"),
    )
    conversations = (
        SourceConversation.objects
        .filter(proposal__in=conversation_proposals_for(actor))
        .select_related("proposal")
        .prefetch_related("messages")
        .annotate(is_read=models.Exists(read_state))
    )
    if unread:
        conversations = conversations.filter(is_read=False, latest_activity_at__isnull=False)
    return conversations


@transaction.atomic
def open_source_conversation(*, actor: User, proposal_id: UUID) -> SourceConversation:
    proposal = get_object_or_404(
        conversation_proposals_for(actor).select_for_update(of=("self",)), pk=proposal_id
    )
    conversation, _ = SourceConversation.objects.get_or_create(proposal=proposal)
    return conversation


@transaction.atomic
def send_source_message(
    *, actor: User, conversation_id: UUID, body: str
) -> SourceConversationMessage:
    # Match responsibility reassignment's proposal-first lock order, then recheck access.
    conversation = get_object_or_404(SourceConversation, pk=conversation_id)
    SourceProposal.objects.select_for_update().get(pk=conversation.proposal_id)
    conversation = get_object_or_404(source_conversations_for(actor), pk=conversation_id)
    if conversation.proposal.submitter_id is None:
        raise SourceConversationUnavailable()
    message = SourceConversationMessage.objects.create(
        conversation=conversation,
        author=actor,
        from_representative=conversation.proposal.submitter_id == actor.pk,
        body=body,
    )
    conversation.latest_activity_at = message.created_at
    conversation.save(update_fields=("latest_activity_at",))
    SourceConversationReadState.objects.update_or_create(
        conversation=conversation, account=actor, defaults={"read_at": message.created_at}
    )
    return message


def mark_source_conversation_read(
    *, conversation: SourceConversation, actor: User, read: bool
) -> None:
    SourceConversationReadState.objects.update_or_create(
        conversation=conversation,
        account=actor,
        defaults={"read_at": conversation.latest_activity_at if read else None},
    )
    conversation.is_read = read  # type: ignore[attr-defined]


@transaction.atomic
def redact_source_message(*, message_id: UUID, actor: User) -> None:
    from django.core.exceptions import PermissionDenied

    if not actor.is_active or not actor.is_superuser:
        raise PermissionDenied("Only superusers may redact Source Conversation content.")
    message = SourceConversationMessage.objects.select_for_update().get(pk=message_id)
    if message.redacted_at is None:
        message.body = "[Personal content redacted]"
        message.redacted_at = timezone.now()
        message.redacted_by = actor
        message.save(update_fields=("body", "redacted_at", "redacted_by"))
