from django.urls import path

from .views import (
    EmailVerificationRequestView,
    LoginView,
    LogoutView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    PhoneVerificationRequestView,
    RegistrationView,
    RenterRegistrationView,
    SessionView,
    VerifyEmailView,
    VerifyPhoneView,
)

urlpatterns = [
    path("session/", SessionView.as_view(), name="session"),
    path("register/", RegistrationView.as_view(), name="register"),
    path("renter-register/", RenterRegistrationView.as_view(), name="renter-register"),
    path("verify-email/", VerifyEmailView.as_view(), name="verify-email"),
    path(
        "email-verification/request/",
        EmailVerificationRequestView.as_view(),
        name="email-verification-request",
    ),
    path("verify-phone/", VerifyPhoneView.as_view(), name="verify-phone"),
    path(
        "phone-verification/request/",
        PhoneVerificationRequestView.as_view(),
        name="phone-verification-request",
    ),
    path("login/", LoginView.as_view(), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="password-reset"),
    path(
        "password-reset/confirm/",
        PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
]
