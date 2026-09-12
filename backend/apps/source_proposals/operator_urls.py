from django.urls import path

from .bulk_views import SourceBulkApplyView, SourceBulkPreviewView
from .exception_views import OperatorSourceExceptionRetryView
from .exclusion_views import (
    OperatorExclusionAddView,
    OperatorExclusionPreviewView,
    OperatorExclusionRemoveView,
    OperatorExclusionWithdrawView,
)
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
    OperatorSourcePublicationModeView,
    OperatorSourceResponsibilityView,
)
from .processing_views import OperatorSourceCrawlControlView, OperatorSourceProcessingView
from .run_views import OperatorRunApproveView

app_name = "operator-source-proposals"

urlpatterns = [
    path(
        "<uuid:proposal_id>/crawl/", OperatorSourceCrawlControlView.as_view(), name="crawl-control"
    ),
    path(
        "<uuid:proposal_id>/exceptions/bulk/preview/",
        SourceBulkPreviewView.as_view(),
        name="bulk-preview",
    ),
    path(
        "<uuid:proposal_id>/exceptions/bulk/apply/",
        SourceBulkApplyView.as_view(),
        name="bulk-apply",
    ),
    path(
        "<uuid:proposal_id>/processing/", OperatorSourceProcessingView.as_view(), name="processing"
    ),
    path(
        "<uuid:proposal_id>/exceptions/retry/",
        OperatorSourceExceptionRetryView.as_view(),
        name="exception-retry",
    ),
    path(
        "<uuid:proposal_id>/exclusions/withdraw/",
        OperatorExclusionWithdrawView.as_view(),
        name="exclusion-withdraw",
    ),
    path(
        "<uuid:proposal_id>/exclusions/add/",
        OperatorExclusionAddView.as_view(),
        name="exclusion-add",
    ),
    path(
        "<uuid:proposal_id>/exclusions/remove/",
        OperatorExclusionRemoveView.as_view(),
        name="exclusion-remove",
    ),
    path(
        "<uuid:proposal_id>/exclusions/preview/",
        OperatorExclusionPreviewView.as_view(),
        name="exclusion-preview",
    ),
    path(
        "<uuid:proposal_id>/publication-mode/",
        OperatorSourcePublicationModeView.as_view(),
        name="publication-mode",
    ),
    path(
        "<uuid:proposal_id>/responsibility/",
        OperatorSourceResponsibilityView.as_view(),
        name="responsibility",
    ),
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
