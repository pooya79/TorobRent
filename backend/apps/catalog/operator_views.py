from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import TypedDict, cast

from django.db.models import Exists, OuterRef, Q
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
    PropertyPartitionDecision,
)
from .operator_serializers import (
    CatalogCurationMetricsSerializer,
    CatalogCurationPropertySearchPageSerializer,
    CatalogCurationPropertySearchSerializer,
    CatalogCurationSummarySerializer,
    GroupedPropertyDetailSerializer,
    GroupedPropertyPageSerializer,
    GroupedPropertySummarySerializer,
    PropertyComparisonSerializer,
    PropertyMatchApproveRequestSerializer,
    PropertyMatchClaimRequestSerializer,
    PropertyMatchDecisionSerializer,
    PropertyMatchSuggestionDecisionRequestSerializer,
    PropertyMatchSuggestionDetailSerializer,
    PropertyMatchSuggestionPageSerializer,
    PropertyMatchSuggestionSerializer,
    PropertyMatchSuggestionSnoozeRequestSerializer,
    PropertyPartitionClaimRequestSerializer,
    PropertyPartitionConfirmRequestSerializer,
    PropertyPartitionDecisionSerializer,
    PropertyPartitionPreviewSerializer,
    PropertyPartitionSelectionSerializer,
    grouped_property_data,
    property_search_data,
    suggestion_data,
)
from .property_partitions import claim_partition, confirm_partition, partition_preview
from .selectors import (
    search_current_properties_for_curation,
    search_grouped_properties_for_curation,
)


class CanCurateCatalog(BasePermission):
    message = "مجوز ساماندهی کاتالوگ لازم است."

    def has_permission(self, request: Request, view: APIView) -> bool:
        return has_capability(cast(User, request.user), OperatorCapability.CURATE_CATALOG)


class MetricBucket(TypedDict):
    band: str
    scoring_version: str
    suggestion_count: int
    pending_count: int
    accepted_count: int
    rejected_count: int
    oldest_age_hours: float


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


class GroupedPropertyListView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        operation_id="v1_operator_catalog_curation_grouped_properties_list",
        summary="Inspect every current Property containing multiple Listings",
        parameters=[
            OpenApiParameter(name="q", type=str, location="query"),
            OpenApiParameter(name="attention", type=str, location="query"),
            OpenApiParameter(name="changed", type=str, location="query"),
            OpenApiParameter(name="stability", type=str, location="query"),
            OpenApiParameter(name="measurement_status", type=str, location="query"),
            OpenApiParameter(name="scoring_version", type=str, location="query"),
            OpenApiParameter(name="ordering", type=str, location="query"),
            OpenApiParameter(name="page", type=int, location="query"),
            OpenApiParameter(name="page_size", type=int, location="query"),
        ],
        responses={200: GroupedPropertyPageSerializer},
    )
    def get(self, request: Request) -> Response:
        properties = list(
            search_grouped_properties_for_curation(request.query_params.get("q", "").strip())
        )
        results = [grouped_property_data(property_) for property_ in properties]
        attention = request.query_params.get("attention", "all")
        changed = request.query_params.get("changed", "all")
        stability = request.query_params.get("stability", "all")
        measurement_status = request.query_params.get("measurement_status", "all")
        scoring_version = request.query_params.get("scoring_version", "")
        if attention == "needs_attention":
            results = [item for item in results if item["needs_attention"]]
        if changed == "recent":
            cutoff = timezone.now() - timedelta(days=30)
            results = [
                item
                for item in results
                if isinstance(item["last_grouping_change"], datetime)
                and item["last_grouping_change"] >= cutoff
            ]
        if stability == "stable":
            results = [item for item in results if item["attention_status"] == "stable"]
        if measurement_status != "all":
            results = [item for item in results if item["measurement_status"] == measurement_status]
        if scoring_version:
            results = [item for item in results if item["scoring_version"] == scoring_version]
        priority = {
            "needs_attention": 0,
            "recent_change": 1,
            "stable": 2,
            "not_measured": 3,
        }
        ordering = request.query_params.get("ordering", "needs_attention")
        if ordering == "recent_change":
            results.sort(
                key=lambda item: str(item["last_grouping_change"] or ""),
                reverse=True,
            )
        elif ordering == "stability":
            results.sort(
                key=lambda item: (item["measurement_status"] != "measured", str(item["id"]))
            )
        elif ordering == "measurement_status":
            measurement_priority = {"stale": 0, "not_measured": 1, "measured": 2}
            results.sort(
                key=lambda item: (
                    measurement_priority[cast(str, item["measurement_status"])],
                    str(item["id"]),
                )
            )
        else:
            results.sort(
                key=lambda item: (
                    priority[cast(str, item["attention_status"])],
                    str(item["id"]),
                )
            )
        paginator = StandardPageNumberPagination()
        selected = paginator.paginate_queryset(results, request, view=self)
        assert selected is not None
        data = GroupedPropertySummarySerializer(selected, many=True).data
        return paginator.get_paginated_response(data)


class GroupedPropertyDetailView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        operation_id="v1_operator_catalog_curation_grouped_properties_detail",
        summary="Inspect one grouped Property's consistency evidence and history",
        responses={200: GroupedPropertyDetailSerializer},
    )
    def get(self, request: Request, property_id: uuid.UUID) -> Response:
        property_ = get_object_or_404(
            search_grouped_properties_for_curation(""),
            pk=property_id,
        )
        payload = grouped_property_data(property_, include_detail=True)
        return Response(GroupedPropertyDetailSerializer(payload).data)


class PropertyPartitionPreviewView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Preview a proper subset partition from one grouped Property",
        request=PropertyPartitionSelectionSerializer,
        responses={200: PropertyPartitionPreviewSerializer},
    )
    def post(self, request: Request, property_id: uuid.UUID) -> Response:
        serializer = PropertyPartitionSelectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = partition_preview(
            actor=cast(User, request.user),
            property_id=property_id,
            **serializer.validated_data,
        )
        return Response(PropertyPartitionPreviewSerializer(payload).data)


class PropertyPartitionClaimView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Start or renew a grouped Property partition review",
        request=PropertyPartitionClaimRequestSerializer,
        responses={200: PropertyPartitionPreviewSerializer},
    )
    def post(self, request: Request, property_id: uuid.UUID) -> Response:
        serializer = PropertyPartitionClaimRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = claim_partition(
            actor=cast(User, request.user),
            property_id=property_id,
            **serializer.validated_data,
        )
        return Response(PropertyPartitionPreviewSerializer(payload).data)


class PropertyPartitionConfirmView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Confirm one reviewed grouped Property partition",
        request=PropertyPartitionConfirmRequestSerializer,
        responses={
            200: PropertyPartitionDecisionSerializer,
            201: PropertyPartitionDecisionSerializer,
        },
    )
    def post(self, request: Request, property_id: uuid.UUID) -> Response:
        serializer = PropertyPartitionConfirmRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        already_decided = PropertyPartitionDecision.objects.filter(
            claim_id=serializer.validated_data["claim_id"]
        ).exists()
        decision = confirm_partition(
            actor=cast(User, request.user),
            property_id=property_id,
            **serializer.validated_data,
        )
        return Response(
            PropertyPartitionDecisionSerializer(decision).data,
            status=200 if already_decided else 201,
        )


class PropertyPartitionDecisionView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Read a retained Property partition decision",
        responses={200: PropertyPartitionDecisionSerializer},
    )
    def get(self, request: Request, decision_id: uuid.UUID) -> Response:
        decision = get_object_or_404(PropertyPartitionDecision, pk=decision_id)
        return Response(PropertyPartitionDecisionSerializer(decision).data)


class PropertyMatchSuggestionListView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Browse persisted Property Match Suggestions",
        parameters=[
            OpenApiParameter(name="band", type=str, location="query"),
            OpenApiParameter(name="q", type=str, location="query"),
            OpenApiParameter(name="claim", type=str, location="query"),
            OpenApiParameter(name="age", type=str, location="query"),
            OpenApiParameter(name="own_work", type=str, location="query"),
            OpenApiParameter(name="ordering", type=str, location="query"),
            OpenApiParameter(name="state", type=str, location="query"),
            OpenApiParameter(name="page", type=int, location="query"),
            OpenApiParameter(name="page_size", type=int, location="query"),
        ],
        responses={200: PropertyMatchSuggestionPageSerializer},
    )
    def get(self, request: Request) -> Response:
        actor = cast(User, request.user)
        band = request.query_params.get("band", "likely")
        query = request.query_params.get("q", "").strip()
        claim_filter = request.query_params.get("claim", "unclaimed")
        ordering = request.query_params.get("ordering", "confidence")
        state = request.query_params.get("state", PropertyMatchSuggestionState.PENDING)
        age = request.query_params.get("age", "all")
        own_work = request.query_params.get("own_work", "all")
        from apps.submissions.models import Submission

        active_claims = PropertyMatchClaim.objects.filter(
            left_id=OuterRef("left_id"),
            right_id=OuterRef("right_id"),
            expires_at__gt=timezone.now(),
        )
        my_active_claims = active_claims.filter(actor=actor)
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
            .annotate(
                has_active_claim=Exists(active_claims),
                claimed_by_me=Exists(my_active_claims),
            )
        )
        own_submissions = Submission.objects.filter(
            submitter=actor,
        ).filter(
            Q(listing__property_id=OuterRef("left_id"))
            | Q(listing__property_id=OuterRef("right_id"))
        )
        suggestions = suggestions.annotate(has_own_work=Exists(own_submissions))
        if query:
            matching_properties = search_current_properties_for_curation(query)
            suggestions = suggestions.filter(
                Q(left__in=matching_properties) | Q(right__in=matching_properties)
            )
        if state != "all":
            suggestions = suggestions.filter(state=state)
        if band != "all":
            suggestions = suggestions.filter(band=band)
        if claim_filter == "unclaimed":
            suggestions = suggestions.filter(has_active_claim=False)
        elif claim_filter == "claimed":
            suggestions = suggestions.filter(has_active_claim=True)
        elif claim_filter == "mine":
            suggestions = suggestions.filter(claimed_by_me=True)
        age_thresholds = {
            "older_than_24_hours": timezone.now() - timedelta(hours=24),
            "older_than_7_days": timezone.now() - timedelta(days=7),
        }
        if age in age_thresholds:
            suggestions = suggestions.filter(first_suggested_at__lte=age_thresholds[age])
        if own_work == "conflict":
            suggestions = suggestions.filter(has_own_work=True)
        elif own_work == "clear":
            suggestions = suggestions.filter(has_own_work=False)
        orderings = {
            "confidence": ("-score", "first_suggested_at", "id"),
            "oldest": ("first_suggested_at", "id"),
            "newest_evidence": ("-last_evaluated_at", "id"),
        }
        if ordering == "status":
            from django.db.models import Case, IntegerField, Value, When

            suggestions = suggestions.annotate(
                status_priority=Case(
                    When(state="pending", then=Value(0)),
                    When(state="snoozed", then=Value(1)),
                    When(state="rejected", then=Value(2)),
                    When(state="approved", then=Value(3)),
                    default=Value(4),
                    output_field=IntegerField(),
                )
            ).order_by("status_priority", "-score", "id")
        else:
            suggestions = suggestions.order_by(*orderings.get(ordering, orderings["confidence"]))
        paginator = StandardPageNumberPagination()
        selected = paginator.paginate_queryset(suggestions, request, view=self)
        assert selected is not None
        results = PropertyMatchSuggestionSerializer(
            [suggestion_data(suggestion) for suggestion in selected], many=True
        ).data
        payload = paginator.get_paginated_response(results).data
        payload["filters"] = {
            "q": query,
            "band": band,
            "claim": claim_filter,
            "state": state,
            "age": age,
            "own_work": own_work,
            "ordering": ordering,
        }
        return Response(payload)


class CatalogCurationSummaryView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Summarize actionable Catalog Curation work",
        responses={200: CatalogCurationSummarySerializer},
    )
    def get(self, request: Request) -> Response:
        suggestion_count = PropertyMatchSuggestion.objects.filter(
            state=PropertyMatchSuggestionState.PENDING,
            left__merged_into__isnull=True,
            right__merged_into__isnull=True,
        ).count()
        grouped_property_count = sum(
            bool(grouped_property_data(property_)["needs_attention"])
            for property_ in search_grouped_properties_for_curation("")
        )
        payload = {
            "suggestion_count": suggestion_count,
            "grouped_property_count": grouped_property_count,
            "total_count": suggestion_count + grouped_property_count,
        }
        return Response(CatalogCurationSummarySerializer(payload).data)


class CatalogCurationMetricsView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Evaluate Catalog Curation outcomes by confidence and scoring version",
        responses={200: CatalogCurationMetricsSerializer},
    )
    def get(self, request: Request) -> Response:
        now = timezone.now()
        suggestions = list(PropertyMatchSuggestion.objects.prefetch_related("decisions"))
        buckets: dict[tuple[str, str], MetricBucket] = {}

        def bucket_for(band: str, scoring_version: str) -> MetricBucket:
            return buckets.setdefault(
                (band, scoring_version),
                {
                    "band": band,
                    "scoring_version": scoring_version,
                    "suggestion_count": 0,
                    "pending_count": 0,
                    "accepted_count": 0,
                    "rejected_count": 0,
                    "oldest_age_hours": 0.0,
                },
            )

        for suggestion in suggestions:
            terminal_decision = next(
                (
                    decision
                    for decision in reversed(list(suggestion.decisions.all()))
                    if decision.outcome
                    in (
                        PropertyMatchDecision.Outcome.SAME_PROPERTY,
                        PropertyMatchDecision.Outcome.NOT_SAME_PROPERTY,
                    )
                ),
                None,
            )
            snapshot = terminal_decision.evaluation_snapshot if terminal_decision else {}
            bucket = bucket_for(
                str(snapshot.get("band", suggestion.band)),
                str(snapshot.get("scoring_version", suggestion.scoring_version)),
            )
            bucket["suggestion_count"] += 1
            if suggestion.state == PropertyMatchSuggestionState.PENDING:
                bucket["pending_count"] += 1
            age_hours = max(0.0, (now - suggestion.first_suggested_at).total_seconds() / 3600)
            bucket["oldest_age_hours"] = max(bucket["oldest_age_hours"], age_hours)
            if terminal_decision is not None:
                if terminal_decision.outcome == PropertyMatchDecision.Outcome.SAME_PROPERTY:
                    bucket["accepted_count"] += 1
                else:
                    bucket["rejected_count"] += 1
        breakdowns = []
        for bucket in buckets.values():
            decided = bucket["accepted_count"] + bucket["rejected_count"]
            breakdowns.append({
                **bucket,
                "acceptance_rate": bucket["accepted_count"] / decided if decided else 0,
                "rejection_rate": bucket["rejected_count"] / decided if decided else 0,
            })
        payload = {
            "suggestion_count": len(suggestions),
            "pending_count": sum(
                item.state == PropertyMatchSuggestionState.PENDING for item in suggestions
            ),
            "oldest_suggestion_age_hours": max(
                (
                    max(0.0, (now - item.first_suggested_at).total_seconds() / 3600)
                    for item in suggestions
                ),
                default=0.0,
            ),
            "breakdowns": sorted(
                breakdowns, key=lambda item: (str(item["band"]), str(item["scoring_version"]))
            ),
        }
        return Response(CatalogCurationMetricsSerializer(payload).data)


class PropertyMatchSuggestionDetailView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Inspect one Property Match Suggestion and its current evidence",
        responses={200: PropertyMatchSuggestionDetailSerializer},
    )
    def get(self, request: Request, suggestion_id: uuid.UUID) -> Response:
        lineage = get_object_or_404(
            PropertyMatchSuggestion.objects.only("pk", "rebased_to_id"),
            pk=suggestion_id,
        )
        visited: set[uuid.UUID] = set()
        while lineage.rebased_to_id is not None:
            if lineage.pk in visited:
                raise ValidationError("زنجیره بازپایه پیشنهاد نامعتبر است.")
            visited.add(lineage.pk)
            lineage = get_object_or_404(
                PropertyMatchSuggestion.objects.only("pk", "rebased_to_id"),
                pk=lineage.rebased_to_id,
            )
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
            pk=lineage.pk,
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
