from django.urls import path

from .views import (
    SubmissionDetailView,
    SubmissionImageContentView,
    SubmissionImageDetailView,
    SubmissionImageListCreateView,
    SubmissionImageRetryView,
    SubmissionListCreateView,
)

app_name = "submissions"

urlpatterns = [
    path("", SubmissionListCreateView.as_view(), name="list-create"),
    path("<uuid:submission_id>/", SubmissionDetailView.as_view(), name="detail"),
    path(
        "<uuid:submission_id>/images/",
        SubmissionImageListCreateView.as_view(),
        name="image-list-create",
    ),
    path(
        "<uuid:submission_id>/images/<uuid:image_id>/",
        SubmissionImageDetailView.as_view(),
        name="image-detail",
    ),
    path(
        "<uuid:submission_id>/images/<uuid:image_id>/retry/",
        SubmissionImageRetryView.as_view(),
        name="image-retry",
    ),
    path(
        "<uuid:submission_id>/images/<uuid:image_id>/content/<str:kind>/",
        SubmissionImageContentView.as_view(),
        name="image-content",
    ),
]
