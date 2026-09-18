from typing import cast

from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .models import SourceProposal
from .serializers import (
    CurrentWebsiteConflictSerializer,
    SourceProposalDetailsSerializer,
    SourceProposalSerializer,
)
from .services import (
    CurrentWebsiteExists,
    SourceProposalAccessDenied,
    delete_source_proposal_draft,
    submit_source_proposal,
)


class SourceProposalListCreateView(APIView):
    @extend_schema(
        summary="List the current Submitter's Source Proposals",
        responses=SourceProposalSerializer(many=True),
    )
    def get(self, request: Request) -> Response:
        proposals = SourceProposal.objects.filter(
            submitter=cast(User, request.user)
        ).prefetch_related("events__actor")
        return Response(SourceProposalSerializer(proposals, many=True).data)

    @extend_schema(
        summary="Submit a complete website for Operator review",
        request=SourceProposalDetailsSerializer,
        responses={
            201: SourceProposalSerializer,
            409: CurrentWebsiteConflictSerializer,
        },
    )
    def post(self, request: Request) -> Response:
        serializer = SourceProposalDetailsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            proposal = submit_source_proposal(
                actor=cast(User, request.user),
                validated_data=serializer.validated_data,
            )
        except SourceProposalAccessDenied as exc:
            raise PermissionDenied(str(exc)) from None
        except CurrentWebsiteExists as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages[0]) from None
        return Response(
            SourceProposalSerializer(proposal).data,
            status=status.HTTP_201_CREATED,
        )


class SourceProposalDetailView(APIView):
    def get_object(self, request: Request, proposal_id: str) -> SourceProposal:
        return get_object_or_404(
            SourceProposal,
            id=proposal_id,
            submitter=request.user,
        )

    @extend_schema(summary="Read a Source Proposal", responses=SourceProposalSerializer)
    def get(self, request: Request, proposal_id: str) -> Response:
        return Response(SourceProposalSerializer(self.get_object(request, proposal_id)).data)

    @extend_schema(
        summary="Discard an unsubmitted or changes-requested Source Proposal",
        request=None,
        responses={204: None},
    )
    def delete(self, request: Request, proposal_id: str) -> Response:
        try:
            delete_source_proposal_draft(
                proposal=self.get_object(request, proposal_id),
                actor=cast(User, request.user),
            )
        except SourceProposalAccessDenied as exc:
            raise PermissionDenied(str(exc)) from None
        return Response(status=status.HTTP_204_NO_CONTENT)


class SourceProposalSubmitView(APIView):
    @extend_schema(
        summary="Submit complete website corrections for Operator review",
        request=SourceProposalDetailsSerializer,
        responses=SourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        serializer = SourceProposalDetailsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = get_object_or_404(
            SourceProposal,
            id=proposal_id,
            discarded_at__isnull=True,
            submitter=request.user,
        )
        try:
            proposal = submit_source_proposal(
                proposal=proposal,
                actor=cast(User, request.user),
                validated_data=serializer.validated_data,
            )
        except SourceProposalAccessDenied as exc:
            raise PermissionDenied(str(exc)) from None
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages[0]) from None
        return Response(SourceProposalSerializer(proposal).data)


class ExtractionRequestCreateView(APIView):
    from .extraction_serializers import ExtractionRequestSerializer, ExtractionSubmitSerializer

    @extend_schema(
        summary="Submit an Extraction Request under an active assignment",
        request=ExtractionSubmitSerializer,
        responses={201: ExtractionRequestSerializer},
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        from .extraction_serializers import ExtractionRequestSerializer, ExtractionSubmitSerializer
        from .models import SourceAssignment
        from .source_processing.extraction import submit_request

        serializer = ExtractionSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        get_object_or_404(
            SourceAssignment,
            pk=serializer.validated_data["assignment"],
            proposal_id=proposal_id,
            representative=request.user,
        )
        try:
            record = submit_request(
                assignment_id=serializer.validated_data["assignment"],
                proposal_id=proposal_id,
                actor=cast(User, request.user),
                url=serializer.validated_data["url"],
            )
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages[0]) from None
        return Response(ExtractionRequestSerializer(record).data, status=201)
