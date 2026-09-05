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

from .discovery_workflow import approve_url, release_case
from .models import SourceProposal, SourceProposalState
from .review_claims import SourceProposalReviewConflict
from .serializers import (
    OperatorSourceProposalSerializer,
    SourceProfileApprovalSerializer,
    SourceProfileDecisionSerializer,
    SourceProfileEditSerializer,
    SourceProfileRepairRequestSerializer,
    SourceProposalApprovalSerializer,
    SourceProposalDecisionSerializer,
    SourceProposalReviewClaimSerializer,
)
from .services import (
    claim_source_proposal_review,
    reject_source_proposal,
    request_source_proposal_changes,
)


class CanReviewSourceProposal(BasePermission):
    def has_permission(self, request: Request, view: APIView) -> bool:
        return has_capability(cast(User, request.user), OperatorCapability.REVIEW_SOURCE_PROPOSALS)


class CanReleaseSourceProposal(BasePermission):
    def has_permission(self, request: Request, view: APIView) -> bool:
        actor = cast(User, request.user)
        return has_capability(actor, OperatorCapability.MANAGE_OPERATOR_QUEUES) or has_capability(
            actor, OperatorCapability.REVIEW_SOURCE_PROPOSALS
        )


class OperatorSourceProposalListView(APIView):
    permission_classes = (CanReleaseSourceProposal,)

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


DecisionSerializer = type[
    SourceProposalDecisionSerializer
    | SourceProposalApprovalSerializer
    | SourceProfileEditSerializer
    | SourceProfileRepairRequestSerializer
]


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
        request=SourceProfileDecisionSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        return _decision_response(
            request=request,
            proposal_id=proposal_id,
            serializer_class=SourceProfileDecisionSerializer,
            transition=request_source_proposal_changes,
        )


class OperatorSourceProposalRejectView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Reject a Source Proposal",
        request=SourceProfileDecisionSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        return _decision_response(
            request=request,
            proposal_id=proposal_id,
            serializer_class=SourceProfileDecisionSerializer,
            transition=reject_source_proposal,
        )


class OperatorSourceProposalApproveView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Approve the URL and schedule Source Discovery",
        request=SourceProposalApprovalSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        return _decision_response(
            request=request,
            proposal_id=proposal_id,
            serializer_class=SourceProposalApprovalSerializer,
            transition=approve_url,
        )


class OperatorSourceProposalReleaseView(APIView):
    permission_classes = (CanReleaseSourceProposal,)

    @extend_schema(
        summary="Release abandoned Source Discovery and its Review Claim",
        request=SourceProposalDecisionSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        return _decision_response(
            request=request,
            proposal_id=proposal_id,
            serializer_class=SourceProposalDecisionSerializer,
            transition=release_case,
        )


class OperatorSourceProfileEditView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Propose a manually corrected Source Profile version",
        request=SourceProfileEditSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        from .profiles import edit_profile

        return _decision_response(
            request=request,
            proposal_id=proposal_id,
            serializer_class=SourceProfileEditSerializer,
            transition=edit_profile,
        )


class OperatorSourceProfileApproveView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Approve a validated Source Profile and assign its Source",
        request=SourceProfileApprovalSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        from .profiles import approve_profile

        return _decision_response(
            request=request,
            proposal_id=proposal_id,
            serializer_class=SourceProfileApprovalSerializer,
            transition=approve_profile,
        )


class OperatorSourceProfileRepairView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Explicitly repair selected Source Profile fields once",
        request=SourceProfileRepairRequestSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        from .profile_repair import repair_profile

        return _decision_response(
            request=request,
            proposal_id=proposal_id,
            serializer_class=SourceProfileRepairRequestSerializer,
            transition=repair_profile,
        )
