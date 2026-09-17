"""Bounded reads for individual sections of an Operator's Source case."""

from typing import Any, cast

from django.db.models import Case, CharField, Exists, OuterRef, Q, QuerySet, Value, When
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import serializers
from rest_framework.filters import SearchFilter
from rest_framework.generics import ListAPIView, RetrieveAPIView, get_object_or_404

from apps.accounts.models import User
from apps.common.pagination import StandardPageNumberPagination

from .candidate_serializers import ExternalListingCandidateSerializer
from .exception_serializers import (
    SourceExceptionAttemptSerializer,
    SourceExtractionExceptionSerializer,
)
from .exclusion_serializers import SourceExclusionActionSerializer, SourceExclusionSerializer
from .extraction_serializers import ExtractionRequestSerializer
from .models import (
    ExternalListingCandidate,
    ExtractionRequest,
    SourceAssignment,
    SourceCaseResponsibilityChange,
    SourceExceptionAttempt,
    SourceExclusion,
    SourceExclusionAction,
    SourceExtractionException,
    SourceProfileRepair,
    SourceProfileVersion,
    SourceProposal,
    SourceProposalEvent,
)
from .operator_views import CanReleaseSourceProposal
from .serializers import (
    SourceProfileRepairSerializer,
    SourceProfileVersionSerializer,
    SourceProposalEventSerializer,
    SourceResponsibilityChangeSerializer,
)


class CasePagination(StandardPageNumberPagination):
    page_size = 20
    page_size_query_param = ""


class ResultQuerySerializer(serializers.Serializer[Any]):
    q = serializers.CharField(required=False, allow_blank=True, max_length=200)
    status = serializers.ChoiceField(
        choices=("all", "ready", "issues", "published", "archived"), required=False
    )
    run = serializers.UUIDField(required=False)


class ExternalListingCandidateSummarySerializer(ExternalListingCandidateSerializer):
    class Meta:
        model = ExternalListingCandidate
        fields = tuple(
            name
            for name in ExternalListingCandidateSerializer.Meta.fields
            if name
            not in (
                "evidence",
                "source_claims",
                "description",
                "corrections",
                "media",
                "history",
            )
        )
        read_only_fields = fields


def case_for_operator(proposal_id: str, actor: User) -> SourceProposal:
    return get_object_or_404(
        SourceProposal.objects.exclude(state="draft", revision=1).exclude(submitter=actor),
        pk=proposal_id,
    )


def result_candidates(proposal: SourceProposal) -> QuerySet[ExternalListingCandidate]:
    # The latest retained result is independent of whether the latest attempt failed.
    latest = (
        ExternalListingCandidate.objects
        .filter(
            source_proposal=proposal,
            discovery_version__isnull=True,
            superseded=False,
            external_url=OuterRef("external_url"),
        )
        .order_by("-created_at", "-pk")
        .values("pk")[:1]
    )
    return ExternalListingCandidate.objects.filter(
        source_proposal=proposal,
        discovery_version__isnull=True,
        superseded=False,
        pk=latest,
    )


def with_result_group(
    candidates: QuerySet[ExternalListingCandidate],
) -> QuerySet[ExternalListingCandidate]:
    authorization = SourceAssignment.objects.filter(
        pk=OuterRef("extraction_run__request__assignment_id"),
        revoked_at__isnull=True,
        source__processing_paused=False,
        source__processing_revision=OuterRef("extraction_run__request__processing_revision"),
        representative_id=OuterRef("extraction_run__request__requester_id"),
        approval__version_id=OuterRef("extraction_run__request__profile_version_id"),
        source__profile__active_version_id=OuterRef("extraction_run__request__profile_version_id"),
    )
    candidates = candidates.annotate(_authorized=Exists(authorization))
    current = Q(extraction_run__isnull=True) | Q(_authorized=True)
    unblocked = Q(exclusion_hold__isnull=True) | Q(exclusion_hold__actions__action="remove")
    ready = Q(state="pending", validation_errors={}) & current & unblocked
    return candidates.annotate(
        _group=Case(
            When(superseded=True, then=Value("archived")),
            When(state="published", then=Value("published")),
            When(Q(state__in=("rejected", "cancelled")) | ~current, then=Value("archived")),
            When(ready, then=Value("ready")),
            default=Value("issues"),
            output_field=CharField(),
        )
    ).distinct()


@extend_schema_view(get=extend_schema(summary="Operator Case Results View"))
class OperatorCaseResultsView(ListAPIView[ExternalListingCandidate]):
    permission_classes = (CanReleaseSourceProposal,)
    pagination_class = CasePagination
    serializer_class = ExternalListingCandidateSummarySerializer

    @extend_schema(parameters=[ResultQuerySerializer])
    def get(self, *args: Any, **kwargs: Any) -> Any:
        return super().get(*args, **kwargs)

    def get_queryset(self) -> QuerySet[ExternalListingCandidate]:
        proposal = case_for_operator(self.kwargs["proposal_id"], cast(User, self.request.user))
        query = ResultQuerySerializer(data=self.request.query_params)
        query.is_valid(raise_exception=True)
        candidates = result_candidates(proposal)
        if run := query.validated_data.get("run"):
            candidates = candidates.filter(extraction_run_id=run)
        if search := query.validated_data.get("q"):
            candidates = candidates.filter(
                Q(title__icontains=search) | Q(external_url__icontains=search)
            )
        candidates = with_result_group(candidates)
        if (group := query.validated_data.get("status", "all")) != "all":
            candidates = candidates.filter(**{"_group": group})
        return (
            candidates
            .select_related("source", "source_proposal", "exclusion_hold")
            .prefetch_related(
                "extraction_run__request__assignment",
                "exclusion_hold__actions",
            )
            .defer("evidence", "source_claims", "description", "corrections")
            .order_by("-created_at", "-pk")
        )


@extend_schema_view(get=extend_schema(summary="Operator Candidate Detail View"))
class OperatorCandidateDetailView(RetrieveAPIView[ExternalListingCandidate]):
    permission_classes = (CanReleaseSourceProposal,)
    serializer_class = ExternalListingCandidateSerializer
    lookup_url_kwarg = "candidate_id"

    def get_queryset(self) -> QuerySet[ExternalListingCandidate]:
        return (
            ExternalListingCandidate.objects
            .exclude(source_proposal__submitter=cast(User, self.request.user))
            .exclude(source_proposal__state="draft", source_proposal__revision=1)
            .select_related(
                "source",
                "source_proposal",
                "extraction_run__request__assignment",
                "exclusion_hold",
            )
            .prefetch_related("events__actor", "images__variants", "exclusion_hold__actions")
        )


class CaseSearchFilter(SearchFilter):
    search_param = "q"


@extend_schema_view(get=extend_schema(summary="Operator Case Runs View"))
class OperatorCaseRunsView(ListAPIView[ExtractionRequest]):
    permission_classes = (CanReleaseSourceProposal,)
    pagination_class = CasePagination
    serializer_class = ExtractionRequestSerializer
    filter_backends = (CaseSearchFilter,)
    search_fields = ("canonical_url", "state")

    def get_serializer_context(self) -> dict[str, Any]:
        return {**super().get_serializer_context(), "summary": True}

    def get_queryset(self) -> QuerySet[ExtractionRequest]:
        proposal = case_for_operator(self.kwargs["proposal_id"], cast(User, self.request.user))
        return (
            ExtractionRequest.objects
            .filter(assignment__proposal=proposal)
            .select_related(
                "run",
                "assignment",
                "profile_version__reservation",
            )
            .defer("run__results", "run__discovery_checkpoint")
            .order_by("-created_at", "-pk")
        )


@extend_schema_view(get=extend_schema(summary="Operator Case History View"))
class OperatorCaseHistoryView(ListAPIView[SourceProposalEvent]):
    permission_classes = (CanReleaseSourceProposal,)
    pagination_class = CasePagination
    serializer_class = SourceProposalEventSerializer
    filter_backends = (CaseSearchFilter,)
    search_fields = ("reason", "new_state")

    def get_queryset(self) -> QuerySet[SourceProposalEvent]:
        proposal = case_for_operator(self.kwargs["proposal_id"], cast(User, self.request.user))
        return proposal.events.select_related("actor").order_by("-created_at", "-pk")


@extend_schema_view(get=extend_schema(summary="Operator Case Responsibility History View"))
class OperatorCaseResponsibilityHistoryView(ListAPIView[SourceCaseResponsibilityChange]):
    permission_classes = (CanReleaseSourceProposal,)
    pagination_class = CasePagination
    serializer_class = SourceResponsibilityChangeSerializer
    filter_backends = (CaseSearchFilter,)
    search_fields = ("reason", "operator__email", "actor__email")

    def get_queryset(self) -> QuerySet[SourceCaseResponsibilityChange]:
        proposal = case_for_operator(self.kwargs["proposal_id"], cast(User, self.request.user))
        return proposal.responsibility_history.select_related("actor", "operator").order_by(
            "-created_at", "-pk"
        )


class SourceProfileSummarySerializer(SourceProfileVersionSerializer):
    class Meta:
        model = SourceProfileVersion
        fields = (
            "id",
            "number",
            "parent",
            "status",
            "is_active",
            "created_at",
            "created_by_label",
            "provenance",
            "review_mode",
        )


@extend_schema_view(get=extend_schema(summary="Operator Case Profiles View"))
class OperatorCaseProfilesView(ListAPIView[SourceProfileVersion]):
    permission_classes = (CanReleaseSourceProposal,)
    pagination_class = CasePagination
    serializer_class = SourceProfileSummarySerializer
    filter_backends = (CaseSearchFilter,)
    search_fields = ("provenance", "decision__event__reason")

    def get_queryset(self) -> QuerySet[SourceProfileVersion]:
        proposal = case_for_operator(self.kwargs["proposal_id"], cast(User, self.request.user))
        return (
            SourceProfileVersion.objects
            .filter(reservation__proposal=proposal)
            .select_related(
                "profile",
                "decision__event",
                "created_by",
            )
            .defer("rules", "samples", "validation", "diagnostics", "structural_fingerprint")
            .order_by("-number", "-pk")
        )


@extend_schema_view(get=extend_schema(summary="Operator Case Profile Detail View"))
class OperatorCaseProfileDetailView(RetrieveAPIView[SourceProfileVersion]):
    permission_classes = (CanReleaseSourceProposal,)
    serializer_class = SourceProfileVersionSerializer
    lookup_url_kwarg = "version_id"

    def get_queryset(self) -> QuerySet[SourceProfileVersion]:
        proposal = case_for_operator(self.kwargs["proposal_id"], cast(User, self.request.user))
        return (
            SourceProfileVersion.objects
            .filter(reservation__proposal=proposal)
            .select_related(
                "profile",
                "parent",
                "decision__event",
                "created_by",
            )
            .prefetch_related(
                "media_candidates__images__variants",
                "media_candidates__events__actor",
                "media_candidates__source",
            )
        )


@extend_schema_view(get=extend_schema(summary="Operator Case Repairs View"))
class OperatorCaseRepairsView(ListAPIView[SourceProfileRepair]):
    permission_classes = (CanReleaseSourceProposal,)
    pagination_class = CasePagination
    serializer_class = SourceProfileRepairSerializer
    filter_backends = (CaseSearchFilter,)
    search_fields = ("result__detail", "result__outcome")

    def get_queryset(self) -> QuerySet[SourceProfileRepair]:
        proposal = case_for_operator(self.kwargs["proposal_id"], cast(User, self.request.user))
        return (
            SourceProfileRepair.objects
            .filter(parent__reservation__proposal=proposal)
            .select_related("result")
            .order_by("-started_at", "-pk")
        )


class ProblemQuerySerializer(serializers.Serializer[Any]):
    state = serializers.ChoiceField(choices=("all", "open", "excluded", "resolved"), required=False)


class SourceProblemSummarySerializer(SourceExtractionExceptionSerializer):
    class Meta:
        model = SourceExtractionException
        fields = tuple(
            name for name in SourceExtractionExceptionSerializer.Meta.fields if name != "history"
        )


@extend_schema_view(
    get=extend_schema(summary="List Source page outcomes", parameters=[ProblemQuerySerializer])
)
class OperatorCaseProblemsView(ListAPIView[SourceExtractionException]):
    permission_classes = (CanReleaseSourceProposal,)
    pagination_class = CasePagination
    serializer_class = SourceProblemSummarySerializer
    filter_backends = (CaseSearchFilter,)
    search_fields = ("canonical_url", "detail", "problem", "state")

    def get_queryset(self) -> QuerySet[SourceExtractionException]:
        proposal = case_for_operator(self.kwargs["proposal_id"], cast(User, self.request.user))
        query = ProblemQuerySerializer(data=self.request.query_params)
        query.is_valid(raise_exception=True)
        records = SourceExtractionException.objects.filter(
            source__assignments__proposal=proposal
        ).distinct()
        if (state := query.validated_data.get("state", "all")) != "all":
            records = records.filter(state=state)
        return records.select_related("source").order_by("-last_attempt_at", "-pk")


@extend_schema_view(get=extend_schema(summary="Operator Case Attempts View"))
class OperatorCaseAttemptsView(ListAPIView[SourceExceptionAttempt]):
    permission_classes = (CanReleaseSourceProposal,)
    pagination_class = CasePagination
    serializer_class = SourceExceptionAttemptSerializer
    filter_backends = (CaseSearchFilter,)
    search_fields = ("detail", "state", "problem")

    def get_queryset(self) -> QuerySet[SourceExceptionAttempt]:
        proposal = case_for_operator(self.kwargs["proposal_id"], cast(User, self.request.user))
        exception = get_object_or_404(
            SourceExtractionException,
            pk=self.kwargs["exception_id"],
            source__assignments__proposal=proposal,
        )
        return exception.history.order_by("-attempted_at", "-pk")


class SourceExclusionSummarySerializer(SourceExclusionSerializer):
    class Meta:
        model = SourceExclusion
        fields = tuple(name for name in SourceExclusionSerializer.Meta.fields if name != "actions")


@extend_schema_view(get=extend_schema(summary="Operator Case Exclusions View"))
class OperatorCaseExclusionsView(ListAPIView[SourceExclusion]):
    permission_classes = (CanReleaseSourceProposal,)
    pagination_class = CasePagination
    serializer_class = SourceExclusionSummarySerializer
    filter_backends = (CaseSearchFilter,)
    search_fields = ("url", "reason", "kind")

    def get_queryset(self) -> QuerySet[SourceExclusion]:
        proposal = case_for_operator(self.kwargs["proposal_id"], cast(User, self.request.user))
        return (
            SourceExclusion.objects
            .filter(source__assignments__proposal=proposal)
            .prefetch_related("actions")
            .order_by("-created_at", "-pk")
        )


@extend_schema_view(get=extend_schema(summary="Operator Case Exclusion Actions View"))
class OperatorCaseExclusionActionsView(ListAPIView[SourceExclusionAction]):
    permission_classes = (CanReleaseSourceProposal,)
    pagination_class = CasePagination
    serializer_class = SourceExclusionActionSerializer
    filter_backends = (CaseSearchFilter,)
    search_fields = ("reason", "action")

    def get_queryset(self) -> QuerySet[SourceExclusionAction]:
        proposal = case_for_operator(self.kwargs["proposal_id"], cast(User, self.request.user))
        exclusion = get_object_or_404(
            SourceExclusion,
            pk=self.kwargs["exclusion_id"],
            source__assignments__proposal=proposal,
        )
        return exclusion.actions.order_by("-created_at", "-pk")


@extend_schema_view(get=extend_schema(summary="Read selected extraction run details"))
class OperatorCaseRunDetailView(RetrieveAPIView[ExtractionRequest]):
    permission_classes = (CanReleaseSourceProposal,)
    serializer_class = ExtractionRequestSerializer
    lookup_field = "run__id"
    lookup_url_kwarg = "run_id"

    def get_serializer_context(self) -> dict[str, Any]:
        return {**super().get_serializer_context(), "summary": True, "technical": True}

    def get_queryset(self) -> QuerySet[ExtractionRequest]:
        proposal = case_for_operator(self.kwargs["proposal_id"], cast(User, self.request.user))
        return (
            ExtractionRequest.objects
            .filter(assignment__proposal=proposal)
            .select_related("run", "assignment", "profile_version__reservation")
            .defer("run__results", "run__discovery_checkpoint")
        )
