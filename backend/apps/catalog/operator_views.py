from __future__ import annotations

import uuid
from typing import cast

from django.db.models import Exists, OuterRef
from django.http import FileResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User
from apps.common.pagination import StandardPageNumberPagination
from apps.common.serializers import ProblemSerializer

from .match_decisions import (
    approve_comparison,
    claim_comparison,
    comparison_data,
    decide_suggestion,
)
from .models import (
    PropertyImage,
    PropertyMatchClaim,
    PropertyMatchDecision,
    PropertyMatchSuggestion,
    PropertyMatchSuggestionState,
)
from .operator_serializers import (
    CatalogCurationPropertySearchPageSerializer,
    CatalogCurationPropertySearchSerializer,
    PropertyComparisonSerializer,
    PropertyMatchApproveRequestSerializer,
    PropertyMatchClaimRequestSerializer,
    PropertyMatchDecisionSerializer,
    PropertyMatchSuggestionDecisionRequestSerializer,
    PropertyMatchSuggestionDetailSerializer,
    PropertyMatchSuggestionPageSerializer,
    PropertyMatchSuggestionSerializer,
    PropertyMatchSuggestionSnoozeRequestSerializer,
    property_search_data,
    suggestion_data,
)
from .selectors import search_current_properties_for_curation


class CanCurateCatalog(BasePermission):
    message = "مجوز ساماندهی کاتالوگ لازم است."

    def has_permission(self, request: Request, view: APIView) -> bool:
        return has_capability(cast(User, request.user), OperatorCapability.CURATE_CATALOG)


class CatalogCurationPropertySearchView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Search current Properties for manual Catalog Curation comparison",
        parameters=[
            OpenApiParameter(
                name="q",
                type=str,
                location="query",
                description=(
                    "Optional Property ID, Listing ID, Source display name, neighborhood, or "
                    "source reference. Persian characters and spacing are normalized. An empty "
                    "query lists current non-merged Properties."
                ),
            ),
            OpenApiParameter(name="page", type=int, location="query", description="Page number."),
            OpenApiParameter(
                name="page_size",
                type=int,
                location="query",
                description="Results per page; defaults to 25 and is capped at 100.",
            ),
        ],
        responses={200: CatalogCurationPropertySearchPageSerializer},
    )
    def get(self, request: Request) -> Response:
        properties = search_current_properties_for_curation(
            request.query_params.get("q", "").strip()
        )
        paginator = StandardPageNumberPagination()
        selected = paginator.paginate_queryset(properties, request, view=self)
        assert selected is not None
        data = CatalogCurationPropertySearchSerializer(
            [property_search_data(property_) for property_ in selected], many=True
        ).data
        return paginator.get_paginated_response(data)


class PropertyComparisonView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Compare exactly two current Properties",
        parameters=[
            OpenApiParameter(
                name="property",
                type=uuid.UUID,
                many=True,
                location="query",
                required=True,
                description="Exactly two different current, non-merged Property IDs.",
            )
        ],
        responses={200: PropertyComparisonSerializer},
    )
    def get(self, request: Request) -> Response:
        raw_ids = request.query_params.getlist("property")
        if len(raw_ids) != 2 or raw_ids[0] == raw_ids[1]:
            raise ValidationError({"property": "دقیقاً دو ملک متفاوت انتخاب کنید."})
        try:
            property_ids = [uuid.UUID(value) for value in raw_ids]
        except ValueError as exc:
            raise ValidationError({"property": "شناسه ملک معتبر نیست."}) from exc
        payload = comparison_data(property_ids)
        return Response(PropertyComparisonSerializer(payload).data)


class PropertyMatchSuggestionListView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Browse persisted Property Match Suggestions",
        parameters=[
            OpenApiParameter(name="band", type=str, location="query"),
            OpenApiParameter(name="claim", type=str, location="query"),
            OpenApiParameter(name="ordering", type=str, location="query"),
            OpenApiParameter(name="state", type=str, location="query"),
            OpenApiParameter(name="page", type=int, location="query"),
            OpenApiParameter(name="page_size", type=int, location="query"),
        ],
        responses={200: PropertyMatchSuggestionPageSerializer},
    )
    def get(self, request: Request) -> Response:
        band = request.query_params.get("band", "likely")
        claim_filter = request.query_params.get("claim", "unclaimed")
        ordering = request.query_params.get("ordering", "confidence")
        state = request.query_params.get("state", PropertyMatchSuggestionState.PENDING)
        active_claims = PropertyMatchClaim.objects.filter(
            left_id=OuterRef("left_id"),
            right_id=OuterRef("right_id"),
            expires_at__gt=timezone.now(),
        )
        suggestions = (
            PropertyMatchSuggestion.objects
            .select_related(
                "left__city",
                "left__neighborhood",
                "right__city",
                "right__neighborhood",
            )
            .prefetch_related(
                "left__listings__source",
                "right__listings__source",
            )
            .filter(
                left__merged_into__isnull=True,
                right__merged_into__isnull=True,
            )
            .annotate(has_active_claim=Exists(active_claims))
        )
        if state != "all":
            suggestions = suggestions.filter(state=state)
        if band != "all":
            suggestions = suggestions.filter(band=band)
        if claim_filter == "unclaimed":
            suggestions = suggestions.filter(has_active_claim=False)
        elif claim_filter == "claimed":
            suggestions = suggestions.filter(has_active_claim=True)
        orderings = {
            "confidence": ("-score", "first_suggested_at", "id"),
            "oldest": ("first_suggested_at", "id"),
            "newest_evidence": ("-last_evaluated_at", "id"),
        }
        suggestions = suggestions.order_by(*orderings.get(ordering, orderings["confidence"]))
        paginator = StandardPageNumberPagination()
        selected = paginator.paginate_queryset(suggestions, request, view=self)
        assert selected is not None
        results = PropertyMatchSuggestionSerializer(
            [suggestion_data(suggestion) for suggestion in selected], many=True
        ).data
        payload = paginator.get_paginated_response(results).data
        payload["filters"] = {
            "band": band,
            "claim": claim_filter,
            "ordering": ordering,
        }
        return Response(payload)


class PropertyMatchSuggestionDetailView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Inspect one Property Match Suggestion and its current evidence",
        responses={200: PropertyMatchSuggestionDetailSerializer},
    )
    def get(self, request: Request, suggestion_id: uuid.UUID) -> Response:
        suggestion = get_object_or_404(
            PropertyMatchSuggestion.objects
            .select_related(
                "left__city",
                "left__neighborhood",
                "right__city",
                "right__neighborhood",
            )
            .prefetch_related("left__listings__source", "right__listings__source")
            .filter(left__merged_into__isnull=True, right__merged_into__isnull=True),
            pk=suggestion_id,
        )
        payload = suggestion_data(suggestion, include_history=True)
        payload["comparison"] = comparison_data([suggestion.left_id, suggestion.right_id])
        return Response(PropertyMatchSuggestionDetailSerializer(payload).data)


class PropertyMatchClaimView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Start or renew a manual Property match review",
        request=PropertyMatchClaimRequestSerializer,
        responses={
            200: PropertyComparisonSerializer,
            400: ProblemSerializer,
            403: ProblemSerializer,
            409: ProblemSerializer,
        },
    )
    def post(self, request: Request) -> Response:
        serializer = PropertyMatchClaimRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = claim_comparison(actor=cast(User, request.user), **serializer.validated_data)
        return Response(PropertyComparisonSerializer(payload).data)


class PropertyMatchApproveView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Approve an Operator-initiated Property match",
        request=PropertyMatchApproveRequestSerializer,
        responses={
            200: PropertyMatchDecisionSerializer,
            201: PropertyMatchDecisionSerializer,
            400: ProblemSerializer,
            403: ProblemSerializer,
            409: ProblemSerializer,
        },
    )
    def post(self, request: Request) -> Response:
        serializer = PropertyMatchApproveRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        already_decided = PropertyMatchDecision.objects.filter(
            claim_id=serializer.validated_data["claim_id"]
        ).exists()
        decision = approve_comparison(actor=cast(User, request.user), **serializer.validated_data)
        return Response(
            PropertyMatchDecisionSerializer(decision).data, status=200 if already_decided else 201
        )


class PropertyMatchSuggestionRejectView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Record that a scheduled Property Match Suggestion is not the same Property",
        request=PropertyMatchSuggestionDecisionRequestSerializer,
        responses={
            200: PropertyMatchDecisionSerializer,
            201: PropertyMatchDecisionSerializer,
            400: ProblemSerializer,
            403: ProblemSerializer,
            409: ProblemSerializer,
        },
    )
    def post(self, request: Request, suggestion_id: uuid.UUID) -> Response:
        serializer = PropertyMatchSuggestionDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        already_decided = PropertyMatchDecision.objects.filter(
            claim_id=serializer.validated_data["claim_id"]
        ).exists()
        decision = decide_suggestion(
            actor=cast(User, request.user),
            suggestion_id=suggestion_id,
            outcome=PropertyMatchDecision.Outcome.NOT_SAME_PROPERTY,
            **serializer.validated_data,
        )
        return Response(
            PropertyMatchDecisionSerializer(decision).data,
            status=200 if already_decided else 201,
        )


class PropertyMatchSuggestionSnoozeView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Snooze a scheduled Property Match Suggestion",
        request=PropertyMatchSuggestionSnoozeRequestSerializer,
        responses={
            200: PropertyMatchDecisionSerializer,
            201: PropertyMatchDecisionSerializer,
            400: ProblemSerializer,
            403: ProblemSerializer,
            409: ProblemSerializer,
        },
    )
    def post(self, request: Request, suggestion_id: uuid.UUID) -> Response:
        serializer = PropertyMatchSuggestionSnoozeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        days = data.pop("days")
        already_decided = PropertyMatchDecision.objects.filter(claim_id=data["claim_id"]).exists()
        decision = decide_suggestion(
            actor=cast(User, request.user),
            suggestion_id=suggestion_id,
            outcome=PropertyMatchDecision.Outcome.SNOOZED,
            snooze_days=days,
            **data,
        )
        return Response(
            PropertyMatchDecisionSerializer(decision).data,
            status=200 if already_decided else 201,
        )


class PropertyMatchDecisionView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Read a retained Property Match Decision",
        responses={200: PropertyMatchDecisionSerializer},
    )
    def get(self, request: Request, decision_id: uuid.UUID) -> Response:
        decision = get_object_or_404(PropertyMatchDecision, pk=decision_id)
        return Response(PropertyMatchDecisionSerializer(decision).data)


class PropertyMatchImageView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Read restricted Property review imagery", responses={(200, "image/webp"): bytes}
    )
    def get(self, request: Request, image_id: uuid.UUID) -> FileResponse:
        image = get_object_or_404(PropertyImage, pk=image_id)
        variant = image.variants.select_related("asset").order_by("kind").first()
        if variant is None:
            from rest_framework.exceptions import NotFound

            raise NotFound()
        response = FileResponse(variant.asset.file.open("rb"), content_type="image/webp")
        response["Cache-Control"] = "private, no-store"
        return response
