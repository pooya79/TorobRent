from collections.abc import Iterable

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import Group, Permission
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.http import HttpRequest
from django.utils import timezone

from .capabilities import CAPABILITY_PERMISSIONS, MANAGED_OPERATOR_GROUPS
from .models import User
from .tokens import (
    make_email_verification_token,
    make_password_reset_token,
    read_email_verification_token,
    read_password_reset_token,
)


def _is_operator_permission(permission: Permission) -> bool:
    permission_name = f"{permission.content_type.app_label}.{permission.codename}"
    return permission_name in CAPABILITY_PERMISSIONS.values()


def _operator_permission_ids(permissions: Iterable[Permission]) -> frozenset[int]:
    return frozenset(
        permission.pk for permission in permissions if _is_operator_permission(permission)
    )


def _operator_group_ids(groups: Iterable[Group]) -> frozenset[int]:
    return frozenset(
        group.pk
        for group in groups
        if group.name in MANAGED_OPERATOR_GROUPS
        or any(
            _is_operator_permission(permission)
            for permission in group.permissions.select_related("content_type")
        )
    )


def validate_operator_access_change(
    *,
    actor: User,
    target: User,
    is_active: bool,
    groups: Iterable[Group],
    permissions: Iterable[Permission],
) -> None:
    proposed_groups = list(groups)
    proposed_permissions = list(permissions)
    existing_group_ids = _operator_group_ids(target.groups.all())
    existing_permission_ids = _operator_permission_ids(
        target.user_permissions.select_related("content_type")
    )
    proposed_group_ids = _operator_group_ids(proposed_groups)
    proposed_permission_ids = _operator_permission_ids(proposed_permissions)

    if not actor.is_superuser and (
        existing_group_ids != proposed_group_ids
        or existing_permission_ids != proposed_permission_ids
    ):
        raise ValidationError("Only superusers may change Operator access.")

    grants_operator_access = bool(proposed_group_ids or proposed_permission_ids)
    if grants_operator_access and (not is_active or not target.email_verified):
        raise ValidationError(
            "Operator access requires an active account with a verified email address."
        )


def validate_operator_group_change(
    *,
    actor: User,
    group: Group,
    permissions: Iterable[Permission],
    changed_fields: set[str],
) -> None:
    if actor.is_superuser:
        return
    existing_permissions = (
        group.permissions.select_related("content_type") if group.pk else Permission.objects.none()
    )
    existing_operator_permissions = _operator_permission_ids(existing_permissions)
    proposed_operator_permissions = _operator_permission_ids(permissions)
    is_managed_group = group.name in MANAGED_OPERATOR_GROUPS
    if (is_managed_group and changed_fields) or (
        existing_operator_permissions != proposed_operator_permissions
    ):
        raise ValidationError("Only superusers may change Operator groups.")


def can_delete_operator_group(*, actor: User, group: Group) -> bool:
    if actor.is_superuser:
        return True
    return not (
        group.name in MANAGED_OPERATOR_GROUPS
        or _operator_permission_ids(group.permissions.select_related("content_type"))
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
