from __future__ import annotations

from datetime import timedelta

from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User

from .models import (
    IntakeKind,
    SupportClassification,
    SupportPriority,
    SupportRequest,
    SupportRequestStatus,
    SupportRequiredCapability,
)

OPERATOR_AGING_AFTER = timedelta(hours=48)

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


def support_request_is_account_deletion(support_request: SupportRequest) -> bool:
    return support_request.classification == SupportClassification.ACCOUNT_DELETION or (
        support_request.classification == SupportClassification.UNCLASSIFIED
        and support_request.intake_kind == IntakeKind.ACCOUNT_DELETION
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


def support_workload_summary(*, operator: User) -> dict[str, int]:
    actionable = support_requests_visible_to(operator=operator).exclude(
        status=SupportRequestStatus.RESOLVED
    )
    return {
        "unclaimed_count": actionable.filter(assignee__isnull=True).count(),
        "assigned_to_me_count": actionable.filter(assignee=operator).count(),
        "urgent_count": actionable.filter(priority=SupportPriority.URGENT).count(),
        "aging_count": actionable.filter(
            created_at__lte=timezone.now() - OPERATOR_AGING_AFTER
        ).count(),
        "aging_after_hours": int(OPERATOR_AGING_AFTER.total_seconds() // 3600),
    }
