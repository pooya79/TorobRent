from typing import cast

from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework.generics import ListAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .models import SystemNotification, SystemNotificationReadState
from .permissions import HasVerifiedIdentifier
from .selectors import system_notifications_for
from .serializers import (
    MessageDetailSerializer,
    MessageListQuerySerializer,
    MessageReadUpdateSerializer,
    MessageSummarySerializer,
    UnreadCountSerializer,
)


@extend_schema_view(
    get=extend_schema(
        summary="List Message Center items",
        parameters=[MessageListQuerySerializer],
        responses={200: MessageSummarySerializer(many=True)},
    )
)
class MessageListView(ListAPIView[SystemNotification]):
    permission_classes = [HasVerifiedIdentifier]
    serializer_class = MessageSummarySerializer

    def get_queryset(self) -> QuerySet[SystemNotification]:
        query = MessageListQuerySerializer(data=self.request.query_params)
        query.is_valid(raise_exception=True)
        return system_notifications_for(
            cast(User, self.request.user),
            kind=query.validated_data["kind"],
            unread=query.validated_data["unread"],
        )


class MessageDetailView(APIView):
    permission_classes = [HasVerifiedIdentifier]

    def notification(self, request: Request, message_id: str) -> SystemNotification:
        return get_object_or_404(
            SystemNotification.objects.select_related(
                "originating_event__submission",
                "originating_source_proposal_event__proposal",
                "target_submission",
                "target_source_proposal",
                "recipient",
            ),
            id=message_id,
            recipient=request.user,
        )

    @extend_schema(summary="Open a Message Center item", responses={200: MessageDetailSerializer})
    def get(self, request: Request, message_id: str) -> Response:
        notification = self.notification(request, message_id)
        SystemNotificationReadState.objects.get_or_create(notification=notification)
        return Response(MessageDetailSerializer(notification).data)

    @extend_schema(
        summary="Change the read state of a Message Center item",
        request=MessageReadUpdateSerializer,
        responses={200: MessageDetailSerializer},
    )
    def patch(self, request: Request, message_id: str) -> Response:
        notification = self.notification(request, message_id)
        update = MessageReadUpdateSerializer(data=request.data)
        update.is_valid(raise_exception=True)
        if update.validated_data["read"]:
            SystemNotificationReadState.objects.get_or_create(notification=notification)
        else:
            SystemNotificationReadState.objects.filter(notification=notification).delete()
        return Response(MessageDetailSerializer(notification).data)


class UnreadMessageCountView(APIView):
    permission_classes = [HasVerifiedIdentifier]

    @extend_schema(summary="Count unread Message Center items", responses=UnreadCountSerializer)
    def get(self, request: Request) -> Response:
        count = system_notifications_for(cast(User, request.user), unread=True).count()
        return Response({"count": count})
