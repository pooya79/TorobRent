from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db import transaction
from django.http import HttpRequest
from django.utils import timezone

from .models import User
from .tokens import (
    make_email_verification_token,
    make_password_reset_token,
    read_email_verification_token,
    read_password_reset_token,
)


def register_submitter(*, email: str, password: str) -> User:
    user = User.objects.create_user(email=email, password=password)
    token = make_email_verification_token(user)
    verification_url = f"{settings.FRONTEND_ORIGIN}/verify-email?token={token}"
    send_mail(
        "تأیید ایمیل ترب‌رنت",
        f"برای تأیید ایمیل خود این پیوند را باز کنید:\n{verification_url}",
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
    )
    return user


def verify_submitter_email(token: str) -> bool:
    user_id = read_email_verification_token(token, settings.EMAIL_VERIFICATION_TIMEOUT)
    if user_id is None:
        return False
    with transaction.atomic():
        try:
            user = User.objects.select_for_update().get(pk=user_id, email_verified_at__isnull=True)
        except User.DoesNotExist, ValueError:
            return False
        user.email_verified_at = timezone.now()
        user.save(update_fields=["email_verified_at"])
    return True


def start_session(request: HttpRequest, *, email: str, password: str) -> User | None:
    user = authenticate(request=request, email=email, password=password)
    if not isinstance(user, User):
        return None
    login(request, user)
    return user


def end_session(request: HttpRequest) -> None:
    logout(request)


def request_password_reset(email: str) -> None:
    user = User.objects.filter(email=email, is_active=True).first()
    if user is None:
        return
    token = make_password_reset_token(user)
    reset_url = f"{settings.FRONTEND_ORIGIN}/reset-password?token={token}"
    send_mail(
        "بازیابی گذرواژه ترب‌رنت",
        f"برای انتخاب گذرواژه جدید این پیوند را باز کنید:\n{reset_url}",
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
    )


def reset_password(*, token: str, new_password: str) -> bool:
    claims = read_password_reset_token(token)
    if claims is None:
        return False
    with transaction.atomic():
        try:
            user = User.objects.select_for_update().get(pk=claims.user_id, is_active=True)
        except User.DoesNotExist, ValueError:
            return False
        if not default_token_generator.check_token(user, claims.password_token):
            return False
        user.set_password(new_password)
        user.save(update_fields=["password"])
    return True
