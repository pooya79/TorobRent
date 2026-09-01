from django.urls import path

from .operator_views import (
    OperatorSourceProposalApproveView,
    OperatorSourceProposalClaimView,
    OperatorSourceProposalListView,
    OperatorSourceProposalRejectView,
    OperatorSourceProposalRequestChangesView,
)

app_name = "operator-source-proposals"

urlpatterns = [
    path("", OperatorSourceProposalListView.as_view(), name="list"),
    path("<uuid:proposal_id>/claim/", OperatorSourceProposalClaimView.as_view(), name="claim"),
    path(
        "<uuid:proposal_id>/request-changes/",
        OperatorSourceProposalRequestChangesView.as_view(),
        name="request-changes",
    ),
    path(
        "<uuid:proposal_id>/reject/",
        OperatorSourceProposalRejectView.as_view(),
        name="reject",
    ),
    path(
        "<uuid:proposal_id>/approve/",
        OperatorSourceProposalApproveView.as_view(),
        name="approve",
    ),
]
