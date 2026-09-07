from typing import cast

from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from . import bulk_actions
from .bulk_serializers import (
    SourceBulkApplyRequestSerializer,
    SourceBulkPreviewRequestSerializer,
    SourceBulkPreviewSerializer,
    SourceBulkResultSerializer,
)
from .operator_views import CanReviewSourceProposal
from .review_claims import SourceProposalReviewConflict


class SourceBulkPreviewView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Preview selected current Source results before a bulk action",
        request=SourceBulkPreviewRequestSerializer,
        responses=SourceBulkPreviewSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        serializer = SourceBulkPreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = bulk_actions.preview(
                proposal_id=proposal_id,
                actor=cast(User, request.user),
                **{
                    **serializer.validated_data,
                    "exception_ids": [str(pk) for pk in serializer.validated_data["exception_ids"]],
                },
            )
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages) from None
        return Response(SourceBulkPreviewSerializer(result).data)


class SourceBulkApplyView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Apply a confirmed, unchanged Source bulk preview once",
        request=SourceBulkApplyRequestSerializer,
        responses=SourceBulkResultSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        serializer = SourceBulkApplyRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = bulk_actions.apply(
                proposal_id=proposal_id, actor=cast(User, request.user), **serializer.validated_data
            )
        except SourceProposalReviewConflict as exc:
            return Response({"code": exc.code, "detail": str(exc)}, status=409)
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages) from None
        return Response(SourceBulkResultSerializer(result).data)
