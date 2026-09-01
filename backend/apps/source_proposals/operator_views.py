from collections.abc import Callable
from typing import Any, cast

from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User

from .models import SourceProposal, SourceProposalState
from .serializers import (
    OperatorSourceProposalSerializer,
    SourceProposalApprovalSerializer,
    SourceProposalDecisionSerializer,
    SourceProposalReviewClaimSerializer,
)
from .services import (
    SourceProposalReviewConflict,
    approve_source_proposal,
    claim_source_proposal_review,
    reject_source_proposal,
    request_source_proposal_changes,
)


class CanReviewSourceProposal(BasePermission):
    def has_permission(self, request: Request, view: APIView) -> bool:
        return has_capability(cast(User, request.user), OperatorCapability.REVIEW_SOURCE_PROPOSALS)


class OperatorSourceProposalListView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="List pending Source Proposals for Operator review",
        responses=OperatorSourceProposalSerializer(many=True),
    )
    def get(self, request: Request) -> Response:
        proposals = (
            SourceProposal.objects
            .filter(state=SourceProposalState.PENDING)
            .exclude(submitter=cast(User, request.user))
            .prefetch_related("events__actor")
        )
        return Response(OperatorSourceProposalSerializer(proposals, many=True).data)


def _workflow_error(exc: SourceProposalReviewConflict) -> Response:
    return Response({"code": exc.code, "detail": str(exc)}, status=status.HTTP_409_CONFLICT)


DecisionSerializer = type[SourceProposalDecisionSerializer | SourceProposalApprovalSerializer]


def _decision_response(
    *,
    request: Request,
    proposal_id: str,
    serializer_class: DecisionSerializer,
    transition: Callable[..., SourceProposal],
) -> Response:
    serializer = serializer_class(data=request.data)
    serializer.is_valid(raise_exception=True)
    proposal = get_object_or_404(SourceProposal, id=proposal_id)
    try:
        proposal = transition(
            proposal=proposal,
            actor=cast(User, request.user),
            **cast(dict[str, Any], serializer.validated_data),
        )
    except SourceProposalReviewConflict as exc:
        return _workflow_error(exc)
    except DjangoValidationError as exc:
        raise ValidationError(exc.messages[0]) from None
    return Response(OperatorSourceProposalSerializer(proposal).data)


class OperatorSourceProposalClaimView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Claim a Source Proposal review",
        request=None,
        responses=SourceProposalReviewClaimSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        proposal = get_object_or_404(SourceProposal, id=proposal_id)
        try:
            claim = claim_source_proposal_review(proposal=proposal, actor=cast(User, request.user))
        except SourceProposalReviewConflict as exc:
            return _workflow_error(exc)
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages[0]) from None
        return Response(
            SourceProposalReviewClaimSerializer(claim).data,
            status=status.HTTP_201_CREATED,
        )


class OperatorSourceProposalRequestChangesView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Request changes to a Source Proposal",
        request=SourceProposalDecisionSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        return _decision_response(
            request=request,
            proposal_id=proposal_id,
            serializer_class=SourceProposalDecisionSerializer,
            transition=request_source_proposal_changes,
        )


class OperatorSourceProposalRejectView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Reject a Source Proposal",
        request=SourceProposalDecisionSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        return _decision_response(
            request=request,
            proposal_id=proposal_id,
            serializer_class=SourceProposalDecisionSerializer,
            transition=reject_source_proposal,
        )


class OperatorSourceProposalApproveView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Approve and validate a Source",
        request=SourceProposalApprovalSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        return _decision_response(
            request=request,
            proposal_id=proposal_id,
            serializer_class=SourceProposalApprovalSerializer,
            transition=approve_source_proposal,
        )
