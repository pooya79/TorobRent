from django.urls import path

from .views import (
    ListingInquiryCreateView,
    ListingInquiryReplyView,
    MessageDetailView,
    MessageListView,
    RequesterSupportMessageEditView,
    RequesterSupportReplyView,
    SupportRequestCreateView,
    UnreadMessageCountView,
)

app_name = "communications"

urlpatterns = [
    path(
        "listing-inquiries/",
        ListingInquiryCreateView.as_view(),
        name="listing-inquiry-create",
    ),
    path(
        "listing-inquiries/<uuid:inquiry_id>/replies/",
        ListingInquiryReplyView.as_view(),
        name="listing-inquiry-reply",
    ),
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
