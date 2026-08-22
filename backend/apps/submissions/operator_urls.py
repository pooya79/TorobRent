from django.urls import path

from .views import (
    OperatorApproveView,
    OperatorRejectView,
    OperatorRequestChangesView,
    OperatorSubmissionListView,
)

app_name = "operator-submissions"

urlpatterns = [
    path("", OperatorSubmissionListView.as_view(), name="list"),
    path(
        "<uuid:submission_id>/request-changes/",
        OperatorRequestChangesView.as_view(),
        name="request-changes",
    ),
    path("<uuid:submission_id>/reject/", OperatorRejectView.as_view(), name="reject"),
    path("<uuid:submission_id>/approve/", OperatorApproveView.as_view(), name="approve"),
]
