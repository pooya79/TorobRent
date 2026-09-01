from django.urls import path

from .views import (
    SubmissionArchiveView,
    SubmissionConfirmAvailabilityView,
    SubmissionContactVerificationRequestView,
    SubmissionContactVerificationView,
    SubmissionDetailView,
    SubmissionImageContentView,
    SubmissionImageDetailView,
    SubmissionImageListCreateView,
    SubmissionImageRetryView,
    SubmissionListCreateView,
    SubmissionMarkUnavailableView,
    SubmissionSubmitView,
)

app_name = "submissions"

urlpatterns = [
    path("", SubmissionListCreateView.as_view(), name="list-create"),
    path("<uuid:submission_id>/", SubmissionDetailView.as_view(), name="detail"),
    path("<uuid:submission_id>/submit/", SubmissionSubmitView.as_view(), name="submit"),
    path(
        "<uuid:submission_id>/contact-verification/request/",
        SubmissionContactVerificationRequestView.as_view(),
        name="contact-verification-request",
    ),
    path(
        "<uuid:submission_id>/contact-verification/verify/",
        SubmissionContactVerificationView.as_view(),
        name="contact-verification-verify",
    ),
    path(
        "<uuid:submission_id>/confirm-availability/",
        SubmissionConfirmAvailabilityView.as_view(),
        name="confirm-availability",
    ),
    path(
        "<uuid:submission_id>/mark-unavailable/",
        SubmissionMarkUnavailableView.as_view(),
        name="mark-unavailable",
    ),
    path(
        "<uuid:submission_id>/archive/",
        SubmissionArchiveView.as_view(),
        name="archive",
    ),
    path(
        "<uuid:submission_id>/images/",
        SubmissionImageListCreateView.as_view(),
        name="image-list-create",
    ),
    path(
        "<uuid:submission_id>/images/<uuid:image_id>/",
        SubmissionImageDetailView.as_view(),
        name="image-detail",
    ),
    path(
        "<uuid:submission_id>/images/<uuid:image_id>/retry/",
        SubmissionImageRetryView.as_view(),
        name="image-retry",
    ),
    path(
        "<uuid:submission_id>/images/<uuid:image_id>/content/<str:kind>/",
        SubmissionImageContentView.as_view(),
        name="image-content",
    ),
]
