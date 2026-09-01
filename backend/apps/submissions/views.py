from collections.abc import AsyncIterator, Callable
from datetime import timedelta
from typing import cast
from uuid import UUID

from asgiref.sync import sync_to_async
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import F, Prefetch, Q, QuerySet
from django.http import StreamingHttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied, Throttled, ValidationError
from rest_framework.generics import ListAPIView, get_object_or_404
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User
from apps.catalog.models import Listing, Property
from apps.catalog.services import (
    archive_listing,
    confirm_listing_availability,
    mark_listing_unavailable,
)
from apps.common.pagination import StandardPageNumberPagination
from apps.common.serializers import ProblemSerializer

from .models import ReviewClaim, Submission, SubmissionImage, SubmissionImageVariant, SubmissionStep
from .selectors import submission_workload_summary, submissions_reviewable_by
from .serializers import (
    ForceReleaseReviewClaimSerializer,
    OperatorSubmissionQueueSerializer,
    ReviewClaimSerializer,
    ReviewReasonSerializer,
    SubmissionApprovalSerializer,
    SubmissionContactOtpResponseSerializer,
    SubmissionContactVerificationRequestSerializer,
    SubmissionContactVerificationSerializer,
    SubmissionCreateSerializer,
    SubmissionImageOrderSerializer,
    SubmissionImageSerializer,
    SubmissionImageUploadSerializer,
    SubmissionSerializer,
    SubmissionStepUpdateSerializer,
    SubmissionWorkloadSummarySerializer,
)
from .services import (
    ContactVerificationCooldown,
    ContactVerificationResult,
    ReviewWorkflowConflict,
    SubmissionAccessDenied,
    add_submission_image_for_actor,
    approve_submission,
    claim_submission_review,
    create_or_resume_submission_draft,
    force_release_submission_review_claim,
    reject_submission,
    release_submission_review_claim,
    release_unavailable_review_claims,
    remove_submission_image_for_actor,
    renew_submission_review_claim,
    reorder_submission_images_for_actor,
    request_submission_changes,
    request_submission_contact_verification,
    retry_submission_decision_notification,
    retry_submission_image_for_actor,
    save_submission_step_for_actor,
    submit_for_review,
    verify_submission_contact,
)


class CanReviewSubmission(BasePermission):
    message = "مجوز بررسی Submission لازم است."

    def has_permission(self, request: Request, view: APIView) -> bool:
        return has_capability(
            cast(User, request.user),
            OperatorCapability.REVIEW_SUBMISSIONS,
        )


class CanManageSubmissionQueue(BasePermission):
    message = "مجوز مدیریت صف اپراتور لازم است."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = cast(User, request.user)
        return has_capability(user, OperatorCapability.REVIEW_SUBMISSIONS) and has_capability(
            user, OperatorCapability.MANAGE_OPERATOR_QUEUES
        )


class ReviewConflict(APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, conflict: ReviewWorkflowConflict) -> None:
        self.default_code = conflict.code
        super().__init__(str(conflict), code=conflict.code)


REVIEW_CONFLICT_RESPONSE = OpenApiResponse(
    response=ProblemSerializer,
    description="The Review Claim, reviewed revision, or decision state is no longer current.",
)
PROBLEM_MEDIA_TYPE = "application/problem+json"
THROTTLED_RESPONSE = OpenApiResponse(
    response=ProblemSerializer,
    description="OTP resend cooldown or endpoint request limit was reached.",
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
        submissions = user.submissions.select_related("listing").prefetch_related(
            "images__variants__asset", "events__actor", "events__notification"
        )
        return Response(SubmissionSerializer(submissions, many=True).data)

    @extend_schema(
        summary="Create or resume a Submission draft for the selected relationship",
        request=SubmissionCreateSerializer,
        responses={200: SubmissionSerializer, 201: SubmissionSerializer},
    )
    def post(self, request: Request) -> Response:
        user = cast(User, request.user)
        serializer = SubmissionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            submission, created = create_or_resume_submission_draft(
                submitter=user,
                role=serializer.validated_data["role"],
                resume_existing=serializer.validated_data["resume_existing"],
            )
        except SubmissionAccessDenied as exc:
            raise PermissionDenied(str(exc)) from None
        response_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(SubmissionSerializer(submission).data, status=response_status)


class SubmissionDetailView(APIView):
    def get_object(self, request: Request, submission_id: str) -> Submission:
        return get_object_or_404(
            Submission.objects.select_related("city", "district", "neighborhood").prefetch_related(
                "images__variants__asset", "events__notification"
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
            context={"request": request},
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


class SubmissionContactVerificationRequestView(APIView):
    throttle_scope = "phone_verification_request"

    @extend_schema(
        summary="Send an OTP for an alternate Submission contact phone",
        request=SubmissionContactVerificationRequestSerializer,
        responses={
            202: SubmissionContactOtpResponseSerializer,
            (429, PROBLEM_MEDIA_TYPE): THROTTLED_RESPONSE,
        },
    )
    def post(self, request: Request, submission_id: str) -> Response:
        submission = get_object_or_404(Submission, id=submission_id, submitter=request.user)
        serializer = SubmissionContactVerificationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            otp = request_submission_contact_verification(
                submission=submission,
                actor=cast(User, request.user),
                phone=serializer.validated_data["phone"],
            )
        except ContactVerificationCooldown as exc:
            raise Throttled(
                wait=exc.wait_seconds,
                detail="برای ارسال دوباره کد باید ۶۰ ثانیه صبر کنید.",
            ) from None
        except DjangoValidationError as exc:
            raise validation_response(exc) from None
        data = {"detail": "اگر شماره قابل تأیید باشد، کد تأیید ارسال می‌شود."}
        if settings.DEMO_OTP_DISCLOSURE and otp is not None:
            data["demo_otp"] = otp
        return Response(data, status=status.HTTP_202_ACCEPTED)


class SubmissionContactVerificationView(APIView):
    throttle_scope = "phone_verification"

    @extend_schema(
        summary="Verify the selected alternate Submission contact phone",
        request=SubmissionContactVerificationSerializer,
        responses={
            200: SubmissionSerializer,
            (429, PROBLEM_MEDIA_TYPE): THROTTLED_RESPONSE,
        },
    )
    def post(self, request: Request, submission_id: str) -> Response:
        submission = get_object_or_404(
            Submission.objects.select_related("submitter"),
            id=submission_id,
            submitter=request.user,
        )
        serializer = SubmissionContactVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = verify_submission_contact(
            submission=submission,
            actor=cast(User, request.user),
            otp=serializer.validated_data["otp"],
        )
        if result != ContactVerificationResult.SUCCESS:
            raise ValidationError({"otp": "کد تأیید پذیرفته نشد. کد تازه‌ای درخواست کنید."})
        submission.refresh_from_db()
        return Response(SubmissionSerializer(submission).data)


class SubmissionConfirmAvailabilityView(APIView):
    @extend_schema(
        summary="Confirm that a published Listing remains available",
        request=None,
        responses=SubmissionSerializer,
    )
    def post(self, request: Request, submission_id: str) -> Response:
        submission = get_object_or_404(
            Submission.objects.select_related("listing"),
            id=submission_id,
            submitter=request.user,
            listing__isnull=False,
        )
        assert submission.listing is not None
        try:
            confirm_listing_availability(submission.listing)
        except DjangoValidationError as exc:
            raise validation_response(exc) from None
        submission.refresh_from_db()
        return Response(SubmissionSerializer(submission).data)


ListingAvailabilityTransition = Callable[[Listing], Listing]


def change_listing_availability(
    *, request: Request, submission_id: str, transition: ListingAvailabilityTransition
) -> Response:
    submission = get_object_or_404(
        Submission.objects.select_related("listing"),
        id=submission_id,
        submitter=request.user,
        listing__isnull=False,
    )
    assert submission.listing is not None
    try:
        transition(submission.listing)
    except DjangoValidationError as exc:
        raise validation_response(exc) from None
    submission.refresh_from_db()
    return Response(SubmissionSerializer(submission).data)


class SubmissionMarkUnavailableView(APIView):
    @extend_schema(
        summary="Mark a published Listing unavailable", request=None, responses=SubmissionSerializer
    )
    def post(self, request: Request, submission_id: str) -> Response:
        return change_listing_availability(
            request=request,
            submission_id=submission_id,
            transition=mark_listing_unavailable,
        )


class SubmissionArchiveView(APIView):
    @extend_schema(summary="Archive a Listing", request=None, responses=SubmissionSerializer)
    def post(self, request: Request, submission_id: str) -> Response:
        return change_listing_availability(
            request=request,
            submission_id=submission_id,
            transition=archive_listing,
        )


class OperatorSubmissionPagination(StandardPageNumberPagination):
    page_size = 50
    max_page_size = 100


def operator_submission_queryset(*, operator: User) -> QuerySet[Submission]:
    release_unavailable_review_claims()
    return (
        submissions_reviewable_by(operator=operator)
        .select_related("submitter", "source", "city", "district", "neighborhood", "listing")
        .prefetch_related(
            "images__variants__asset",
            "events__actor",
            "events__notification",
            Prefetch(
                "review_claims",
                queryset=ReviewClaim.objects.filter(
                    released_at__isnull=True,
                    expires_at__gt=timezone.now(),
                ).select_related("operator"),
                to_attr="open_review_claims",
            ),
        )
    )


class OperatorSubmissionListView(ListAPIView[Submission]):
    permission_classes = (CanReviewSubmission,)
    serializer_class = OperatorSubmissionQueueSerializer
    pagination_class = OperatorSubmissionPagination

    @extend_schema(
        summary="List and filter the Operator review queue",
        parameters=[
            OpenApiParameter("state", str),
            OpenApiParameter("source", OpenApiTypes.UUID),
            OpenApiParameter("city", OpenApiTypes.UUID),
            OpenApiParameter("district", OpenApiTypes.UUID),
            OpenApiParameter("neighborhood", OpenApiTypes.UUID),
            OpenApiParameter("pending_after", OpenApiTypes.DATETIME),
            OpenApiParameter("pending_before", OpenApiTypes.DATETIME),
            OpenApiParameter("age_days", int),
            OpenApiParameter("assignee", str),
            OpenApiParameter("ordering", str, enum=["newest", "oldest"]),
        ],
        responses=OperatorSubmissionQueueSerializer(many=True),
    )
    def get(self, request: Request, *args: object, **kwargs: object) -> Response:
        return self.list(request, *args, **kwargs)

    def get_queryset(self) -> QuerySet[Submission]:
        request = self.request
        operator = cast(User, request.user)
        submissions = operator_submission_queryset(operator=operator)
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
        for parameter, lookup in (
            ("pending_after", "pending_since__gte"),
            ("pending_before", "pending_since__lte"),
        ):
            value = request.query_params.get(parameter)
            if not value:
                continue
            parsed = parse_datetime(value)
            if parsed is None:
                raise ValidationError({parameter: "زمان دوره انتظار نامعتبر است."})
            submissions = submissions.filter(**{lookup: parsed})
        if age_days := request.query_params.get("age_days"):
            try:
                days = int(age_days)
                if days < 0:
                    raise ValueError
            except ValueError:
                raise ValidationError({"age_days": "سن صف باید تعداد روز نامنفی باشد."}) from None
            submissions = submissions.filter(
                pending_since__lte=timezone.now() - timedelta(days=days)
            )
        active_claim = Q(
            review_claims__released_at__isnull=True,
            review_claims__revision=F("revision"),
            review_claims__expires_at__gt=timezone.now(),
        )
        if assignee := request.query_params.get("assignee"):
            if assignee == "unclaimed":
                submissions = submissions.exclude(active_claim)
            elif assignee == "mine":
                submissions = submissions.filter(active_claim, review_claims__operator=operator)
            elif assignee == "claimed":
                submissions = submissions.filter(active_claim)
            elif assignee == "other":
                submissions = submissions.filter(active_claim).exclude(
                    review_claims__operator=operator
                )
            else:
                try:
                    assignee_id = UUID(assignee)
                except ValueError:
                    raise ValidationError({"assignee": "شناسه اپراتور نامعتبر است."}) from None
                submissions = submissions.filter(
                    active_claim, review_claims__operator_id=assignee_id
                )
        ordering = (
            "pending_since"
            if request.query_params.get("ordering") != "newest"
            else "-pending_since"
        )
        return submissions.order_by(ordering, "id").distinct()


class OperatorSubmissionSummaryView(APIView):
    permission_classes = (CanReviewSubmission,)

    @extend_schema(
        summary="Summarize actionable Submission Review workload",
        responses=SubmissionWorkloadSummarySerializer,
    )
    def get(self, request: Request) -> Response:
        summary = submission_workload_summary(operator=cast(User, request.user))
        return Response(SubmissionWorkloadSummarySerializer(summary).data)


class OperatorSubmissionDetailView(APIView):
    permission_classes = (CanReviewSubmission,)

    @extend_schema(
        summary="Inspect a Submission without claiming it", responses=SubmissionSerializer
    )
    def get(self, request: Request, submission_id: str) -> Response:
        submission = get_object_or_404(
            operator_submission_queryset(operator=cast(User, request.user)),
            id=submission_id,
        )
        return Response(SubmissionSerializer(submission, context={"request": request}).data)


class OperatorSubmissionNotificationRetryView(APIView):
    permission_classes = (CanReviewSubmission,)

    @extend_schema(
        summary="Retry a failed Submission decision notification",
        request=None,
        responses=SubmissionSerializer,
    )
    def post(self, request: Request, submission_id: str, notification_id: UUID) -> Response:
        operator = cast(User, request.user)
        submission = get_object_or_404(
            submissions_reviewable_by(operator=operator), id=submission_id
        )
        try:
            retry_submission_decision_notification(
                submission=submission,
                notification_id=notification_id,
                actor=operator,
            )
        except DjangoValidationError as exc:
            raise validation_response(exc) from None
        submission = get_object_or_404(
            operator_submission_queryset(operator=operator), id=submission_id
        )
        return Response(SubmissionSerializer(submission, context={"request": request}).data)


class OperatorReviewClaimView(APIView):
    permission_classes = (CanReviewSubmission,)

    @extend_schema(
        summary="Claim a Submission revision", request=None, responses={201: SubmissionSerializer}
    )
    def post(self, request: Request, submission_id: str) -> Response:
        operator = cast(User, request.user)
        submission = get_object_or_404(
            submissions_reviewable_by(operator=operator), id=submission_id
        )
        try:
            claim_submission_review(submission=submission, actor=operator)
        except ReviewWorkflowConflict as exc:
            raise ReviewConflict(exc) from None
        except DjangoValidationError as exc:
            raise validation_response(exc) from None
        submission = get_object_or_404(
            operator_submission_queryset(operator=operator), id=submission_id
        )
        data = SubmissionSerializer(submission, context={"request": request}).data
        return Response(data, status=status.HTTP_201_CREATED)

    @extend_schema(summary="Release the current Operator's Review Claim", responses={204: None})
    def delete(self, request: Request, submission_id: str) -> Response:
        operator = cast(User, request.user)
        submission = get_object_or_404(
            submissions_reviewable_by(operator=operator), id=submission_id
        )
        try:
            release_submission_review_claim(submission=submission, actor=operator)
        except ReviewWorkflowConflict as exc:
            raise ReviewConflict(exc) from None
        return Response(status=status.HTTP_204_NO_CONTENT)


class OperatorReviewClaimRenewView(APIView):
    permission_classes = (CanReviewSubmission,)

    @extend_schema(
        summary="Renew the current Operator's Review Claim",
        request=None,
        responses=ReviewClaimSerializer,
    )
    def post(self, request: Request, submission_id: str) -> Response:
        operator = cast(User, request.user)
        submission = get_object_or_404(
            submissions_reviewable_by(operator=operator), id=submission_id
        )
        try:
            claim = renew_submission_review_claim(submission=submission, actor=operator)
        except ReviewWorkflowConflict as exc:
            raise ReviewConflict(exc) from None
        return Response(ReviewClaimSerializer(claim).data)


class OperatorReviewClaimForceReleaseView(APIView):
    permission_classes = (CanManageSubmissionQueue,)

    @extend_schema(
        summary="Force-release a Review Claim",
        request=ForceReleaseReviewClaimSerializer,
        responses={204: None},
    )
    def post(self, request: Request, submission_id: str) -> Response:
        serializer = ForceReleaseReviewClaimSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        operator = cast(User, request.user)
        submission = get_object_or_404(
            submissions_reviewable_by(operator=operator), id=submission_id
        )
        try:
            force_release_submission_review_claim(
                submission=submission,
                actor=operator,
                reason=serializer.validated_data["reason"],
            )
        except ReviewWorkflowConflict as exc:
            raise ReviewConflict(exc) from None
        return Response(status=status.HTTP_204_NO_CONTENT)


ReviewDecision = Callable[..., Submission]


def review_reason_response(
    *, request: Request, submission_id: str, decision: ReviewDecision
) -> Response:
    operator = cast(User, request.user)
    serializer = ReviewReasonSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        submission = decision(
            submission=get_object_or_404(
                submissions_reviewable_by(operator=operator),
                id=submission_id,
            ),
            actor=operator,
            reviewed_revision=serializer.validated_data["reviewed_revision"],
            reason=serializer.validated_data["reason"],
        )
    except DjangoValidationError as exc:
        raise validation_response(exc) from None
    except ReviewWorkflowConflict as exc:
        raise ReviewConflict(exc) from None
    return Response(SubmissionSerializer(submission, context={"request": request}).data)


class OperatorRequestChangesView(APIView):
    permission_classes = (CanReviewSubmission,)

    @extend_schema(
        summary="Request changes to a pending Submission",
        request=ReviewReasonSerializer,
        responses={200: SubmissionSerializer, 409: REVIEW_CONFLICT_RESPONSE},
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
        responses={200: SubmissionSerializer, 409: REVIEW_CONFLICT_RESPONSE},
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
        responses={200: SubmissionSerializer, 409: REVIEW_CONFLICT_RESPONSE},
    )
    def post(self, request: Request, submission_id: str) -> Response:
        operator = cast(User, request.user)
        serializer = SubmissionApprovalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            submission = approve_submission(
                submission=get_object_or_404(
                    submissions_reviewable_by(operator=operator),
                    id=submission_id,
                ),
                actor=operator,
                **serializer.validated_data,
            )
        except Property.DoesNotExist:
            raise ValidationError({"property_id": "Property مقصد پیدا نشد."}) from None
        except ReviewWorkflowConflict as exc:
            raise ReviewConflict(exc) from None
        except DjangoValidationError as exc:
            raise validation_response(exc) from None
        return Response(SubmissionSerializer(submission, context={"request": request}).data)


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
        can_review = has_capability(user, OperatorCapability.REVIEW_SUBMISSIONS)
        ownership = {"image__submission__submitter": user} if not can_review else {}
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
