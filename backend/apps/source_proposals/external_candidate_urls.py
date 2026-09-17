from django.urls import path

from .case_reads import OperatorCandidateDetailView
from .external_candidate_views import (
    OperatorExternalListingCandidateApproveView,
    OperatorExternalListingCandidateClaimView,
    OperatorExternalListingCandidateListView,
    OperatorExternalListingCandidateRejectView,
)
from .media_views import CandidateImageView

app_name = "operator-external-listing-candidates"

urlpatterns = [
    path("<uuid:candidate_id>/", OperatorCandidateDetailView.as_view(), name="detail"),
    path("<uuid:candidate_id>/media/<int:variant_id>/", CandidateImageView.as_view(), name="media"),
    path("", OperatorExternalListingCandidateListView.as_view(), name="list"),
    path(
        "<uuid:candidate_id>/claim/",
        OperatorExternalListingCandidateClaimView.as_view(),
        name="claim",
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
