from dataclasses import dataclass

from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core import signing

from .models import User

EMAIL_VERIFICATION_SALT = "accounts.email-verification"
PASSWORD_RESET_SALT = "accounts.password-reset"


@dataclass(frozen=True)
class PasswordResetClaims:
    user_id: str
    password_token: str


def make_email_verification_token(user: User) -> str:
    return signing.dumps(str(user.pk), salt=EMAIL_VERIFICATION_SALT)


def read_email_verification_token(token: str, max_age: int) -> str | None:
    try:
        user_id = signing.loads(token, salt=EMAIL_VERIFICATION_SALT, max_age=max_age)
        return str(user_id)
    except signing.BadSignature, signing.SignatureExpired, ValueError:
        return None


def make_password_reset_token(user: User) -> str:
    return signing.dumps(
        {"user_id": str(user.pk), "token": default_token_generator.make_token(user)},
        salt=PASSWORD_RESET_SALT,
    )


def read_password_reset_token(token: str) -> PasswordResetClaims | None:
    try:
        payload = signing.loads(
            token, salt=PASSWORD_RESET_SALT, max_age=settings.PASSWORD_RESET_TIMEOUT
        )
        return PasswordResetClaims(
            user_id=str(payload["user_id"]), password_token=str(payload["token"])
        )
    except (
        signing.BadSignature,
        signing.SignatureExpired,
        KeyError,
        TypeError,
        ValueError,
    ):
        return None
