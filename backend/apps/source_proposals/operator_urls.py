from django.urls import path

from .operator_views import (
    OperatorSourceAssignmentRevokeView,
    OperatorSourceProfileApproveView,
    OperatorSourceProfileEditView,
    OperatorSourceProfileRepairView,
    OperatorSourceProfileReviewView,
    OperatorSourceProposalApproveView,
    OperatorSourceProposalClaimView,
    OperatorSourceProposalListView,
    OperatorSourceProposalRejectView,
    OperatorSourceProposalReleaseView,
    OperatorSourceProposalRequestChangesView,
)
from .run_views import OperatorRunApproveView

app_name = "operator-source-proposals"

urlpatterns = [
    path(
        "<uuid:proposal_id>/assignment/revoke/",
        OperatorSourceAssignmentRevokeView.as_view(),
        name="assignment-revoke",
    ),
    path(
        "<uuid:proposal_id>/profile/review/",
        OperatorSourceProfileReviewView.as_view(),
        name="profile-review",
    ),
    path(
        "<uuid:proposal_id>/runs/<uuid:run_id>/approve/",
        OperatorRunApproveView.as_view(),
        name="run-approve",
    ),
    path(
        "<uuid:proposal_id>/profile/repair/",
        OperatorSourceProfileRepairView.as_view(),
        name="profile-repair",
    ),
    path(
        "<uuid:proposal_id>/profile/approve/",
        OperatorSourceProfileApproveView.as_view(),
        name="profile-approve",
    ),
    path(
        "<uuid:proposal_id>/profile/edit/",
        OperatorSourceProfileEditView.as_view(),
        name="profile-edit",
    ),
    path(
        "<uuid:proposal_id>/claim/release/",
        OperatorSourceProposalReleaseView.as_view(),
        name="claim-release",
    ),
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
