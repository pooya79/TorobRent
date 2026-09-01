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
    SourceProposalCreateSerializer,
    SourceProposalDetailsSerializer,
    SourceProposalDraftSerializer,
    SourceProposalSerializer,
    SourceProposalSubmitSerializer,
)
from .services import (
    SourceProposalAccessDenied,
    generate_simulated_preview,
    resume_or_create_source_proposal,
    save_source_proposal_details,
    save_source_proposal_draft,
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
        summary="Create or resume a Source Proposal draft",
        request=SourceProposalCreateSerializer,
        responses={200: SourceProposalSerializer, 201: SourceProposalSerializer},
    )
    def post(self, request: Request) -> Response:
        serializer = SourceProposalCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            proposal, created = resume_or_create_source_proposal(
                submitter=cast(User, request.user),
                start_new=serializer.validated_data["start_new"],
            )
        except SourceProposalAccessDenied as exc:
            raise PermissionDenied(str(exc)) from None
        return Response(
            SourceProposalSerializer(proposal).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class SourceProposalDetailView(APIView):
    def get_object(self, request: Request, proposal_id: str) -> SourceProposal:
        return get_object_or_404(SourceProposal, id=proposal_id, submitter=request.user)

    @extend_schema(summary="Resume a Source Proposal", responses=SourceProposalSerializer)
    def get(self, request: Request, proposal_id: str) -> Response:
        return Response(SourceProposalSerializer(self.get_object(request, proposal_id)).data)

    @extend_schema(
        summary="Save Source Proposal website and authority details",
        request=SourceProposalDetailsSerializer,
        responses=SourceProposalSerializer,
    )
    def patch(self, request: Request, proposal_id: str) -> Response:
        serializer = SourceProposalDetailsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            proposal = save_source_proposal_details(
                proposal=self.get_object(request, proposal_id),
                actor=cast(User, request.user),
                validated_data=serializer.validated_data,
            )
        except SourceProposalAccessDenied as exc:
            raise PermissionDenied(str(exc)) from None
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages[0]) from None
        return Response(SourceProposalSerializer(proposal).data)


class SourceProposalPreviewView(APIView):
    @extend_schema(
        summary="Generate the deterministic simulated Source Proposal preview",
        request=None,
        responses=SourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        proposal = get_object_or_404(SourceProposal, id=proposal_id, submitter=request.user)
        try:
            proposal = generate_simulated_preview(proposal=proposal, actor=cast(User, request.user))
        except SourceProposalAccessDenied as exc:
            raise PermissionDenied(str(exc)) from None
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages[0]) from None
        return Response(SourceProposalSerializer(proposal).data)


class SourceProposalDraftView(APIView):
    @extend_schema(
        summary="Autosave Source Proposal draft fields",
        request=SourceProposalDraftSerializer,
        responses=SourceProposalSerializer,
    )
    def patch(self, request: Request, proposal_id: str) -> Response:
        serializer = SourceProposalDraftSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = get_object_or_404(SourceProposal, id=proposal_id, submitter=request.user)
        try:
            proposal = save_source_proposal_draft(
                proposal=proposal,
                actor=cast(User, request.user),
                validated_data=serializer.validated_data,
            )
        except SourceProposalAccessDenied as exc:
            raise PermissionDenied(str(exc)) from None
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages[0]) from None
        return Response(SourceProposalSerializer(proposal).data)


class SourceProposalSubmitView(APIView):
    @extend_schema(
        summary="Confirm the simulated preview and submit for Operator review",
        request=SourceProposalSubmitSerializer,
        responses=SourceProposalSerializer,
    )
    def post(self, request: Request, proposal_id: str) -> Response:
        serializer = SourceProposalSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = get_object_or_404(SourceProposal, id=proposal_id, submitter=request.user)
        try:
            proposal = submit_source_proposal(proposal=proposal, actor=cast(User, request.user))
        except SourceProposalAccessDenied as exc:
            raise PermissionDenied(str(exc)) from None
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages[0]) from None
        return Response(SourceProposalSerializer(proposal).data)
