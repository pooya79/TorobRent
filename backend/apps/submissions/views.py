from typing import cast

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.generics import get_object_or_404
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .models import Submission
from .serializers import (
    SubmissionCreateSerializer,
    SubmissionSerializer,
    SubmissionStepUpdateSerializer,
)


class SubmissionListCreateView(APIView):
    @extend_schema(
        summary="List the current Submitter's Submissions",
        responses=SubmissionSerializer(many=True),
    )
    def get(self, request: Request) -> Response:
        user = cast(User, request.user)
        submissions = user.submissions.all()
        return Response(SubmissionSerializer(submissions, many=True).data)

    @extend_schema(
        summary="Create a Submission draft",
        request=SubmissionCreateSerializer,
        responses={201: SubmissionSerializer},
    )
    def post(self, request: Request) -> Response:
        user = cast(User, request.user)
        if not user.email_verified:
            raise PermissionDenied("برای ثبت پیش‌نویس ابتدا ایمیل خود را تأیید کنید.")
        serializer = SubmissionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        submission = serializer.save(submitter=user)
        return Response(SubmissionSerializer(submission).data, status=status.HTTP_201_CREATED)


class SubmissionDetailView(APIView):
    def get_object(self, request: Request, submission_id: str) -> Submission:
        return get_object_or_404(
            Submission.objects.select_related("city", "district", "neighborhood"),
            id=submission_id,
            submitter=request.user,
        )

    @extend_schema(summary="Resume a Submission draft", responses=SubmissionSerializer)
    def get(self, request: Request, submission_id: str) -> Response:
        return Response(SubmissionSerializer(self.get_object(request, submission_id)).data)

    @extend_schema(
        summary="Save a completed Submission step",
        request=SubmissionStepUpdateSerializer,
        responses=SubmissionSerializer,
    )
    def patch(self, request: Request, submission_id: str) -> Response:
        submission = self.get_object(request, submission_id)
        serializer = SubmissionStepUpdateSerializer(
            submission,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        submission.refresh_from_db()
        return Response(SubmissionSerializer(submission).data)
