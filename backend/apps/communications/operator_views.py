from typing import cast

from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User
from apps.common.pagination import StandardPageNumberPagination

from .models import (
    ConversationModerationEvent,
    ConversationModerationEventType,
    ConversationReport,
)
from .operator_serializers import (
    ConversationEvidenceReleaseResultSerializer,
    ConversationEvidenceReleaseSerializer,
    ConversationReportDecisionResultSerializer,
    ConversationReportDecisionSerializer,
    ConversationReportDetailSerializer,
    ConversationReportQueueSerializer,
)
from .services import decide_conversation_report, release_conversation_report_evidence


class ConversationModeratorView(APIView):
    def initial(self, request: Request, *args: object, **kwargs: object) -> None:
        super().initial(request, *args, **kwargs)
        if not has_capability(cast(User, request.user), OperatorCapability.MODERATE_CONVERSATIONS):
            raise PermissionDenied("دسترسی بررسی گزارش‌های گفت‌وگو داده نشده است.")


@extend_schema_view(
    get=extend_schema(
        summary="List Conversation Reports",
        responses={200: ConversationReportQueueSerializer(many=True)},
    )
)
class ConversationReportListView(ConversationModeratorView):
    pagination_class = StandardPageNumberPagination

    def get(self, request: Request) -> Response:
        reports = ConversationReport.objects.all()
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(reports, request, view=self)
        serializer = ConversationReportQueueSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class ConversationReportDetailView(ConversationModeratorView):
    @extend_schema(
        summary="Inspect evidence for one Conversation Report",
        responses={200: ConversationReportDetailSerializer},
    )
    def get(self, request: Request, report_id: str) -> Response:
        report = get_object_or_404(ConversationReport, id=report_id)
        ConversationModerationEvent.objects.create(
            report=report,
            actor=cast(User, request.user),
            event_type=ConversationModerationEventType.INSPECTED,
        )
        report = (
            ConversationReport.objects
            .select_related("reporter")
            .prefetch_related(
                "moderation_events__actor",
                "initiation_suspensions",
            )
            .get(id=report.id)
        )
        return Response(ConversationReportDetailSerializer(report).data)


class ConversationReportDecisionView(ConversationModeratorView):
    @extend_schema(
        summary="Decide a Conversation Report and apply proportionate restrictions",
        request=ConversationReportDecisionSerializer,
        responses={200: ConversationReportDecisionResultSerializer},
    )
    def post(self, request: Request, report_id: str) -> Response:
        report = get_object_or_404(ConversationReport, id=report_id)
        serializer = ConversationReportDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            outcome = decide_conversation_report(
                report=report,
                actor=cast(User, request.user),
                **serializer.validated_data,
            )
        except DjangoValidationError as exc:
            from rest_framework.exceptions import ValidationError

            raise ValidationError(exc.messages) from None
        report = outcome.report
        return Response({
            "id": str(report.id),
            "status": report.status,
            "pair_restricted": outcome.pair_restricted,
            "suspended_account_id": (
                str(outcome.suspended_account_id)
                if outcome.suspended_account_id is not None
                else None
            ),
            "decided_at": report.decided_at,
        })


class ConversationEvidenceReleaseView(ConversationModeratorView):
    @extend_schema(
        summary="Release retained Conversation Report evidence",
        request=ConversationEvidenceReleaseSerializer,
        responses={200: ConversationEvidenceReleaseResultSerializer},
    )
    def post(self, request: Request, report_id: str) -> Response:
        report = get_object_or_404(ConversationReport, id=report_id)
        serializer = ConversationEvidenceReleaseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            report = release_conversation_report_evidence(
                report=report,
                actor=cast(User, request.user),
                **serializer.validated_data,
            )
        except DjangoValidationError as exc:
            from rest_framework.exceptions import ValidationError

            raise ValidationError(exc.messages) from None
        return Response({
            "id": str(report.id),
            "evidence_retention_status": report.evidence_retention_status,
            "evidence_released_at": report.evidence_released_at,
        })
