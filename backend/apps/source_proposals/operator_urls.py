from django.urls import path

from . import case_reads
from .bulk_views import SourceBulkApplyView, SourceBulkPreviewView
from .case_reads import OperatorCaseResultsView, OperatorCaseRunsView
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
        "<uuid:proposal_id>/runs/<uuid:run_id>/",
        case_reads.OperatorCaseRunDetailView.as_view(),
        name="run-detail",
    ),
    path(
        "<uuid:proposal_id>/history/",
        case_reads.OperatorCaseHistoryView.as_view(),
        name="case-history-0",
    ),
    path(
        "<uuid:proposal_id>/responsibility-history/",
        case_reads.OperatorCaseResponsibilityHistoryView.as_view(),
        name="case-responsibility-history-1",
    ),
    path(
        "<uuid:proposal_id>/profiles/",
        case_reads.OperatorCaseProfilesView.as_view(),
        name="case-profiles-2",
    ),
    path(
        "<uuid:proposal_id>/profiles/<uuid:version_id>/",
        case_reads.OperatorCaseProfileDetailView.as_view(),
        name="case-profiles-3",
    ),
    path(
        "<uuid:proposal_id>/repairs/",
        case_reads.OperatorCaseRepairsView.as_view(),
        name="case-repairs-4",
    ),
    path(
        "<uuid:proposal_id>/problems/",
        case_reads.OperatorCaseProblemsView.as_view(),
        name="case-problems-5",
    ),
    path(
        "<uuid:proposal_id>/problems/<uuid:exception_id>/attempts/",
        case_reads.OperatorCaseAttemptsView.as_view(),
        name="case-problems-6",
    ),
    path(
        "<uuid:proposal_id>/exclusions/",
        case_reads.OperatorCaseExclusionsView.as_view(),
        name="case-exclusions-7",
    ),
    path(
        "<uuid:proposal_id>/exclusions/<uuid:exclusion_id>/actions/",
        case_reads.OperatorCaseExclusionActionsView.as_view(),
        name="case-exclusions-8",
    ),
    path("<uuid:proposal_id>/runs/", OperatorCaseRunsView.as_view(), name="run-history"),
    path("<uuid:proposal_id>/results/", OperatorCaseResultsView.as_view(), name="results"),
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
