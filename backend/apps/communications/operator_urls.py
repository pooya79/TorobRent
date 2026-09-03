from django.urls import path

from .operator_views import (
    ConversationEvidenceReleaseView,
    ConversationReportDecisionView,
    ConversationReportDetailView,
    ConversationReportListView,
)

app_name = "conversation_moderation"

urlpatterns = [
    path("", ConversationReportListView.as_view(), name="report-list"),
    path(
        "<uuid:report_id>/",
        ConversationReportDetailView.as_view(),
        name="report-detail",
    ),
    path(
        "<uuid:report_id>/decision/",
        ConversationReportDecisionView.as_view(),
        name="report-decision",
    ),
    path(
        "<uuid:report_id>/evidence-release/",
        ConversationEvidenceReleaseView.as_view(),
        name="report-evidence-release",
    ),
]
