from django.urls import path

from .views import ContactDetailsView, LiveView, ReadyView

urlpatterns = [
    path("contact/", ContactDetailsView.as_view(), name="contact-details"),
    path("live/", LiveView.as_view(), name="live"),
    path("ready/", ReadyView.as_view(), name="ready"),
]
