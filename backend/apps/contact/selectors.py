from __future__ import annotations

from django.db.models import Q, QuerySet

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User

from .models import (
    IntakeKind,
    SupportClassification,
    SupportRequest,
    SupportRequiredCapability,
)

PRIVACY_SENSITIVE_INTAKE_KINDS = (
    IntakeKind.ACCOUNT_DELETION,
    IntakeKind.PUBLIC_CONTACT_REMOVAL,
)
PRIVACY_SENSITIVE_CLASSIFICATIONS = (
    SupportClassification.PRIVACY,
    SupportClassification.ACCOUNT_DELETION,
)


def _privacy_sensitive_support_request_condition() -> Q:
    return Q(classification__in=PRIVACY_SENSITIVE_CLASSIFICATIONS) | Q(
        classification=SupportClassification.UNCLASSIFIED,
        intake_kind__in=PRIVACY_SENSITIVE_INTAKE_KINDS,
    )


def support_request_requires_privacy_capability(support_request: SupportRequest) -> bool:
    return (
        SupportRequest.objects
        .filter(id=support_request.id)
        .filter(_privacy_sensitive_support_request_condition())
        .exists()
    )


def operator_has_required_support_capability(
    *, support_request: SupportRequest, operator: User
) -> bool:
    if not support_request.required_capability:
        return True
    return has_capability(operator, OperatorCapability(support_request.required_capability))


def support_requests_visible_to(*, operator: User) -> QuerySet[SupportRequest]:
    requests = SupportRequest.objects.exclude(
        Q(submitter=operator) | Q(submitter__isnull=True, email__iexact=operator.email)
    )
    if not has_capability(operator, OperatorCapability.HANDLE_PRIVACY_REQUESTS):
        requests = requests.exclude(_privacy_sensitive_support_request_condition())
    for required_capability in SupportRequiredCapability:
        if not has_capability(operator, OperatorCapability(required_capability.value)):
            requests = requests.exclude(required_capability=required_capability.value)
    return requests
