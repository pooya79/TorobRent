from __future__ import annotations

from django.db.models import Q, QuerySet

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User

from .models import IntakeKind, SupportRequest

PRIVACY_SENSITIVE_INTAKE_KINDS = (
    IntakeKind.ACCOUNT_DELETION,
    IntakeKind.PUBLIC_CONTACT_REMOVAL,
)


def support_requests_visible_to(*, operator: User) -> QuerySet[SupportRequest]:
    requests = SupportRequest.objects.exclude(
        Q(submitter=operator) | Q(submitter__isnull=True, email__iexact=operator.email)
    )
    if not has_capability(operator, OperatorCapability.HANDLE_PRIVACY_REQUESTS):
        requests = requests.exclude(intake_kind__in=PRIVACY_SENSITIVE_INTAKE_KINDS)
    return requests
