from collections.abc import Callable
from typing import Any, cast

from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .exclusion_serializers import (
    SourceExclusionAddSerializer,
    SourceExclusionChangeSerializer,
    SourceExclusionPreviewRequestSerializer,
    SourceExclusionPreviewSerializer,
    SourceExclusionWithdrawSerializer,
)
from .exclusions import (
    add_exclusion,
    preview_exclusion,
    remove_exclusion,
    withdraw_excluded_listings,
)
from .models import SourceProposal
from .operator_views import CanReviewSourceProposal
from .serializers import OperatorSourceProposalSerializer


class OperatorExclusionPreviewView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Preview known pages and Listings matching a Source Exclusion",
        request=SourceExclusionPreviewRequestSerializer,
        responses=SourceExclusionPreviewSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        serializer = SourceExclusionPreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = preview_exclusion(
                proposal=get_object_or_404(SourceProposal, pk=proposal_id),
                actor=cast(User, request.user),
                **serializer.validated_data,
            )
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages) from None
        return Response(SourceExclusionPreviewSerializer(result).data)


class OperatorExclusionAddView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Add a confirmed Source Exclusion",
        request=SourceExclusionAddSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        return exclusion_transition(
            request, proposal_id, SourceExclusionAddSerializer, add_exclusion
        )


class OperatorExclusionRemoveView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Remove a Source Exclusion without publishing held candidates",
        request=SourceExclusionChangeSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        return exclusion_transition(
            request, proposal_id, SourceExclusionChangeSerializer, remove_exclusion
        )


def exclusion_transition(
    request: Request,
    proposal_id: str,
    serializer_class: type[serializers.Serializer[Any]],
    transition: Callable[..., SourceProposal],
) -> Response:
    serializer = serializer_class(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        proposal = transition(
            proposal=get_object_or_404(SourceProposal, pk=proposal_id),
            actor=cast(User, request.user),
            **serializer.validated_data,
        )
    except DjangoValidationError as exc:
        raise ValidationError(exc.messages) from None
    return Response(OperatorSourceProposalSerializer(proposal, context={"request": request}).data)


class OperatorExclusionWithdrawView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Explicitly withdraw reviewed Listings matching an active exclusion",
        request=SourceExclusionWithdrawSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        return exclusion_transition(
            request, proposal_id, SourceExclusionWithdrawSerializer, withdraw_excluded_listings
        )
