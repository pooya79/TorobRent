from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User

from .models import (
    SupportRequest,
    SupportRequestEvent,
    SupportRequestEventType,
    SupportRequestStatus,
)
from .selectors import PRIVACY_SENSITIVE_INTAKE_KINDS


class SupportRequestConflict(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _ensure_operator_may_handle(*, support_request: SupportRequest, actor: User) -> None:
    handles_general = has_capability(actor, OperatorCapability.HANDLE_SUPPORT)
    handles_privacy = has_capability(actor, OperatorCapability.HANDLE_PRIVACY_REQUESTS)
    if not handles_general and not handles_privacy:
        raise ValidationError("Support capability is required to handle a Support Request.")
    owns_request = support_request.submitter_id == actor.id
    email_matches = (
        support_request.submitter_id is None
        and support_request.email.casefold() == actor.email.casefold()
    )
    if owns_request or email_matches:
        raise ValidationError("A Support Operator cannot handle their own Support Request.")
    privacy_sensitive = support_request.intake_kind in PRIVACY_SENSITIVE_INTAKE_KINDS
    if privacy_sensitive and not handles_privacy:
        raise ValidationError("Privacy Support capability is required for this Intake Kind.")


def _record_assignment_transition(
    *,
    support_request: SupportRequest,
    actor: User,
    event_type: SupportRequestEventType,
    new_state: SupportRequestStatus,
    reason: str = "",
) -> SupportRequest:
    prior_state = support_request.status
    if new_state == SupportRequestStatus.IN_PROGRESS:
        support_request.assignee = actor
        support_request.assigned_at = timezone.now()
    else:
        support_request.assignee = None
        support_request.assigned_at = None
    support_request.status = new_state
    support_request.save(update_fields=("status", "assignee", "assigned_at", "updated_at"))
    SupportRequestEvent.objects.create(
        support_request=support_request,
        actor=actor,
        event_type=event_type,
        prior_state=prior_state,
        new_state=new_state,
        reason=reason,
    )
    return support_request


@transaction.atomic
def claim_support_request(*, support_request: SupportRequest, actor: User) -> SupportRequest:
    support_request = SupportRequest.objects.select_for_update().get(id=support_request.id)
    _ensure_operator_may_handle(support_request=support_request, actor=actor)
    if (
        support_request.status != SupportRequestStatus.OPEN
        or support_request.assignee_id is not None
    ):
        raise SupportRequestConflict(
            "support_request_already_assigned",
            "This Support Request is no longer available to claim.",
        )
    return _record_assignment_transition(
        support_request=support_request,
        actor=actor,
        event_type=SupportRequestEventType.ASSIGNED,
        new_state=SupportRequestStatus.IN_PROGRESS,
    )


@transaction.atomic
def release_support_request(*, support_request: SupportRequest, actor: User) -> None:
    support_request = SupportRequest.objects.select_for_update().get(id=support_request.id)
    _ensure_operator_may_handle(support_request=support_request, actor=actor)
    if (
        support_request.status != SupportRequestStatus.IN_PROGRESS
        or support_request.assignee_id != actor.id
    ):
        raise SupportRequestConflict(
            "support_request_assignment_required",
            "Only the assigned Support Operator may release this Support Request.",
        )
    _record_assignment_transition(
        support_request=support_request,
        actor=actor,
        event_type=SupportRequestEventType.RELEASED,
        new_state=SupportRequestStatus.OPEN,
        reason="Released by the assigned Support Operator.",
    )
