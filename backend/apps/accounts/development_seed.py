from dataclasses import dataclass
from datetime import UTC, datetime

from django.contrib.auth.models import Group

from .models import User

DEVELOPMENT_SUBMITTER_EMAIL = "submitter@torobrent.local"
DEVELOPMENT_SUBMITTER_PASSWORD = "dev-submitter"
DEVELOPMENT_SUBMITTER_PHONE = "09120000000"
DEVELOPMENT_OPERATOR_EMAIL = "operator@torobrent.local"
DEVELOPMENT_OPERATOR_PASSWORD = "dev-operator"
DEVELOPMENT_RENTER_EMAIL = "renter@torobrent.local"
DEVELOPMENT_RENTER_PASSWORD = "dev-renter"
DEVELOPMENT_RENTER_TWO_EMAIL = "renter-two@torobrent.local"
DEVELOPMENT_RENTER_TWO_PASSWORD = "dev-renter-two"
DEVELOPMENT_REVIEWER_EMAIL = "reviewer@torobrent.local"
DEVELOPMENT_REVIEWER_PASSWORD = "dev-reviewer"
DEVELOPMENT_SUPPORT_OPERATOR_EMAIL = "support@torobrent.local"
DEVELOPMENT_SUPPORT_OPERATOR_PASSWORD = "dev-support"
VERIFIED_AT = datetime(2026, 1, 1, tzinfo=UTC)


@dataclass(frozen=True)
class DevelopmentPersonas:
    submitter: User
    operator: User
    renter: User
    renter_two: User
    reviewer: User
    support_operator: User
    source_one: User
    source_two: User


def _get_or_create_persona(
    *,
    email: str,
    password: str,
    display_name: str,
    operator: bool,
    submitter: bool,
    phone: str | None = None,
) -> User:
    user, created = User.objects.get_or_create(
        email=email,
        defaults={
            "email_verified_at": VERIFIED_AT,
            "is_active": True,
            "is_staff": operator,
            "is_superuser": operator,
            "is_submitter": submitter,
            "display_name": display_name,
            "phone": phone,
            "phone_verified_at": VERIFIED_AT if phone else None,
        },
    )
    if created:
        user.set_password(password)
        user.save(update_fields=("password",))
    return user


def seed_development_personas() -> DevelopmentPersonas:
    submitter = _get_or_create_persona(
        email=DEVELOPMENT_SUBMITTER_EMAIL,
        password=DEVELOPMENT_SUBMITTER_PASSWORD,
        display_name="مالک آزمایشی",
        operator=False,
        submitter=True,
        phone=DEVELOPMENT_SUBMITTER_PHONE,
    )
    operator = _get_or_create_persona(
        email=DEVELOPMENT_OPERATOR_EMAIL,
        password=DEVELOPMENT_OPERATOR_PASSWORD,
        display_name="مدیر کامل آزمایشی",
        operator=True,
        submitter=False,
    )
    renter = _get_or_create_persona(
        email=DEVELOPMENT_RENTER_EMAIL,
        password=DEVELOPMENT_RENTER_PASSWORD,
        display_name="مستاجر آزمایشی",
        operator=False,
        submitter=False,
    )
    renter_two = _get_or_create_persona(
        email=DEVELOPMENT_RENTER_TWO_EMAIL,
        password=DEVELOPMENT_RENTER_TWO_PASSWORD,
        display_name="مستاجر دوم آزمایشی",
        operator=False,
        submitter=False,
    )
    reviewer = _get_or_create_persona(
        email=DEVELOPMENT_REVIEWER_EMAIL,
        password=DEVELOPMENT_REVIEWER_PASSWORD,
        display_name="بررسی کننده آزمایشی",
        operator=False,
        submitter=False,
    )
    support_operator = _get_or_create_persona(
        email=DEVELOPMENT_SUPPORT_OPERATOR_EMAIL,
        password=DEVELOPMENT_SUPPORT_OPERATOR_PASSWORD,
        display_name="پشتیبان آزمایشی",
        operator=False,
        submitter=False,
    )
    for account, group_name in (
        (reviewer, "Submission Reviewer"),
        (support_operator, "Support Operator"),
    ):
        group = Group.objects.get(name=group_name)
        account.groups.add(group)
        if not account.is_staff:
            account.is_staff = True
            account.save(update_fields=("is_staff",))
    return DevelopmentPersonas(
        submitter=submitter,
        operator=operator,
        renter=renter,
        renter_two=renter_two,
        reviewer=reviewer,
        support_operator=support_operator,
        source_one=_get_or_create_persona(
            email="source-one@torobrent.local",
            password="dev-source-one",
            display_name="نماینده منبع آزمایشی یک",
            operator=False,
            submitter=True,
            phone="09120000001",
        ),
        source_two=_get_or_create_persona(
            email="source-two@torobrent.local",
            password="dev-source-two",
            display_name="نماینده منبع آزمایشی دو",
            operator=False,
            submitter=True,
            phone="09120000002",
        ),
    )
