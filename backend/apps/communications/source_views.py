from typing import Any, cast
from uuid import UUID

from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.permissions import HasVerifiedIdentifier

from .serializers import MessageBodySerializer
from .source_conversations import (
    conversation_proposals_for,
    open_source_conversation,
    send_source_message,
)


class SourceConversationOpenSerializer(serializers.Serializer[Any]):
    proposal_id = serializers.UUIDField()


class SourceConversationOpenedSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    href = serializers.CharField()


class SourceConversationMessageSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    body = serializers.CharField()
    created_at = serializers.DateTimeField()


class SourceConversationOptionSerializer(serializers.Serializer[Any]):
    proposal_id = serializers.UUIDField()
    website_name = serializers.CharField()
    operator = serializers.BooleanField()


class SourceConversationOpenView(APIView):
    permission_classes = [HasVerifiedIdentifier]

    @extend_schema(
        summary="List accessible Source Conversation contexts",
        responses=SourceConversationOptionSerializer(many=True),
    )
    def get(self, request: Request) -> Response:
        actor = cast(User, request.user)
        return Response([
            {
                "proposal_id": proposal.pk,
                "website_name": proposal.website_name or proposal.normalized_domain,
                "operator": proposal.submitter_id != actor.pk,
            }
            for proposal in conversation_proposals_for(actor)
        ])

    @extend_schema(
        summary="Open the Source Conversation for a proposal",
        request=SourceConversationOpenSerializer,
        responses=SourceConversationOpenedSerializer,
    )
    def post(self, request: Request) -> Response:
        data = SourceConversationOpenSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        conversation = open_source_conversation(
            actor=cast(User, request.user), **data.validated_data
        )
        return Response({"id": conversation.pk, "href": f"/messages/{conversation.pk}"})


class SourceConversationReplyView(APIView):
    permission_classes = [HasVerifiedIdentifier]
    throttle_scope = "listing_inquiry_reply"

    @extend_schema(
        summary="Reply to a Source Conversation",
        request=MessageBodySerializer,
        responses={201: SourceConversationMessageSerializer},
    )
    def post(self, request: Request, conversation_id: UUID) -> Response:
        data = MessageBodySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        message = send_source_message(
            actor=cast(User, request.user), conversation_id=conversation_id, **data.validated_data
        )
        return Response(SourceConversationMessageSerializer(message).data, status=201)
