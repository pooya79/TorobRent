from django.urls import path

from .views import (
    OperatorApproveView,
    OperatorRejectView,
    OperatorRequestChangesView,
    OperatorReviewClaimForceReleaseView,
    OperatorReviewClaimRenewView,
    OperatorReviewClaimView,
    OperatorSubmissionDetailView,
    OperatorSubmissionListView,
    OperatorSubmissionNotificationRetryView,
)

app_name = "operator-submissions"

urlpatterns = [
    path("", OperatorSubmissionListView.as_view(), name="list"),
    path("<uuid:submission_id>/", OperatorSubmissionDetailView.as_view(), name="detail"),
    path(
        "<uuid:submission_id>/notifications/<uuid:notification_id>/retry/",
        OperatorSubmissionNotificationRetryView.as_view(),
        name="notification-retry",
    ),
    path("<uuid:submission_id>/claim/", OperatorReviewClaimView.as_view(), name="claim"),
    path(
        "<uuid:submission_id>/claim/renew/",
        OperatorReviewClaimRenewView.as_view(),
        name="claim-renew",
    ),
    path(
        "<uuid:submission_id>/claim/force-release/",
        OperatorReviewClaimForceReleaseView.as_view(),
        name="claim-force-release",
    ),
    path(
        "<uuid:submission_id>/request-changes/",
        OperatorRequestChangesView.as_view(),
        name="request-changes",
    ),
    path("<uuid:submission_id>/reject/", OperatorRejectView.as_view(), name="reject"),
    path("<uuid:submission_id>/approve/", OperatorApproveView.as_view(), name="approve"),
]
