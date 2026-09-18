from django.urls import path

from .exception_views import SourceExceptionRetryView
from .views import (
    ExtractionRequestCreateView,
    SourceProposalDetailView,
    SourceProposalListCreateView,
    SourceProposalSubmitView,
)

app_name = "source_proposals"

urlpatterns = [
    path(
        "<uuid:proposal_id>/exceptions/retry/",
        SourceExceptionRetryView.as_view(),
        name="exception-retry",
    ),
    path(
        "<uuid:proposal_id>/extraction-requests/",
        ExtractionRequestCreateView.as_view(),
        name="extraction-create",
    ),
    path("", SourceProposalListCreateView.as_view(), name="list-create"),
    path("<uuid:proposal_id>/", SourceProposalDetailView.as_view(), name="detail"),
    path("<uuid:proposal_id>/submit/", SourceProposalSubmitView.as_view(), name="submit"),
]
