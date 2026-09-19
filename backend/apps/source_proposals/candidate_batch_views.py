from typing import Any, cast

from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .candidate_batch import decide_batch
from .operator_views import CanReviewSourceProposal
from .review_claims import SourceProposalReviewConflict


class CandidateBatchItemSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    reviewed_revision = serializers.IntegerField(min_value=1)


class CandidateBatchRequestSerializer(serializers.Serializer[Any]):
    items = CandidateBatchItemSerializer(many=True, allow_empty=False)
    action = serializers.ChoiceField(choices=["approve", "reject"])
    reason = serializers.CharField(max_length=5000, required=False, default="", allow_blank=True)
    confirmed = serializers.BooleanField(required=False, default=False)


class CandidateBatchFailureSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    detail = serializers.CharField()


class CandidateBatchResultSerializer(serializers.Serializer[Any]):
    succeeded = serializers.ListField(child=serializers.UUIDField())
    failed = CandidateBatchFailureSerializer(many=True)


class OperatorCandidateBatchView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Review selected ads with one summary per requester",
        request=CandidateBatchRequestSerializer,
        responses=CandidateBatchResultSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        serializer = CandidateBatchRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = decide_batch(
                proposal_id=proposal_id, actor=cast(User, request.user), **serializer.validated_data
            )
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages) from None
        except SourceProposalReviewConflict as exc:
            return Response({"code": exc.code, "detail": str(exc)}, status=409)
        return Response(CandidateBatchResultSerializer(result).data)
