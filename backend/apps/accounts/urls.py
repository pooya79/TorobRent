from django.urls import path

from .views import CurrentUserView, SubmitterOnboardingView

urlpatterns = [
    path("me/", CurrentUserView.as_view(), name="current-user"),
    path(
        "me/submitter-onboarding/",
        SubmitterOnboardingView.as_view(),
        name="submitter-onboarding",
    ),
]
