from __future__ import annotations

from typing import TYPE_CHECKING

from django.db import models

if TYPE_CHECKING:
    from .models import User


class OperatorCapability(models.TextChoices):
    HANDLE_PRIVACY_REQUESTS = "handle_privacy_requests", "Privacy Support handling"
    HANDLE_SUPPORT = "handle_support", "General Support handling"
    MANAGE_OPERATOR_QUEUES = "manage_operator_queues", "Operator queue management"
    REVIEW_SUBMISSIONS = "review_submissions", "Submission Review"


CAPABILITY_PERMISSIONS = {
    OperatorCapability.HANDLE_PRIVACY_REQUESTS: "accounts.handle_privacy_support_requests",
    OperatorCapability.HANDLE_SUPPORT: "accounts.handle_general_support_requests",
    OperatorCapability.MANAGE_OPERATOR_QUEUES: "accounts.manage_operator_queue",
    OperatorCapability.REVIEW_SUBMISSIONS: "submissions.review_submission",
}

MANAGED_OPERATOR_GROUPS = frozenset({
    "Submission Reviewer",
    "Submission Review Lead",
    "Support Operator",
    "Support Lead",
    "Privacy Operator",
    "Privacy Lead",
    "Operator Queue Manager",
})


def capabilities_for(user: User) -> list[OperatorCapability]:
    if not user.is_active or not user.email_verified:
        return []
    permissions = user.get_all_permissions()
    return [
        capability
        for capability, permission in CAPABILITY_PERMISSIONS.items()
        if permission in permissions
    ]


def has_capability(user: User, capability: OperatorCapability) -> bool:
    return bool(
        user.is_active and user.email_verified and user.has_perm(CAPABILITY_PERMISSIONS[capability])
    )
