from collections.abc import Callable
from typing import cast

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.paginator import InvalidPage, Paginator
from django.db import models
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema, extend_schema_view
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, Throttled, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.common.pagination import StandardPageNumberPagination
from apps.common.serializers import ProblemSerializer
from apps.contact.models import SupportMessage, SupportMessageAuthor, SupportRequest
from apps.contact.services import (
    SupportRequestConflict,
    add_support_message,
    create_support_request,
    edit_support_message,
)

from .models import ListingInquiry, SystemNotification, SystemNotificationReadState
from .permissions import HasVerifiedIdentifier
from .selectors import listing_inquiries_for, system_notifications_for
from .serializers import (
    ListingInquiryCreatedSerializer,
    ListingInquiryCreateSerializer,
    ListingInquiryMessageSerializer,
    MessageDetailSerializer,
    MessageListQuerySerializer,
    MessageReadUpdateSerializer,
    MessageSummarySerializer,
    SupportMessageCreateSerializer,
    SupportMessageSerializer,
    SupportRequestCreatedSerializer,
    SupportRequestCreateSerializer,
    UnreadCountSerializer,
)
from .services import (
    ListingInquiryAlreadyExists,
    ListingInquiryError,
    ListingInquiryQuotaExceeded,
    reply_to_listing_inquiry,
    start_listing_inquiry,
)


class MessageConflict(APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, conflict: SupportRequestConflict) -> None:
        self.default_code = conflict.code
        super().__init__(str(conflict), code=conflict.code)


class ListingInquiryRequestError(APIException):
    status_code: int = status.HTTP_400_BAD_REQUEST

    def __init__(self, error: ListingInquiryError) -> None:
        self.default_code = error.code
        super().__init__(str(error), code=error.code)


class ListingInquiryConflict(ListingInquiryRequestError):
    status_code = status.HTTP_409_CONFLICT


def execute_inquiry_command[Result](command: Callable[[], Result]) -> Result:
    try:
        return command()
    except ListingInquiryAlreadyExists as exc:
        raise ListingInquiryConflict(exc) from None
    except ListingInquiryQuotaExceeded as exc:
        raise Throttled(detail=str(exc), code=exc.code) from None
    except ListingInquiryError as exc:
        raise ListingInquiryRequestError(exc) from None


def execute_message_command[Result](command: Callable[[], Result]) -> Result:
    try:
        return command()
    except DjangoValidationError as exc:
        raise ValidationError(exc.messages) from None
    except SupportRequestConflict as exc:
        raise MessageConflict(exc) from None


@extend_schema_view(
    get=extend_schema(
        summary="List Message Center items",
        parameters=[MessageListQuerySerializer],
        responses={200: MessageSummarySerializer(many=True)},
    )
)
class MessageListView(APIView):
    permission_classes = [HasVerifiedIdentifier]
    pagination_class = StandardPageNumberPagination

    def get(self, request: Request) -> Response:
        query = MessageListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        user = cast(User, request.user)
        kind = query.validated_data["kind"]
        unread = query.validated_data["unread"]
        notifications = system_notifications_for(user, kind=kind, unread=unread)
        requests = SupportRequest.objects.none()
        if kind in ("all", "support_request"):
            requests = SupportRequest.objects.filter(submitter=user).prefetch_related("messages")
            if unread:
                requests = requests.filter(
                    requester_read_at__lt=models.F("public_updated_at")
                ) | requests.filter(requester_read_at__isnull=True)
        inquiries = ListingInquiry.objects.none()
        if kind in ("all", "listing_inquiry"):
            inquiries = listing_inquiries_for(user, unread=unread)
        paginator = self.pagination_class()
        page_size = paginator.get_page_size(request)
        assert page_size is not None
        total = notifications.count() + requests.count() + inquiries.count()
        django_paginator = Paginator(range(total), page_size)
        page_number = paginator.get_page_number(request, django_paginator)
        try:
            page = django_paginator.page(page_number)
        except InvalidPage as exc:
            message = paginator.invalid_page_message.format(
                page_number=page_number, message=str(exc)
            )
            raise NotFound(message) from exc

        start = (page.number - 1) * page_size
        end = min(start + page_size, total)
        notification_timeline = (
            notifications
            .order_by()
            .annotate(
                timeline_at=models.F("created_at"),
                timeline_source=models.Value("notification", output_field=models.CharField()),
            )
            .values("id", "timeline_at", "timeline_source")
        )
        request_timeline = (
            requests
            .order_by()
            .annotate(
                timeline_at=models.F("public_updated_at"),
                timeline_source=models.Value("support_request", output_field=models.CharField()),
            )
            .values("id", "timeline_at", "timeline_source")
        )
        inquiry_timeline = (
            inquiries
            .order_by()
            .annotate(
                timeline_at=models.F("latest_activity_at"),
                timeline_source=models.Value("listing_inquiry", output_field=models.CharField()),
            )
            .values("id", "timeline_at", "timeline_source")
        )
        timeline = list(
            notification_timeline.union(request_timeline, inquiry_timeline, all=True).order_by(
                "-timeline_at", "-id"
            )[start:end]
        )
        notification_ids = [
            item["id"] for item in timeline if item["timeline_source"] == "notification"
        ]
        request_ids = [
            item["id"] for item in timeline if item["timeline_source"] == "support_request"
        ]
        inquiry_ids = [
            item["id"] for item in timeline if item["timeline_source"] == "listing_inquiry"
        ]
        notification_items = {
            item.id: item for item in notifications.filter(id__in=notification_ids)
        }
        request_items = {item.id: item for item in requests.filter(id__in=request_ids)}
        inquiry_items = {item.id: item for item in inquiries.filter(id__in=inquiry_ids)}
        items: list[SystemNotification | SupportRequest | ListingInquiry] = [
            (
                notification_items[item["id"]]
                if item["timeline_source"] == "notification"
                else (
                    request_items[item["id"]]
                    if item["timeline_source"] == "support_request"
                    else inquiry_items[item["id"]]
                )
            )
            for item in timeline
        ]
        paginator.page = page
        paginator.request = request
        serialized = MessageSummarySerializer(items, many=True, context={"request": request})  # type: ignore[arg-type]
        return paginator.get_paginated_response(serialized.data)


class MessageDetailView(APIView):
    permission_classes = [HasVerifiedIdentifier]

    def item(
        self, request: Request, message_id: str
    ) -> SystemNotification | SupportRequest | ListingInquiry:
        user = cast(User, request.user)
        inquiry = (
            ListingInquiry.objects
            .filter(id=message_id)
            .filter(models.Q(renter=user) | models.Q(submitter=user))
            .select_related("listing__property", "renter", "submitter")
            .prefetch_related("messages__author")
            .first()
        )
        if inquiry is not None:
            return inquiry
        support_request = (
            SupportRequest.objects
            .filter(id=message_id, submitter=user)
            .prefetch_related("messages", "events")
            .first()
        )
        if support_request is not None:
            return support_request
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
        item = self.item(request, message_id)
        if isinstance(item, SystemNotification):
            SystemNotificationReadState.objects.get_or_create(notification=item)
        elif isinstance(item, ListingInquiry):
            now = timezone.now()
            if item.renter_id == request.user.id:
                item.renter_read_at = now
                item.save(update_fields=("renter_read_at",))
            else:
                item.submitter_read_at = now
                item.save(update_fields=("submitter_read_at",))
        else:
            item.requester_read_at = timezone.now()
            item.save(update_fields=("requester_read_at",))
        return Response(MessageDetailSerializer(item, context={"request": request}).data)

    @extend_schema(
        summary="Change the read state of a Message Center item",
        request=MessageReadUpdateSerializer,
        responses={200: MessageDetailSerializer},
    )
    def patch(self, request: Request, message_id: str) -> Response:
        item = self.item(request, message_id)
        update = MessageReadUpdateSerializer(data=request.data)
        update.is_valid(raise_exception=True)
        if isinstance(item, SystemNotification) and update.validated_data["read"]:
            SystemNotificationReadState.objects.get_or_create(notification=item)
        elif isinstance(item, SystemNotification):
            SystemNotificationReadState.objects.filter(notification=item).delete()
        elif isinstance(item, ListingInquiry):
            read_at = timezone.now() if update.validated_data["read"] else None
            if item.renter_id == request.user.id:
                item.renter_read_at = read_at
                item.save(update_fields=("renter_read_at",))
            else:
                item.submitter_read_at = read_at
                item.save(update_fields=("submitter_read_at",))
        elif update.validated_data["read"]:
            item.requester_read_at = timezone.now()
            item.save(update_fields=("requester_read_at",))
        else:
            item.requester_read_at = None
            item.save(update_fields=("requester_read_at",))
        return Response(MessageDetailSerializer(item, context={"request": request}).data)


class UnreadMessageCountView(APIView):
    permission_classes = [HasVerifiedIdentifier]

    @extend_schema(summary="Count unread Message Center items", responses=UnreadCountSerializer)
    def get(self, request: Request) -> Response:
        user = cast(User, request.user)
        support_unread = (
            SupportRequest.objects
            .filter(submitter=user)
            .filter(
                models.Q(requester_read_at__isnull=True)
                | models.Q(requester_read_at__lt=models.F("public_updated_at"))
            )
            .count()
        )
        inquiry_unread = listing_inquiries_for(user, unread=True).count()
        count = (
            system_notifications_for(user, unread=True).count() + support_unread + inquiry_unread
        )
        return Response({"count": count})


class ListingInquiryCreateView(APIView):
    permission_classes = [HasVerifiedIdentifier]

    @extend_schema(
        summary="Send the first message for an exact Listing",
        request=ListingInquiryCreateSerializer,
        responses={
            201: ListingInquiryCreatedSerializer,
            409: OpenApiResponse(
                response=ProblemSerializer,
                description="A conversation already exists for this Renter and Listing",
            ),
        },
    )
    def post(self, request: Request) -> Response:
        serializer = ListingInquiryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        inquiry, _message = execute_inquiry_command(
            lambda: start_listing_inquiry(
                renter=cast(User, request.user),
                **serializer.validated_data,
            )
        )
        return Response(
            {"id": inquiry.id, "href": f"/messages/{inquiry.id}"},
            status=status.HTTP_201_CREATED,
        )


class ListingInquiryReplyView(APIView):
    permission_classes = [HasVerifiedIdentifier]
    throttle_scope = "listing_inquiry_reply"

    @extend_schema(
        summary="Reply to a Listing Inquiry",
        request=SupportMessageCreateSerializer,
        responses={201: ListingInquiryMessageSerializer},
    )
    def post(self, request: Request, inquiry_id: str) -> Response:
        inquiry = get_object_or_404(
            ListingInquiry.objects.filter(
                models.Q(renter=request.user) | models.Q(submitter=request.user)
            ),
            id=inquiry_id,
        )
        serializer = SupportMessageCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = execute_inquiry_command(
            lambda: reply_to_listing_inquiry(
                inquiry=inquiry,
                actor=cast(User, request.user),
                body=serializer.validated_data["body"],
            )
        )
        return Response(
            {
                "id": message.id,
                "body": message.body,
                "created_at": message.created_at,
            },
            status=status.HTTP_201_CREATED,
        )


class SupportRequestCreateView(APIView):
    permission_classes = [HasVerifiedIdentifier]

    @extend_schema(
        summary="Open a Support Request",
        request=SupportRequestCreateSerializer,
        responses={201: SupportRequestCreatedSerializer},
    )
    def post(self, request: Request) -> Response:
        serializer = SupportRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = cast(User, request.user)
        name = user.get_full_name().strip() or user.email or user.phone or "کاربر ترب‌رنت"
        support_request = create_support_request(
            submitter=user,
            name=name,
            email=user.email or "",
            **serializer.validated_data,
        )
        return Response(
            {"id": support_request.id, "href": f"/messages/{support_request.id}"},
            status=status.HTTP_201_CREATED,
        )


class RequesterSupportReplyView(APIView):
    permission_classes = [HasVerifiedIdentifier]

    @extend_schema(
        summary="Reply to your Support Request",
        request=SupportMessageCreateSerializer,
        responses={201: SupportMessageSerializer},
    )
    def post(self, request: Request, support_request_id: str) -> Response:
        support_request = get_object_or_404(
            SupportRequest, id=support_request_id, submitter=request.user
        )
        serializer = SupportMessageCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message: SupportMessage = execute_message_command(
            lambda: add_support_message(
                support_request=support_request,
                actor=cast(User, request.user),
                body=serializer.validated_data["body"],
                author_kind=SupportMessageAuthor.REQUESTER,
            )
        )
        return Response(SupportMessageSerializer(message).data, status=status.HTTP_201_CREATED)


class RequesterSupportMessageEditView(APIView):
    permission_classes = [HasVerifiedIdentifier]

    @extend_schema(
        summary="Edit your recent Support message",
        request=SupportMessageCreateSerializer,
        responses={200: SupportMessageSerializer},
    )
    def patch(self, request: Request, support_request_id: str, support_message_id: str) -> Response:
        message = get_object_or_404(
            SupportMessage,
            id=support_message_id,
            support_request_id=support_request_id,
            support_request__submitter=request.user,
        )
        serializer = SupportMessageCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = execute_message_command(
            lambda: edit_support_message(
                support_message=message,
                actor=cast(User, request.user),
                body=serializer.validated_data["body"],
            )
        )
        return Response(SupportMessageSerializer(message).data)
