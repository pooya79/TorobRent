from collections.abc import AsyncIterator
from typing import cast

from asgiref.sync import sync_to_async
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import StreamingHttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .models import Submission, SubmissionImage, SubmissionImageVariant, SubmissionStep
from .serializers import (
    SubmissionCreateSerializer,
    SubmissionImageOrderSerializer,
    SubmissionImageSerializer,
    SubmissionImageUploadSerializer,
    SubmissionSerializer,
    SubmissionStepUpdateSerializer,
)
from .services import (
    add_submission_image,
    complete_submission_media_step,
    ensure_submission_media_complete,
    remove_submission_image,
    reorder_submission_images,
    retry_submission_image,
)


class SubmissionListCreateView(APIView):
    @extend_schema(
        summary="List the current Submitter's Submissions",
        responses=SubmissionSerializer(many=True),
    )
    def get(self, request: Request) -> Response:
        user = cast(User, request.user)
        submissions = user.submissions.prefetch_related("images__variants__asset")
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
            Submission.objects.select_related("city", "district", "neighborhood").prefetch_related(
                "images__variants__asset"
            ),
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
        completed_step = serializer.validated_data["completed_step"]
        try:
            if completed_step == SubmissionStep.IMAGES:
                complete_submission_media_step(submission=submission)
            else:
                if completed_step == SubmissionStep.REVIEW:
                    ensure_submission_media_complete(submission=submission)
                serializer.save()
        except DjangoValidationError as exc:
            field = "images" if completed_step == SubmissionStep.IMAGES else "review"
            raise ValidationError({field: exc.messages[0]}) from None
        submission.refresh_from_db()
        return Response(SubmissionSerializer(submission).data)


class SubmissionImageListCreateView(APIView):
    parser_classes = (MultiPartParser, JSONParser)

    @extend_schema(
        summary="Upload an image to a Submission draft",
        request=SubmissionImageUploadSerializer,
        responses={201: SubmissionImageSerializer},
    )
    def post(self, request: Request, submission_id: str) -> Response:
        submission = get_object_or_404(Submission, id=submission_id, submitter=request.user)
        serializer = SubmissionImageUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            image = add_submission_image(
                submission=submission,
                upload=serializer.validated_data["file"],
            )
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages[0]) from None
        image.refresh_from_db()
        return Response(SubmissionImageSerializer(image).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Reorder a Submission's images and choose its primary image",
        request=SubmissionImageOrderSerializer,
        responses=SubmissionImageSerializer(many=True),
    )
    def patch(self, request: Request, submission_id: str) -> Response:
        submission = get_object_or_404(Submission, id=submission_id, submitter=request.user)
        serializer = SubmissionImageOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            images = reorder_submission_images(submission=submission, **serializer.validated_data)
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages[0]) from None
        return Response(SubmissionImageSerializer(images, many=True).data)


class SubmissionImageDetailView(APIView):
    @extend_schema(summary="Remove an image from a Submission", responses={204: None})
    def delete(self, request: Request, submission_id: str, image_id: str) -> Response:
        submission = get_object_or_404(Submission, id=submission_id, submitter=request.user)
        get_object_or_404(SubmissionImage, id=image_id, submission=submission)
        remove_submission_image(submission=submission, image_id=image_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SubmissionImageRetryView(APIView):
    parser_classes = (MultiPartParser,)

    @extend_schema(
        summary="Replace and retry a failed Submission image",
        request=SubmissionImageUploadSerializer,
        responses=SubmissionImageSerializer,
    )
    def post(self, request: Request, submission_id: str, image_id: str) -> Response:
        image = get_object_or_404(
            SubmissionImage,
            id=image_id,
            submission_id=submission_id,
            submission__submitter=request.user,
        )
        serializer = SubmissionImageUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            image = retry_submission_image(image=image, upload=serializer.validated_data["file"])
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages[0]) from None
        image.refresh_from_db()
        return Response(SubmissionImageSerializer(image).data)


class SubmissionImageContentView(APIView):
    @extend_schema(
        summary="Read a protected processed Submission image",
        responses={(200, "image/webp"): OpenApiTypes.BINARY},
    )
    def get(
        self,
        request: Request,
        submission_id: str,
        image_id: str,
        kind: str,
    ) -> StreamingHttpResponse:
        user = cast(User, request.user)
        ownership = {"image__submission__submitter": user} if not user.is_staff else {}
        variant = get_object_or_404(
            SubmissionImageVariant,
            image__submission_id=submission_id,
            image_id=image_id,
            kind=kind,
            **ownership,
        )

        async def stream_variant() -> AsyncIterator[bytes]:
            processed = await sync_to_async(variant.file.open)("rb")
            try:
                while chunk := await sync_to_async(processed.read)(64 * 1024):
                    yield chunk
            finally:
                await sync_to_async(processed.close)()

        response = StreamingHttpResponse(stream_variant(), content_type="image/webp")
        response["Cache-Control"] = "private, max-age=300"
        response["X-Content-Type-Options"] = "nosniff"
        return response
