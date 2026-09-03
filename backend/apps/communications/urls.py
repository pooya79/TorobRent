from django.urls import path

from .views import (
    MessageDetailView,
    MessageListView,
    RequesterSupportMessageEditView,
    RequesterSupportReplyView,
    SupportRequestCreateView,
    UnreadMessageCountView,
)

app_name = "communications"

urlpatterns = [
    path("support-requests/", SupportRequestCreateView.as_view(), name="support-create"),
    path(
        "support-requests/<uuid:support_request_id>/replies/",
        RequesterSupportReplyView.as_view(),
        name="support-reply",
    ),
    path(
        "support-requests/<uuid:support_request_id>/messages/<uuid:support_message_id>/",
        RequesterSupportMessageEditView.as_view(),
        name="support-message-edit",
    ),
    path("", MessageListView.as_view(), name="message-list"),
    path("unread-count/", UnreadMessageCountView.as_view(), name="unread-count"),
    path("<uuid:message_id>/", MessageDetailView.as_view(), name="message-detail"),
]
