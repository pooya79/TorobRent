from datetime import timedelta
from typing import cast
from uuid import UUID

from django.db.models import Q, QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User
from apps.common.pagination import StandardPageNumberPagination

from .models import IntakeKind, SupportClassification, SupportRequest, SupportRequestStatus
from .selectors import support_requests_visible_to
from .serializers import SupportRequestQueueSerializer, SupportRequestSerializer
from .services import SupportRequestConflict, claim_support_request, release_support_request


class CanHandleSupportRequests(BasePermission):
    message = "مجوز رسیدگی به Support Request لازم است."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = cast(User, request.user)
        return has_capability(user, OperatorCapability.HANDLE_SUPPORT) or has_capability(
            user, OperatorCapability.HANDLE_PRIVACY_REQUESTS
        )


class SupportRequestPagination(StandardPageNumberPagination):
    page_size = 50
    max_page_size = 100


class SupportConflict(APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, conflict: SupportRequestConflict) -> None:
        self.default_code = conflict.code
        super().__init__(str(conflict), code=conflict.code)


class OperatorSupportRequestListView(ListAPIView[SupportRequest]):
    permission_classes = (CanHandleSupportRequests,)
    serializer_class = SupportRequestQueueSerializer
    pagination_class = SupportRequestPagination

    @extend_schema(
        summary="List and filter the Support Request queue",
        parameters=[
            OpenApiParameter(
                "status",
                str,
                enum=SupportRequestStatus.values,
                description="Match the current operational state.",
            ),
            OpenApiParameter(
                "intake_kind",
                str,
                enum=IntakeKind.values,
                description="Match the requester's declared Intake Kind.",
            ),
            OpenApiParameter(
                "classification",
                str,
                enum=SupportClassification.values,
                description="Match the authoritative Support Classification.",
            ),
            OpenApiParameter(
                "assignee",
                {
                    "oneOf": [
                        {
                            "type": "string",
                            "enum": ["unassigned", "assigned", "mine", "other"],
                        },
                        {"type": "string", "format": "uuid"},
                    ]
                },
                description=(
                    "Assignment facet: unassigned, assigned, mine, other, or an Operator UUID."
                ),
            ),
            OpenApiParameter(
                "age_days",
                int,
                description="Include requests created at least this many whole days ago.",
            ),
            OpenApiParameter(
                "created_after",
                OpenApiTypes.DATETIME,
                description="Include requests created at or after this UTC timestamp.",
            ),
            OpenApiParameter(
                "created_before",
                OpenApiTypes.DATETIME,
                description="Include requests created at or before this UTC timestamp.",
            ),
            OpenApiParameter(
                "search",
                str,
                description="Case-insensitive search across requester name, email, and message.",
            ),
            OpenApiParameter(
                "ordering",
                str,
                enum=["newest", "oldest"],
                description="Order by request creation time; defaults to oldest first.",
            ),
            OpenApiParameter(
                "page",
                int,
                description="One-based page number.",
            ),
            OpenApiParameter(
                "page_size",
                int,
                description="Records per page; defaults to 50 and is capped at 100.",
            ),
        ],
        responses=SupportRequestQueueSerializer(many=True),
    )
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return self.list(request, *args, **kwargs)

    def get_queryset(self) -> QuerySet[SupportRequest]:
        operator = cast(User, self.request.user)
        support_requests = support_requests_visible_to(operator=operator).select_related("assignee")
        for parameter in ("status", "intake_kind", "classification"):
            if value := self.request.query_params.get(parameter):
                support_requests = support_requests.filter(**{parameter: value})
        for parameter, lookup in (
            ("created_after", "created_at__gte"),
            ("created_before", "created_at__lte"),
        ):
            value = self.request.query_params.get(parameter)
            if not value:
                continue
            parsed = parse_datetime(value)
            if parsed is None:
                raise ValidationError({parameter: "زمان ایجاد Support Request نامعتبر است."})
            support_requests = support_requests.filter(**{lookup: parsed})
        if age_days := self.request.query_params.get("age_days"):
            try:
                days = int(age_days)
                if days < 0:
                    raise ValueError
            except ValueError:
                raise ValidationError({
                    "age_days": "سن درخواست باید تعداد روز نامنفی باشد."
                }) from None
            support_requests = support_requests.filter(
                created_at__lte=timezone.now() - timedelta(days=days)
            )
        if assignee := self.request.query_params.get("assignee"):
            if assignee == "unassigned":
                support_requests = support_requests.filter(assignee__isnull=True)
            elif assignee == "mine":
                support_requests = support_requests.filter(assignee=operator)
            elif assignee == "assigned":
                support_requests = support_requests.filter(assignee__isnull=False)
            elif assignee == "other":
                support_requests = support_requests.filter(assignee__isnull=False).exclude(
                    assignee=operator
                )
            else:
                try:
                    assignee_id = UUID(assignee)
                except ValueError:
                    raise ValidationError({"assignee": "شناسه اپراتور نامعتبر است."}) from None
                support_requests = support_requests.filter(assignee_id=assignee_id)
        if search := self.request.query_params.get("search"):
            support_requests = support_requests.filter(
                Q(name__icontains=search)
                | Q(email__icontains=search)
                | Q(message__icontains=search)
            )
        ordering = (
            "-created_at" if self.request.query_params.get("ordering") == "newest" else "created_at"
        )
        return support_requests.order_by(ordering, "id")


def operator_support_request(*, request: Request, support_request_id: str) -> SupportRequest:
    return get_object_or_404(
        support_requests_visible_to(operator=cast(User, request.user))
        .select_related("assignee")
        .prefetch_related("events__actor"),
        id=support_request_id,
    )


class OperatorSupportRequestDetailView(APIView):
    permission_classes = (CanHandleSupportRequests,)

    @extend_schema(summary="Inspect a Support Request", responses=SupportRequestSerializer)
    def get(self, request: Request, support_request_id: str) -> Response:
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        return Response(SupportRequestSerializer(support_request).data)


class OperatorSupportRequestClaimView(APIView):
    permission_classes = (CanHandleSupportRequests,)

    @extend_schema(
        summary="Claim an open Support Request",
        request=None,
        responses={201: SupportRequestSerializer},
    )
    def post(self, request: Request, support_request_id: str) -> Response:
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        try:
            support_request = claim_support_request(
                support_request=support_request, actor=cast(User, request.user)
            )
        except SupportRequestConflict as exc:
            raise SupportConflict(exc) from None
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        return Response(
            SupportRequestSerializer(support_request).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        summary="Release the current Operator's Support Request assignment",
        responses={204: None},
    )
    def delete(self, request: Request, support_request_id: str) -> Response:
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        try:
            release_support_request(support_request=support_request, actor=cast(User, request.user))
        except SupportRequestConflict as exc:
            raise SupportConflict(exc) from None
        return Response(status=status.HTTP_204_NO_CONTENT)
