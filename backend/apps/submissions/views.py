from collections.abc import AsyncIterator, Callable
from typing import cast

from asgiref.sync import sync_to_async
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import StreamingHttpResponse
from django.utils.dateparse import parse_datetime
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.catalog.models import Property

from .models import Submission, SubmissionImage, SubmissionImageVariant, SubmissionStep
from .serializers import (
    ReviewReasonSerializer,
    SubmissionApprovalSerializer,
    SubmissionCreateSerializer,
    SubmissionImageOrderSerializer,
    SubmissionImageSerializer,
    SubmissionImageUploadSerializer,
    SubmissionSerializer,
    SubmissionStepUpdateSerializer,
)
from .services import (
    add_submission_image_for_actor,
    approve_submission,
    reject_submission,
    remove_submission_image_for_actor,
    reorder_submission_images_for_actor,
    request_submission_changes,
    retry_submission_image_for_actor,
    save_submission_step_for_actor,
    submit_for_review,
)


class CanReviewSubmission(BasePermission):
    message = "مجوز بررسی Submission لازم است."

    def has_permission(self, request: Request, view: APIView) -> bool:
        return bool(
            request.user.is_staff and request.user.has_perm("submissions.review_submission")
        )


def validation_response(exc: DjangoValidationError) -> ValidationError:
    if hasattr(exc, "message_dict"):
        return ValidationError(exc.message_dict)
    return ValidationError(exc.messages[0])


class SubmissionListCreateView(APIView):
    @extend_schema(
        summary="List the current Submitter's Submissions",
        responses=SubmissionSerializer(many=True),
    )
    def get(self, request: Request) -> Response:
        user = cast(User, request.user)
        submissions = user.submissions.prefetch_related("images__variants__asset", "events__actor")
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
            submission = save_submission_step_for_actor(
                submission=submission,
                actor=cast(User, request.user),
                validated_data=serializer.validated_data,
            )
        except DjangoValidationError as exc:
            field = "images" if completed_step == SubmissionStep.IMAGES else "review"
            raise ValidationError({field: exc.messages[0]}) from None
        submission.refresh_from_db()
        return Response(SubmissionSerializer(submission).data)


class SubmissionSubmitView(APIView):
    @extend_schema(
        summary="Submit a complete revision for Operator review",
        request=None,
        responses=SubmissionSerializer,
    )
    def post(self, request: Request, submission_id: str) -> Response:
        submission = get_object_or_404(Submission, id=submission_id, submitter=request.user)
        try:
            submission = submit_for_review(submission=submission, actor=cast(User, request.user))
        except DjangoValidationError as exc:
            raise validation_response(exc) from None
        return Response(SubmissionSerializer(submission).data)


class OperatorSubmissionListView(APIView):
    permission_classes = (CanReviewSubmission,)

    @extend_schema(
        summary="List and filter the Operator review queue",
        parameters=[
            OpenApiParameter("state", str),
            OpenApiParameter("source", OpenApiTypes.UUID),
            OpenApiParameter("city", OpenApiTypes.UUID),
            OpenApiParameter("district", OpenApiTypes.UUID),
            OpenApiParameter("neighborhood", OpenApiTypes.UUID),
            OpenApiParameter("updated_after", OpenApiTypes.DATETIME),
            OpenApiParameter("updated_before", OpenApiTypes.DATETIME),
            OpenApiParameter("ordering", str, enum=["newest", "oldest"]),
        ],
        responses=SubmissionSerializer(many=True),
    )
    def get(self, request: Request) -> Response:
        submissions = Submission.objects.select_related(
            "submitter", "source", "city", "district", "neighborhood"
        ).prefetch_related("images__variants__asset", "events__actor")
        filters = {
            "state": "state",
            "source": "source_id",
            "city": "city_id",
            "district": "district_id",
            "neighborhood": "neighborhood_id",
        }
        for parameter, field in filters.items():
            if value := request.query_params.get(parameter):
                submissions = submissions.filter(**{field: value})
        if updated_after := request.query_params.get("updated_after"):
            parsed = parse_datetime(updated_after)
            if parsed is None:
                raise ValidationError({"updated_after": "زمان تازگی نامعتبر است."})
            submissions = submissions.filter(updated_at__gte=parsed)
        if updated_before := request.query_params.get("updated_before"):
            parsed = parse_datetime(updated_before)
            if parsed is None:
                raise ValidationError({"updated_before": "زمان تازگی نامعتبر است."})
            submissions = submissions.filter(updated_at__lte=parsed)
        ordering = (
            "updated_at" if request.query_params.get("ordering") == "oldest" else "-updated_at"
        )
        return Response(SubmissionSerializer(submissions.order_by(ordering), many=True).data)


ReviewDecision = Callable[..., Submission]


def review_reason_response(
    *, request: Request, submission_id: str, decision: ReviewDecision
) -> Response:
    serializer = ReviewReasonSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        submission = decision(
            submission=get_object_or_404(Submission, id=submission_id),
            actor=cast(User, request.user),
            reason=serializer.validated_data["reason"],
        )
    except DjangoValidationError as exc:
        raise validation_response(exc) from None
    return Response(SubmissionSerializer(submission).data)


class OperatorRequestChangesView(APIView):
    permission_classes = (CanReviewSubmission,)

    @extend_schema(
        summary="Request changes to a pending Submission",
        request=ReviewReasonSerializer,
        responses=SubmissionSerializer,
    )
    def post(self, request: Request, submission_id: str) -> Response:
        return review_reason_response(
            request=request,
            submission_id=submission_id,
            decision=request_submission_changes,
        )


class OperatorRejectView(APIView):
    permission_classes = (CanReviewSubmission,)

    @extend_schema(
        summary="Terminally reject a pending Submission",
        request=ReviewReasonSerializer,
        responses=SubmissionSerializer,
    )
    def post(self, request: Request, submission_id: str) -> Response:
        return review_reason_response(
            request=request,
            submission_id=submission_id,
            decision=reject_submission,
        )


class OperatorApproveView(APIView):
    permission_classes = (CanReviewSubmission,)

    @extend_schema(
        summary="Approve, group, and publish a pending Submission",
        request=SubmissionApprovalSerializer,
        responses=SubmissionSerializer,
    )
    def post(self, request: Request, submission_id: str) -> Response:
        serializer = SubmissionApprovalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            submission = approve_submission(
                submission=get_object_or_404(Submission, id=submission_id),
                actor=cast(User, request.user),
                **serializer.validated_data,
            )
        except Property.DoesNotExist:
            raise ValidationError({"property_id": "Property مقصد پیدا نشد."}) from None
        except DjangoValidationError as exc:
            raise validation_response(exc) from None
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
            image = add_submission_image_for_actor(
                submission=submission,
                actor=cast(User, request.user),
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
            images = reorder_submission_images_for_actor(
                submission=submission,
                actor=cast(User, request.user),
                **serializer.validated_data,
            )
        except DjangoValidationError as exc:
            raise ValidationError(exc.messages[0]) from None
        return Response(SubmissionImageSerializer(images, many=True).data)


class SubmissionImageDetailView(APIView):
    @extend_schema(summary="Remove an image from a Submission", responses={204: None})
    def delete(self, request: Request, submission_id: str, image_id: str) -> Response:
        submission = get_object_or_404(Submission, id=submission_id, submitter=request.user)
        get_object_or_404(SubmissionImage, id=image_id, submission=submission)
        try:
            remove_submission_image_for_actor(
                submission=submission,
                actor=cast(User, request.user),
                image_id=image_id,
            )
        except DjangoValidationError as exc:
            raise validation_response(exc) from None
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
            image = retry_submission_image_for_actor(
                image=image,
                actor=cast(User, request.user),
                upload=serializer.validated_data["file"],
            )
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
