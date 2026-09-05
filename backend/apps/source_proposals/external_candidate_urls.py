from django.urls import path

from .external_candidate_views import (
    OperatorExternalListingCandidateApproveView,
    OperatorExternalListingCandidateClaimView,
    OperatorExternalListingCandidateCorrectView,
    OperatorExternalListingCandidateListView,
    OperatorExternalListingCandidateRejectView,
    OperatorExternalListingCandidateRequestChangesView,
)

app_name = "operator-external-listing-candidates"

urlpatterns = [
    path(
        "<uuid:candidate_id>/correct/",
        OperatorExternalListingCandidateCorrectView.as_view(),
        name="correct",
    ),
    path("", OperatorExternalListingCandidateListView.as_view(), name="list"),
    path(
        "<uuid:candidate_id>/claim/",
        OperatorExternalListingCandidateClaimView.as_view(),
        name="claim",
    ),
    path(
        "<uuid:candidate_id>/request-changes/",
        OperatorExternalListingCandidateRequestChangesView.as_view(),
        name="request-changes",
    ),
    path(
        "<uuid:candidate_id>/reject/",
        OperatorExternalListingCandidateRejectView.as_view(),
        name="reject",
    ),
    path(
        "<uuid:candidate_id>/approve/",
        OperatorExternalListingCandidateApproveView.as_view(),
        name="approve",
    ),
]
