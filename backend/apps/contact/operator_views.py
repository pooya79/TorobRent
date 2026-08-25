from collections.abc import Callable
from datetime import timedelta
from typing import cast
from uuid import UUID

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q, QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User
from apps.common.pagination import StandardPageNumberPagination

from .models import (
    IntakeKind,
    SupportClassification,
    SupportPriority,
    SupportRequest,
    SupportRequestStatus,
)
from .selectors import support_requests_visible_to, support_workload_summary
from .serializers import (
    SupportExternalContactCreateSerializer,
    SupportExternalContactSerializer,
    SupportIdentityVerificationCreateSerializer,
    SupportIdentityVerificationSerializer,
    SupportPrivacyActionCreateSerializer,
    SupportPrivacyActionSerializer,
    SupportReassignmentSerializer,
    SupportReopenSerializer,
    SupportRequestNoteCreateSerializer,
    SupportRequestNoteSerializer,
    SupportRequestQueueSerializer,
    SupportRequestSerializer,
    SupportResolutionSerializer,
    SupportTriageSerializer,
    SupportWorkloadSummarySerializer,
)
from .services import (
    SupportRequestConflict,
    add_support_request_note,
    claim_support_request,
    reassign_abandoned_support_request,
    record_external_contact,
    record_identity_verification,
    record_privacy_action,
    release_support_request,
    reopen_support_request,
    resolve_support_request,
    triage_support_request,
)


class CanHandleSupportRequests(BasePermission):
    message = "مجوز رسیدگی به Support Request لازم است."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = cast(User, request.user)
        return has_capability(user, OperatorCapability.HANDLE_SUPPORT) or has_capability(
            user, OperatorCapability.HANDLE_PRIVACY_REQUESTS
        )


class CanManageSupportQueue(BasePermission):
    message = "مجوز مدیریت صف همراه با دسترسی پشتیبانی لازم است."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = cast(User, request.user)
        has_support_access = has_capability(
            user, OperatorCapability.HANDLE_SUPPORT
        ) or has_capability(user, OperatorCapability.HANDLE_PRIVACY_REQUESTS)
        return has_support_access and has_capability(
            user, OperatorCapability.MANAGE_OPERATOR_QUEUES
        )


class SupportRequestPagination(StandardPageNumberPagination):
    page_size = 50
    max_page_size = 100


class SupportConflict(APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, conflict: SupportRequestConflict) -> None:
        self.default_code = conflict.code
        super().__init__(str(conflict), code=conflict.code)


def execute_support_command[SupportCommandResult](
    command: Callable[[], SupportCommandResult],
) -> SupportCommandResult:
    try:
        return command()
    except DjangoValidationError as exc:
        raise ValidationError(exc.messages) from None
    except SupportRequestConflict as exc:
        raise SupportConflict(exc) from None


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
                "priority",
                str,
                enum=SupportPriority.values,
                description="Match the current Support Request priority.",
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
        for parameter in ("status", "intake_kind", "classification", "priority"):
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


class OperatorSupportSummaryView(APIView):
    permission_classes = (CanHandleSupportRequests,)

    @extend_schema(
        summary="Summarize actionable Support Request workload",
        responses=SupportWorkloadSummarySerializer,
    )
    def get(self, request: Request) -> Response:
        summary = support_workload_summary(operator=cast(User, request.user))
        return Response(SupportWorkloadSummarySerializer(summary).data)


def operator_support_request(*, request: Request, support_request_id: str) -> SupportRequest:
    return get_object_or_404(
        support_requests_visible_to(operator=cast(User, request.user))
        .select_related("assignee")
        .prefetch_related(
            "events__actor",
            "notes__actor",
            "external_contacts__actor",
            "identity_verifications__actor",
            "privacy_actions__actor",
        ),
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


class OperatorSupportRequestNoteView(APIView):
    permission_classes = (CanHandleSupportRequests,)

    @extend_schema(
        summary="Append an internal note to a Support Request",
        request=SupportRequestNoteCreateSerializer,
        responses={201: SupportRequestNoteSerializer},
    )
    def post(self, request: Request, support_request_id: str) -> Response:
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        serializer = SupportRequestNoteCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = execute_support_command(
            lambda: add_support_request_note(
                support_request=support_request,
                actor=cast(User, request.user),
                body=serializer.validated_data["body"],
                corrects_note_id=serializer.validated_data.get("corrects_note"),
            )
        )
        return Response(
            SupportRequestNoteSerializer(note).data,
            status=status.HTTP_201_CREATED,
        )


class OperatorSupportExternalContactView(APIView):
    permission_classes = (CanHandleSupportRequests,)

    @extend_schema(
        summary="Record a privacy-minimal external-contact summary",
        request=SupportExternalContactCreateSerializer,
        responses={201: SupportExternalContactSerializer},
    )
    def post(self, request: Request, support_request_id: str) -> Response:
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        serializer = SupportExternalContactCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        contact = execute_support_command(
            lambda: record_external_contact(
                support_request=support_request,
                actor=cast(User, request.user),
                **serializer.validated_data,
            )
        )
        return Response(
            SupportExternalContactSerializer(contact).data,
            status=status.HTTP_201_CREATED,
        )


class OperatorSupportIdentityVerificationView(APIView):
    permission_classes = (CanHandleSupportRequests,)

    @extend_schema(
        summary="Record out-of-band identity verification",
        request=SupportIdentityVerificationCreateSerializer,
        responses={201: SupportIdentityVerificationSerializer},
    )
    def post(self, request: Request, support_request_id: str) -> Response:
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        serializer = SupportIdentityVerificationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        verification = execute_support_command(
            lambda: record_identity_verification(
                support_request=support_request,
                actor=cast(User, request.user),
                **serializer.validated_data,
            )
        )
        return Response(
            SupportIdentityVerificationSerializer(verification).data,
            status=status.HTTP_201_CREATED,
        )


class OperatorSupportPrivacyActionView(APIView):
    permission_classes = (CanHandleSupportRequests,)

    @extend_schema(
        summary="Record privacy-action completion without performing the action",
        request=SupportPrivacyActionCreateSerializer,
        responses={201: SupportPrivacyActionSerializer},
    )
    def post(self, request: Request, support_request_id: str) -> Response:
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        serializer = SupportPrivacyActionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        privacy_action = execute_support_command(
            lambda: record_privacy_action(
                support_request=support_request,
                actor=cast(User, request.user),
                **serializer.validated_data,
            )
        )
        return Response(
            SupportPrivacyActionSerializer(privacy_action).data,
            status=status.HTTP_201_CREATED,
        )


class OperatorSupportRequestResolveView(APIView):
    permission_classes = (CanHandleSupportRequests,)

    @extend_schema(
        summary="Resolve an assigned Support Request",
        request=SupportResolutionSerializer,
        responses={200: SupportRequestSerializer},
    )
    def post(self, request: Request, support_request_id: str) -> Response:
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        serializer = SupportResolutionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        execute_support_command(
            lambda: resolve_support_request(
                support_request=support_request,
                actor=cast(User, request.user),
                category=serializer.validated_data["category"],
                summary=serializer.validated_data["summary"],
            )
        )
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        return Response(SupportRequestSerializer(support_request).data)


class OperatorSupportRequestReopenView(APIView):
    permission_classes = (CanHandleSupportRequests,)

    @extend_schema(
        summary="Reopen a resolved Support Request with a reason",
        request=SupportReopenSerializer,
        responses={200: SupportRequestSerializer},
    )
    def post(self, request: Request, support_request_id: str) -> Response:
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        serializer = SupportReopenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        execute_support_command(
            lambda: reopen_support_request(
                support_request=support_request,
                actor=cast(User, request.user),
                reason=serializer.validated_data["reason"],
            )
        )
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
        except DjangoValidationError as exc:
            raise PermissionDenied(exc.messages) from None
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
        except DjangoValidationError as exc:
            raise PermissionDenied(exc.messages) from None
        except SupportRequestConflict as exc:
            raise SupportConflict(exc) from None
        return Response(status=status.HTTP_204_NO_CONTENT)


class OperatorSupportRequestTriageView(APIView):
    permission_classes = (CanHandleSupportRequests,)

    @extend_schema(
        summary="Classify and route a Support Request",
        request=SupportTriageSerializer,
        responses={204: None},
    )
    def patch(self, request: Request, support_request_id: str) -> Response:
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        serializer = SupportTriageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        execute_support_command(
            lambda: triage_support_request(
                support_request=support_request,
                actor=cast(User, request.user),
                classification=serializer.validated_data.get("classification"),
                priority=serializer.validated_data.get("priority"),
                new_status=serializer.validated_data.get("status"),
                escalation_destination=serializer.validated_data.get("escalation_destination", ""),
                required_capability=serializer.validated_data.get("required_capability"),
                reason=serializer.validated_data.get("reason", ""),
            )
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class OperatorSupportRequestReassignView(APIView):
    permission_classes = (CanManageSupportQueue,)

    @extend_schema(
        summary="Reassign an abandoned Support Request",
        request=SupportReassignmentSerializer,
        responses={200: SupportRequestSerializer},
    )
    def post(self, request: Request, support_request_id: str) -> Response:
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        serializer = SupportReassignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_assignee = get_object_or_404(
            User,
            email__iexact=serializer.validated_data["assignee_email"],
        )
        support_request = execute_support_command(
            lambda: reassign_abandoned_support_request(
                support_request=support_request,
                actor=cast(User, request.user),
                new_assignee=new_assignee,
                reason=serializer.validated_data["reason"],
            )
        )
        support_request = operator_support_request(
            request=request, support_request_id=support_request_id
        )
        return Response(SupportRequestSerializer(support_request).data)
