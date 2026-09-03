from django.urls import path

from .views import CurrentUserView, DisplayNameView, SubmitterOnboardingView

urlpatterns = [
    path("me/", CurrentUserView.as_view(), name="current-user"),
    path("me/display-name/", DisplayNameView.as_view(), name="display-name"),
    path(
        "me/submitter-onboarding/",
        SubmitterOnboardingView.as_view(),
        name="submitter-onboarding",
    ),
]
