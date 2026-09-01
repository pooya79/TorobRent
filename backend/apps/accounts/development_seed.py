from dataclasses import dataclass
from datetime import UTC, datetime

from .models import User

DEVELOPMENT_SUBMITTER_EMAIL = "submitter@torobrent.local"
DEVELOPMENT_SUBMITTER_PASSWORD = "dev-submitter"
DEVELOPMENT_OPERATOR_EMAIL = "operator@torobrent.local"
DEVELOPMENT_OPERATOR_PASSWORD = "dev-operator"
VERIFIED_AT = datetime(2026, 1, 1, tzinfo=UTC)


@dataclass(frozen=True)
class DevelopmentPersonas:
    submitter: User
    operator: User


def _get_or_create_persona(*, email: str, password: str, operator: bool, submitter: bool) -> User:
    user, created = User.objects.get_or_create(
        email=email,
        defaults={
            "email_verified_at": VERIFIED_AT,
            "is_active": True,
            "is_staff": operator,
            "is_superuser": operator,
            "is_submitter": submitter,
        },
    )
    if created:
        user.set_password(password)
        user.save(update_fields=("password",))
    return user


def seed_development_personas() -> DevelopmentPersonas:
    return DevelopmentPersonas(
        submitter=_get_or_create_persona(
            email=DEVELOPMENT_SUBMITTER_EMAIL,
            password=DEVELOPMENT_SUBMITTER_PASSWORD,
            operator=False,
            submitter=True,
        ),
        operator=_get_or_create_persona(
            email=DEVELOPMENT_OPERATOR_EMAIL,
            password=DEVELOPMENT_OPERATOR_PASSWORD,
            operator=True,
            submitter=False,
        ),
    )
