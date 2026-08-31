import secrets
from collections.abc import Iterable
from datetime import timedelta
from enum import StrEnum

from django.conf import settings
from django.contrib.auth import login, logout
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import Group, Permission
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.http import HttpRequest
from django.utils import timezone

from .capabilities import CAPABILITY_PERMISSIONS, MANAGED_OPERATOR_GROUPS
from .identifiers import AccountIdentifier
from .models import PhoneVerificationChallenge, User
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


def _has_operator_grant(user: User) -> bool:
    direct_permissions = user.user_permissions.select_related("content_type")
    groups = user.groups.prefetch_related("permissions__content_type")
    return bool(
        _operator_permission_ids(direct_permissions)
        or any(_operator_permission_ids(group.permissions.all()) for group in groups)
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


def _issue_phone_otp(*, user: User, phone: str) -> str | None:
    latest = (
        PhoneVerificationChallenge.objects
        .filter(user=user, phone=phone)
        .order_by("-created_at")
        .first()
    )
    if latest is not None and latest.created_at > timezone.now() - timedelta(seconds=60):
        return None
    code = f"{secrets.randbelow(1_000_000):06d}"
    PhoneVerificationChallenge.objects.filter(
        user=user, phone=phone, consumed_at__isnull=True
    ).update(consumed_at=timezone.now())
    PhoneVerificationChallenge.objects.create(
        user=user,
        phone=phone,
        secret_hash=make_password(code),
        expires_at=timezone.now() + timedelta(minutes=5),
    )
    return code


def request_phone_verification(*, phone: str, requesting_user: User | None = None) -> str | None:
    if requesting_user is None:
        user = User.objects.filter(phone=phone, phone_verified_at__isnull=True).first()
    else:
        conflict = User.objects.filter(phone=phone).exclude(pk=requesting_user.pk).exists()
        if conflict or requesting_user.phone_verified:
            return None
        user = requesting_user
    if user is None:
        return None
    return _issue_phone_otp(user=user, phone=phone)


def _register_account(
    *, identifier: AccountIdentifier, password: str, is_submitter: bool
) -> tuple[User, str | None]:
    user = User.objects.create_user(
        email=identifier.value if identifier.kind == "email" else None,
        phone=identifier.value if identifier.kind == "phone" else None,
        password=password,
        is_submitter=is_submitter,
    )
    if identifier.kind == "phone":
        otp = _issue_phone_otp(user=user, phone=identifier.value)
        assert otp is not None
        return user, otp
    token = make_email_verification_token(user)
    verification_url = f"{settings.FRONTEND_ORIGIN}/verify-email?token={token}"
    send_mail(
        "تأیید ایمیل ترب‌رنت",
        f"برای تأیید ایمیل خود این پیوند را باز کنید:\n{verification_url}",
        settings.DEFAULT_FROM_EMAIL,
        [identifier.value],
    )
    return user, None


def register_submitter(*, identifier: AccountIdentifier, password: str) -> tuple[User, str | None]:
    return _register_account(identifier=identifier, password=password, is_submitter=True)


def register_renter(*, identifier: AccountIdentifier, password: str) -> tuple[User, str | None]:
    return _register_account(identifier=identifier, password=password, is_submitter=False)


def verify_email(token: str) -> bool:
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


class PhoneVerificationResult(StrEnum):
    SUCCESS = "success"
    INVALID = "invalid"
    EXPIRED = "expired"
    EXHAUSTED = "exhausted"


def verify_phone(*, identifier: str, otp: str) -> PhoneVerificationResult:
    with transaction.atomic():
        challenge = (
            PhoneVerificationChallenge.objects
            .select_for_update()
            .filter(phone=identifier, consumed_at__isnull=True)
            .order_by("-created_at")
            .first()
        )
        if challenge is None:
            return PhoneVerificationResult.INVALID
        if challenge.expires_at <= timezone.now():
            return PhoneVerificationResult.EXPIRED
        if challenge.attempts >= 5:
            return PhoneVerificationResult.EXHAUSTED
        challenge.attempts += 1
        if not check_password(otp, challenge.secret_hash):
            challenge.save(update_fields=["attempts"])
            return PhoneVerificationResult.INVALID
        challenge.consumed_at = timezone.now()
        challenge.save(update_fields=["attempts", "consumed_at"])
        user = User.objects.select_for_update().get(pk=challenge.user_id)
        user.phone = identifier
        user.phone_verified_at = timezone.now()
        user.save(update_fields=["phone", "phone_verified_at"])
    return PhoneVerificationResult.SUCCESS


def start_session(
    request: HttpRequest, *, identifier: AccountIdentifier, password: str
) -> User | None:
    user = User.objects.filter(**{identifier.kind: identifier.value}, is_active=True).first()
    verified = user and (user.email_verified if identifier.kind == "email" else user.phone_verified)
    if not isinstance(user, User) or not verified or not user.check_password(password):
        return None
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return user


def end_session(request: HttpRequest) -> None:
    logout(request)


def request_password_reset(email: str) -> None:
    user = User.objects.filter(email=email, is_active=True).first()
    if user is None or user.email is None:
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


@transaction.atomic
def anonymize_operator_account(*, target: User, actor: User) -> User:
    if not actor.is_superuser:
        raise ValidationError("Only a superuser may anonymize an account.")
    if target.id == actor.id or target.is_superuser:
        raise ValidationError("A superuser account cannot be anonymized through this action.")

    locked = User.objects.select_for_update().get(id=target.id)
    if locked.anonymized_at is not None:
        return locked
    if not _has_operator_grant(locked):
        raise ValidationError("Only an account with an Operator grant may be anonymized here.")
    locked.email = f"former-operator-{locked.id.hex}@anonymized.invalid"
    locked.first_name = ""
    locked.last_name = ""
    locked.email_verified_at = None
    locked.last_login = None
    locked.is_active = False
    locked.is_staff = False
    locked.is_superuser = False
    locked.anonymized_at = timezone.now()
    locked.set_unusable_password()
    locked.save(
        update_fields=(
            "email",
            "first_name",
            "last_name",
            "email_verified_at",
            "last_login",
            "is_active",
            "is_staff",
            "is_superuser",
            "anonymized_at",
            "password",
        )
    )
    locked.groups.clear()
    locked.user_permissions.clear()
    target.refresh_from_db()
    return locked
