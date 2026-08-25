from django.urls import path

from .operator_views import (
    OperatorSupportRequestClaimView,
    OperatorSupportRequestDetailView,
    OperatorSupportRequestListView,
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
]
