from django.urls import path

from .views import SubmissionDetailView, SubmissionListCreateView

app_name = "submissions"

urlpatterns = [
    path("", SubmissionListCreateView.as_view(), name="list-create"),
    path("<uuid:submission_id>/", SubmissionDetailView.as_view(), name="detail"),
]
