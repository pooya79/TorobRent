from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User

from .models import (
    IntakeKind,
    SupportClassification,
    SupportPriority,
    SupportRequest,
    SupportRequestEvent,
    SupportRequestEventType,
    SupportRequestStatus,
    SupportRequiredCapability,
)
from .selectors import (
    operator_has_required_support_capability,
    support_request_requires_privacy_capability,
)


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
    if support_request_requires_privacy_capability(support_request) and not handles_privacy:
        raise ValidationError("Privacy Support capability is required for this Intake Kind.")
    if not operator_has_required_support_capability(
        support_request=support_request, operator=actor
    ):
        raise ValidationError("The escalation's required Operator Capability is missing.")


def create_support_request(
    *,
    submitter: User | None,
    name: str,
    email: str,
    intake_kind: IntakeKind,
    message: str,
) -> SupportRequest:
    priority = SupportPriority.NORMAL
    priority_locked = False
    if intake_kind == IntakeKind.PUBLIC_CONTACT_REMOVAL:
        priority = SupportPriority.URGENT
        priority_locked = True
    return SupportRequest.objects.create(
        submitter=submitter,
        name=name,
        email=email,
        intake_kind=intake_kind,
        message=message,
        priority=priority,
        priority_locked=priority_locked,
    )


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
        support_request.status not in (SupportRequestStatus.OPEN, SupportRequestStatus.ESCALATED)
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


@transaction.atomic
def reassign_abandoned_support_request(
    *,
    support_request: SupportRequest,
    actor: User,
    new_assignee: User,
    reason: str,
) -> SupportRequest:
    support_request = (
        SupportRequest.objects
        .select_for_update()
        .select_related("assignee")
        .get(id=support_request.id)
    )
    _ensure_operator_may_handle(support_request=support_request, actor=actor)
    if not has_capability(actor, OperatorCapability.MANAGE_OPERATOR_QUEUES):
        raise ValidationError("Queue-management capability is required to reassign work.")
    if (
        support_request.status != SupportRequestStatus.IN_PROGRESS
        or support_request.assignee is None
    ):
        raise SupportRequestConflict(
            "support_request_assignment_required",
            "Only an assigned Support Request can be reassigned.",
        )
    try:
        _ensure_operator_may_handle(
            support_request=support_request,
            actor=support_request.assignee,
        )
    except ValidationError:
        pass
    else:
        raise SupportRequestConflict(
            "support_request_assignment_not_abandoned",
            "The current assignee still has access to this Support Request.",
        )
    _ensure_operator_may_handle(support_request=support_request, actor=new_assignee)
    reason = reason.strip()
    if not reason:
        raise ValidationError("A reason is required to reassign abandoned work.")
    prior_assignee = support_request.assignee
    support_request.assignee = new_assignee
    support_request.assigned_at = timezone.now()
    support_request.save(update_fields=("assignee", "assigned_at", "updated_at"))
    SupportRequestEvent.objects.create(
        support_request=support_request,
        actor=actor,
        event_type=SupportRequestEventType.REASSIGNED,
        prior_state=SupportRequestStatus.IN_PROGRESS,
        new_state=SupportRequestStatus.IN_PROGRESS,
        prior_assignee=prior_assignee,
        new_assignee=new_assignee,
        reason=reason,
    )
    return support_request


@transaction.atomic
def triage_support_request(
    *,
    support_request: SupportRequest,
    actor: User,
    classification: SupportClassification | None,
    priority: SupportPriority | None,
    new_status: SupportRequestStatus | None,
    escalation_destination: str,
    required_capability: SupportRequiredCapability | None,
    reason: str,
) -> None:
    support_request = SupportRequest.objects.select_for_update().get(id=support_request.id)
    _ensure_operator_may_handle(support_request=support_request, actor=actor)
    prior_classification = support_request.classification
    prior_priority = support_request.priority
    if classification is not None and prior_classification == classification:
        raise SupportRequestConflict(
            "support_classification_unchanged",
            "The Support Request already has this Support Classification.",
        )
    if priority is not None and prior_priority == priority:
        raise SupportRequestConflict(
            "support_priority_unchanged",
            "The Support Request already has this priority.",
        )
    if priority == SupportPriority.NORMAL and support_request.priority_locked:
        raise SupportRequestConflict(
            "support_priority_cannot_be_lowered",
            "Automatically urgent public-contact-removal requests cannot be downgraded.",
        )
    if new_status is not None:
        if support_request.status == SupportRequestStatus.RESOLVED:
            raise SupportRequestConflict(
                "resolved_support_request_cannot_be_escalated",
                "A resolved Support Request cannot be escalated.",
            )
        if support_request.status == SupportRequestStatus.ESCALATED:
            raise SupportRequestConflict(
                "support_request_already_escalated",
                "The Support Request is already escalated.",
            )
        escalation_destination = escalation_destination.strip()
        if not escalation_destination and required_capability is None:
            raise ValidationError("An escalation destination or required capability is required.")
    reason = reason.strip()
    requires_reason = bool(
        priority is not None
        or new_status is not None
        or (
            classification is not None
            and (
                prior_classification != SupportClassification.UNCLASSIFIED
                or support_request_requires_privacy_capability(support_request)
                or classification
                in (SupportClassification.PRIVACY, SupportClassification.ACCOUNT_DELETION)
            )
        )
    )
    if requires_reason and not reason:
        raise ValidationError("A reason is required for this Support triage change.")
    update_fields = ["updated_at"]
    events: list[SupportRequestEvent] = []
    if classification is not None:
        support_request.classification = classification
        update_fields.append("classification")
        events.append(
            SupportRequestEvent(
                support_request=support_request,
                actor=actor,
                event_type=SupportRequestEventType.CLASSIFIED,
                prior_state=support_request.status,
                new_state=support_request.status,
                prior_classification=prior_classification,
                new_classification=classification,
                reason=reason,
            )
        )
    if priority is not None:
        support_request.priority = priority
        update_fields.append("priority")
        events.append(
            SupportRequestEvent(
                support_request=support_request,
                actor=actor,
                event_type=SupportRequestEventType.PRIORITY_CHANGED,
                prior_state=support_request.status,
                new_state=support_request.status,
                prior_priority=prior_priority,
                new_priority=priority,
                reason=reason,
            )
        )
    if new_status is not None:
        prior_state = support_request.status
        support_request.status = new_status
        support_request.assignee = None
        support_request.assigned_at = None
        support_request.escalation_destination = escalation_destination
        support_request.required_capability = required_capability or ""
        update_fields.extend((
            "status",
            "assignee",
            "assigned_at",
            "escalation_destination",
            "required_capability",
        ))
        events.append(
            SupportRequestEvent(
                support_request=support_request,
                actor=actor,
                event_type=SupportRequestEventType.ESCALATED,
                prior_state=prior_state,
                new_state=new_status,
                escalation_destination=escalation_destination,
                required_capability=required_capability or "",
                reason=reason,
            )
        )
    support_request.save(update_fields=update_fields)
    for event in events:
        event.save()
