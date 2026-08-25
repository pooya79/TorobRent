from django.urls import path

from .operator_views import (
    OperatorSupportRequestClaimView,
    OperatorSupportRequestDetailView,
    OperatorSupportRequestListView,
    OperatorSupportRequestReassignView,
    OperatorSupportRequestTriageView,
)

app_name = "operator-support-requests"

urlpatterns = [
    path("", OperatorSupportRequestListView.as_view(), name="list"),
    path(
        "<uuid:support_request_id>/",
        OperatorSupportRequestDetailView.as_view(),
        name="detail",
    ),
    path(
        "<uuid:support_request_id>/claim/",
        OperatorSupportRequestClaimView.as_view(),
        name="claim",
    ),
    path(
        "<uuid:support_request_id>/triage/",
        OperatorSupportRequestTriageView.as_view(),
        name="triage",
    ),
    path(
        "<uuid:support_request_id>/reassign/",
        OperatorSupportRequestReassignView.as_view(),
        name="reassign",
    ),
]
