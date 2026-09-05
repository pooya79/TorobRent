from typing import Any, cast

from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .extraction_serializers import ExtractionRunSerializer
from .models import ExtractionRun
from .operator_views import CanReviewSourceProposal
from .review_claims import SourceProposalReviewConflict
from .run_review import approve_run
from .serializers import SourceProposalApprovalSerializer


class OperatorRunApproveView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Approve all valid results of an Extraction Run",
        request=SourceProposalApprovalSerializer,
        responses=ExtractionRunSerializer,
    )
    def post(self, request: Request, proposal_id: str, run_id: str) -> Response:
        serializer = SourceProposalApprovalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        run = get_object_or_404(
            ExtractionRun, pk=run_id, request__assignment__proposal_id=proposal_id
        )
        try:
            run = approve_run(
                run=run,
                actor=cast(User, request.user),
                **cast(dict[str, Any], serializer.validated_data),
            )
        except SourceProposalReviewConflict as exc:
            return Response({"code": exc.code, "detail": str(exc)}, status=409)
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages) from None
        return Response(ExtractionRunSerializer(run).data)
