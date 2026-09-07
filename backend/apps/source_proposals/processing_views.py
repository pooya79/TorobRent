from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .operator_views import CanReviewSourceProposal, _decision_response
from .processing import change_processing
from .serializers import OperatorSourceProposalSerializer, SourceProcessingRequestSerializer


class OperatorSourceProcessingView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Pause or resume Source processing independently of its Assignment",
        request=SourceProcessingRequestSerializer,
        responses=OperatorSourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        return _decision_response(
            request=request,
            proposal_id=proposal_id,
            serializer_class=SourceProcessingRequestSerializer,
            transition=change_processing,
        )
