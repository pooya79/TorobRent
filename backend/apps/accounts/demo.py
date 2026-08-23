from dataclasses import dataclass
from datetime import UTC, datetime

from .models import User

DEMO_SUBMITTER_EMAIL = "submitter@torobrent.local"
DEMO_SUBMITTER_PASSWORD = "demo-submitter"
DEMO_OPERATOR_EMAIL = "operator@torobrent.local"
DEMO_OPERATOR_PASSWORD = "demo-operator"
VERIFIED_AT = datetime(2026, 1, 1, tzinfo=UTC)


@dataclass(frozen=True)
class DemoPersonas:
    submitter: User
    operator: User


def _get_or_create_persona(*, email: str, password: str, operator: bool) -> User:
    user, created = User.objects.get_or_create(
        email=email,
        defaults={
            "email_verified_at": VERIFIED_AT,
            "is_active": True,
            "is_staff": operator,
            "is_superuser": operator,
        },
    )
    if created:
        user.set_password(password)
        user.save(update_fields=("password",))
    return user


def seed_demo_personas() -> DemoPersonas:
    return DemoPersonas(
        submitter=_get_or_create_persona(
            email=DEMO_SUBMITTER_EMAIL,
            password=DEMO_SUBMITTER_PASSWORD,
            operator=False,
        ),
        operator=_get_or_create_persona(
            email=DEMO_OPERATOR_EMAIL,
            password=DEMO_OPERATOR_PASSWORD,
            operator=True,
        ),
    )
