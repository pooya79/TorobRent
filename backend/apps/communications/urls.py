from django.urls import path

from .views import MessageDetailView, MessageListView, UnreadMessageCountView

app_name = "communications"

urlpatterns = [
    path("", MessageListView.as_view(), name="message-list"),
    path("unread-count/", UnreadMessageCountView.as_view(), name="unread-count"),
    path("<uuid:message_id>/", MessageDetailView.as_view(), name="message-detail"),
]
