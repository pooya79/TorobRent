from django.urls import path

from .views import (
    SourceProposalDetailView,
    SourceProposalDraftView,
    SourceProposalListCreateView,
    SourceProposalPreviewView,
    SourceProposalSubmitView,
)

app_name = "source_proposals"

urlpatterns = [
    path("", SourceProposalListCreateView.as_view(), name="list-create"),
    path("<uuid:proposal_id>/", SourceProposalDetailView.as_view(), name="detail"),
    path("<uuid:proposal_id>/preview/", SourceProposalPreviewView.as_view(), name="preview"),
    path("<uuid:proposal_id>/draft/", SourceProposalDraftView.as_view(), name="draft"),
    path("<uuid:proposal_id>/submit/", SourceProposalSubmitView.as_view(), name="submit"),
]
