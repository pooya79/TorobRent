from typing import cast
from uuid import UUID

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.catalog.models import Source

from .exception_serializers import SourceExceptionRetrySerializer
from .exclusions import matching_exclusion
from .extraction import submit_request
from .extraction_serializers import ExtractionRequestSerializer
from .models import SourceAssignment, SourceExtractionException
from .operator_views import CanReviewSourceProposal
from .responsibility import require_source_responsibility


class SourceExceptionRetryView(APIView):
    operator = False

    @extend_schema(
        summary="Request bounded re-extraction of up to twenty affected pages",
        request=SourceExceptionRetrySerializer,
        responses={201: ExtractionRequestSerializer(many=True)},
    )
    @transaction.atomic
    def post(self, request: Request, proposal_id: str) -> Response:
        serializer = SourceExceptionRetrySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        assignments = SourceAssignment.objects.filter(
            proposal_id=UUID(str(proposal_id)), revoked_at__isnull=True
        )
        if not self.operator:
            assignments = assignments.filter(representative=cast(User, request.user))
        assignment = get_object_or_404(assignments)
        Source.objects.select_for_update().get(pk=assignment.source_id)
        if assignment.representative is None:
            raise ValidationError("نماینده فعال در دسترس نیست.")
        ids = set(serializer.validated_data["exception_ids"])
        exceptions = list(
            SourceExtractionException.objects.filter(source=assignment.source, pk__in=ids)
        )
        if len(exceptions) != len(ids):
            raise ValidationError("صفحه در این تخصیص در دسترس نیست.")
        try:
            if self.operator:
                require_source_responsibility(
                    proposal=assignment.proposal, actor=cast(User, request.user)
                )
            if any(
                matching_exclusion(assignment.source, item.canonical_url) for item in exceptions
            ):
                raise DjangoValidationError("ابتدا محدودیت صفحه را بردارید.")
            records = [
                submit_request(
                    assignment_id=assignment.pk,
                    proposal_id=proposal_id,
                    actor=assignment.representative,
                    url=item.canonical_url,
                    initiated_by=cast(User, request.user),
                )
                for item in exceptions
            ]
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages) from None
        return Response(ExtractionRequestSerializer(records, many=True).data, status=201)


class OperatorSourceExceptionRetryView(SourceExceptionRetryView):
    permission_classes = (CanReviewSourceProposal,)
    operator = True
