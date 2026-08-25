from django.urls import path

from .operator_views import (
    OperatorSupportExternalContactView,
    OperatorSupportIdentityVerificationView,
    OperatorSupportPrivacyActionView,
    OperatorSupportRequestClaimView,
    OperatorSupportRequestDetailView,
    OperatorSupportRequestListView,
    OperatorSupportRequestNoteView,
    OperatorSupportRequestReassignView,
    OperatorSupportRequestReopenView,
    OperatorSupportRequestResolveView,
    OperatorSupportRequestTriageView,
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
    path(
        "<uuid:support_request_id>/notes/",
        OperatorSupportRequestNoteView.as_view(),
        name="notes",
    ),
    path(
        "<uuid:support_request_id>/external-contacts/",
        OperatorSupportExternalContactView.as_view(),
        name="external-contacts",
    ),
    path(
        "<uuid:support_request_id>/identity-verifications/",
        OperatorSupportIdentityVerificationView.as_view(),
        name="identity-verifications",
    ),
    path(
        "<uuid:support_request_id>/privacy-actions/",
        OperatorSupportPrivacyActionView.as_view(),
        name="privacy-actions",
    ),
    path(
        "<uuid:support_request_id>/resolve/",
        OperatorSupportRequestResolveView.as_view(),
        name="resolve",
    ),
    path(
        "<uuid:support_request_id>/reopen/",
        OperatorSupportRequestReopenView.as_view(),
        name="reopen",
    ),
    path(
        "<uuid:support_request_id>/triage/",
        OperatorSupportRequestTriageView.as_view(),
        name="triage",
    ),
    path(
        "<uuid:support_request_id>/reassign/",
        OperatorSupportRequestReassignView.as_view(),
        name="reassign",
    ),
]
