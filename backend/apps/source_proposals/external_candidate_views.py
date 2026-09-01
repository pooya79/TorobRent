from collections.abc import Callable
from typing import Any, cast

from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .models import ExternalListingCandidate, ExternalListingCandidateState
from .operator_views import CanReviewSourceProposal
from .serializers import (
    ExternalListingCandidateReviewClaimSerializer,
    ExternalListingCandidateSerializer,
    SourceProposalApprovalSerializer,
    SourceProposalDecisionSerializer,
)
from .services import (
    SourceProposalReviewConflict,
    approve_external_listing_candidate,
    claim_external_listing_candidate_review,
    reject_external_listing_candidate,
    request_external_listing_candidate_changes,
)


class OperatorExternalListingCandidateListView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="List pending simulated External Listing candidates",
        responses=ExternalListingCandidateSerializer(many=True),
    )
    def get(self, request: Request) -> Response:
        candidates = (
            ExternalListingCandidate.objects
            .filter(state=ExternalListingCandidateState.PENDING)
            .exclude(source_proposal__submitter=cast(User, request.user))
            .select_related("source", "source_proposal")
            .prefetch_related("events__actor")
        )
        return Response(ExternalListingCandidateSerializer(candidates, many=True).data)


def _workflow_error(exc: SourceProposalReviewConflict) -> Response:
    return Response({"code": exc.code, "detail": str(exc)}, status=status.HTTP_409_CONFLICT)


class OperatorExternalListingCandidateClaimView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Claim an External Listing candidate review",
        request=None,
        responses=ExternalListingCandidateReviewClaimSerializer,
    )
    def post(self, request: Request, candidate_id: str) -> Response:
        candidate = get_object_or_404(ExternalListingCandidate, id=candidate_id)
        try:
            claim = claim_external_listing_candidate_review(
                candidate=candidate, actor=cast(User, request.user)
            )
        except SourceProposalReviewConflict as exc:
            return _workflow_error(exc)
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages[0]) from None
        return Response(
            ExternalListingCandidateReviewClaimSerializer(claim).data,
            status=status.HTTP_201_CREATED,
        )


DecisionSerializer = type[SourceProposalDecisionSerializer | SourceProposalApprovalSerializer]


def _decision_response(
    *,
    request: Request,
    candidate_id: str,
    serializer_class: DecisionSerializer,
    transition: Callable[..., ExternalListingCandidate],
) -> Response:
    serializer = serializer_class(data=request.data)
    serializer.is_valid(raise_exception=True)
    candidate = get_object_or_404(ExternalListingCandidate, id=candidate_id)
    try:
        candidate = transition(
            candidate=candidate,
            actor=cast(User, request.user),
            **cast(dict[str, Any], serializer.validated_data),
        )
    except SourceProposalReviewConflict as exc:
        return _workflow_error(exc)
    except DjangoValidationError as exc:
        raise ValidationError(exc.messages[0]) from None
    return Response(ExternalListingCandidateSerializer(candidate).data)


class OperatorExternalListingCandidateRequestChangesView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Request changes to an External Listing candidate",
        request=SourceProposalDecisionSerializer,
        responses=ExternalListingCandidateSerializer,
    )
    def post(self, request: Request, candidate_id: str) -> Response:
        return _decision_response(
            request=request,
            candidate_id=candidate_id,
            serializer_class=SourceProposalDecisionSerializer,
            transition=request_external_listing_candidate_changes,
        )


class OperatorExternalListingCandidateRejectView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Reject an External Listing candidate",
        request=SourceProposalDecisionSerializer,
        responses=ExternalListingCandidateSerializer,
    )
    def post(self, request: Request, candidate_id: str) -> Response:
        return _decision_response(
            request=request,
            candidate_id=candidate_id,
            serializer_class=SourceProposalDecisionSerializer,
            transition=reject_external_listing_candidate,
        )


class OperatorExternalListingCandidateApproveView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Approve and publish an External Listing candidate",
        request=SourceProposalApprovalSerializer,
        responses=ExternalListingCandidateSerializer,
    )
    def post(self, request: Request, candidate_id: str) -> Response:
        return _decision_response(
            request=request,
            candidate_id=candidate_id,
            serializer_class=SourceProposalApprovalSerializer,
            transition=approve_external_listing_candidate,
        )
