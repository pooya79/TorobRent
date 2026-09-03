from datetime import datetime, timedelta
from typing import cast
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User

from .models import (
    ExternalContactChannel,
    IdentityVerificationMethod,
    IntakeKind,
    PrivacyActionType,
    SupportClassification,
    SupportExternalContact,
    SupportIdentityVerification,
    SupportMessage,
    SupportMessageAuthor,
    SupportPriority,
    SupportPrivacyAction,
    SupportRequest,
    SupportRequestEvent,
    SupportRequestEventType,
    SupportRequestNote,
    SupportRequestStatus,
    SupportRequiredCapability,
    SupportResolutionCategory,
)
from .selectors import (
    operator_has_required_support_capability,
    support_request_is_account_deletion,
    support_request_requires_privacy_capability,
)


class SupportRequestConflict(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _ensure_assigned_operator(*, support_request: SupportRequest, actor: User) -> None:
    _ensure_operator_may_handle(support_request=support_request, actor=actor)
    if (
        support_request.status != SupportRequestStatus.IN_PROGRESS
        or support_request.assignee_id != actor.id
    ):
        raise SupportRequestConflict(
            "support_request_assignment_required",
            "Only the assigned Operator may update this Support Request.",
        )


def _ensure_operator_may_handle(*, support_request: SupportRequest, actor: User) -> None:
    handles_general = has_capability(actor, OperatorCapability.HANDLE_SUPPORT)
    handles_privacy = has_capability(actor, OperatorCapability.HANDLE_PRIVACY_REQUESTS)
    if not handles_general and not handles_privacy:
        raise ValidationError("Support capability is required to handle a Support Request.")
    owns_request = support_request.submitter_id == actor.id
    email_matches = (
        support_request.submitter_id is None
        and actor.email is not None
        and support_request.email.casefold() == actor.email.casefold()
    )
    if owns_request or email_matches:
        raise ValidationError("An Operator cannot handle their own Support Request.")
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
    subject: str = "",
) -> SupportRequest:
    priority = SupportPriority.NORMAL
    priority_locked = False
    if intake_kind == IntakeKind.PUBLIC_CONTACT_REMOVAL:
        priority = SupportPriority.URGENT
        priority_locked = True
    now = timezone.now()
    support_request = SupportRequest.objects.create(
        submitter=submitter,
        name=name,
        email=email,
        intake_kind=intake_kind,
        message=message,
        subject=subject,
        requester_read_at=now if submitter is not None else None,
        account_linked_at_intake=submitter is not None,
        priority=priority,
        priority_locked=priority_locked,
    )
    if submitter is not None:
        SupportMessage.objects.create(
            support_request=support_request,
            author=submitter,
            author_kind=SupportMessageAuthor.REQUESTER,
            is_initial=True,
            body=message,
        )
        support_request.requester_read_at = support_request.public_updated_at
        support_request.save(update_fields=("requester_read_at",))
    return support_request


@transaction.atomic
def add_support_message(
    *, support_request: SupportRequest, actor: User, body: str, author_kind: SupportMessageAuthor
) -> SupportMessage:
    support_request = SupportRequest.objects.select_for_update().get(id=support_request.id)
    if author_kind == SupportMessageAuthor.OPERATOR:
        _ensure_assigned_operator(support_request=support_request, actor=actor)
    elif support_request.submitter_id != actor.id:
        raise ValidationError("Only the requester may reply to this Support Request.")

    now = timezone.now()
    if (
        author_kind == SupportMessageAuthor.REQUESTER
        and support_request.status == SupportRequestStatus.RESOLVED
    ):
        if support_request.resolved_at is None or support_request.resolved_at < now - timedelta(
            days=14
        ):
            raise SupportRequestConflict(
                "support_request_reply_window_expired",
                "Create a new Support Request to continue after 14 days.",
            )
        prior_state = support_request.status
        support_request.status = SupportRequestStatus.OPEN
        support_request.assignee = None
        support_request.assigned_at = None
        support_request.resolved_by = None
        support_request.resolved_at = None
        support_request.resolution_category = None
        support_request.resolution_summary = ""
        SupportRequestEvent.objects.create(
            support_request=support_request,
            actor=actor,
            event_type=SupportRequestEventType.REOPENED,
            prior_state=prior_state,
            new_state=SupportRequestStatus.OPEN,
            classification=support_request.classification,
        )

    body = body.strip()
    if not body:
        raise ValidationError("A Support message is required.")
    message = SupportMessage.objects.create(
        support_request=support_request,
        author=actor,
        author_kind=author_kind,
        body=body,
    )
    support_request.updated_at = now
    support_request.public_updated_at = now
    if author_kind == SupportMessageAuthor.REQUESTER:
        support_request.requester_read_at = now
    support_request.save()
    return message


@transaction.atomic
def edit_support_message(
    *, support_message: SupportMessage, actor: User, body: str
) -> SupportMessage:
    support_message = (
        SupportMessage.objects
        .select_for_update()
        .select_related("support_request")
        .get(id=support_message.id)
    )
    if support_message.author_id != actor.id:
        raise ValidationError("Only the author may edit this Support message.")
    if support_message.author_kind == SupportMessageAuthor.OPERATOR:
        _ensure_assigned_operator(support_request=support_message.support_request, actor=actor)
    now = timezone.now()
    if support_message.created_at < now - timedelta(minutes=15):
        raise SupportRequestConflict(
            "support_message_edit_window_expired",
            "Support messages can only be edited for 15 minutes.",
        )
    body = body.strip()
    if not body:
        raise ValidationError("A Support message is required.")
    support_message.body = body
    support_message.edited_at = now
    support_message.save(update_fields=("body", "edited_at"))
    support_request = support_message.support_request
    support_request.public_updated_at = now
    update_fields = ["public_updated_at", "requester_read_at", "updated_at"]
    if support_message.is_initial:
        support_request.message = body
        update_fields.append("message")
    if support_message.author_kind == SupportMessageAuthor.REQUESTER:
        support_request.requester_read_at = now
    support_request.save(update_fields=update_fields)
    return support_message


@transaction.atomic
def redact_support_request_content(
    *, support_request: SupportRequest, actor: User
) -> SupportRequest:
    if not actor.is_superuser:
        raise ValidationError("Only a superuser may redact personal Support Request content.")
    support_request = SupportRequest.objects.select_for_update().get(id=support_request.id)
    if support_request.personal_content_redacted_at is not None:
        return support_request

    support_request.submitter = None
    support_request.name = "Former requester"
    support_request.email = f"redacted-{support_request.id.hex}@anonymized.invalid"
    support_request.message = "[Personal Support Request content redacted]"
    support_request.operator_note = ""
    support_request.resolution_summary = "[Personal content redacted]"
    support_request.personal_content_redacted_at = timezone.now()
    support_request.save(
        update_fields=(
            "submitter",
            "name",
            "email",
            "message",
            "operator_note",
            "resolution_summary",
            "personal_content_redacted_at",
            "updated_at",
        )
    )
    # These models are append-only for operational facts. This privileged privacy action uses each
    # plain base manager to replace only fields designated as personal content; identities,
    # timestamps, state, classification, routing, outcomes, and correction links remain untouched.
    SupportRequestEvent._base_manager.filter(support_request=support_request).update(
        resolution_summary="[Personal content redacted]",
    )
    SupportRequestNote._base_manager.filter(support_request=support_request).update(
        body="[Personal content redacted]"
    )
    SupportExternalContact._base_manager.filter(support_request=support_request).update(
        summary="[Personal content redacted]",
    )
    SupportIdentityVerification._base_manager.filter(support_request=support_request).update(
        summary="[Personal content redacted]"
    )
    SupportMessage.objects.filter(support_request=support_request).update(
        body="[Personal content redacted]",
    )
    SupportMessage.objects.filter(
        support_request=support_request,
        author_kind=SupportMessageAuthor.REQUESTER,
    ).update(
        author=None,
    )
    SupportPrivacyAction._base_manager.filter(support_request=support_request).update(
        summary="[Personal content redacted]"
    )
    SupportRequestEvent.objects.create(
        support_request=support_request,
        actor=actor,
        event_type=SupportRequestEventType.PERSONAL_CONTENT_REDACTED,
        prior_state=support_request.status,
        new_state=support_request.status,
        classification=support_request.classification,
        reason="Personal Support Request content redacted through privileged administration.",
    )
    return support_request


@transaction.atomic
def add_support_request_note(
    *,
    support_request: SupportRequest,
    actor: User,
    body: str,
    corrects_note_id: UUID | None,
) -> SupportRequestNote:
    support_request = SupportRequest.objects.select_for_update().get(id=support_request.id)
    _ensure_assigned_operator(support_request=support_request, actor=actor)
    body = body.strip()
    if not body:
        raise ValidationError("An internal note is required.")
    corrects_note = None
    if corrects_note_id is not None:
        try:
            corrects_note = support_request.notes.get(id=corrects_note_id)
        except SupportRequestNote.DoesNotExist:
            raise ValidationError(
                "A correction must refer to a note on this Support Request."
            ) from None
    note = cast(
        SupportRequestNote,
        SupportRequestNote.objects.create(
            support_request=support_request,
            actor=actor,
            body=body,
            corrects_note=corrects_note,
        ),
    )
    SupportRequestEvent.objects.create(
        support_request=support_request,
        actor=actor,
        event_type=SupportRequestEventType.NOTE_ADDED,
        prior_state=support_request.status,
        new_state=support_request.status,
        classification=support_request.classification,
        reason=body,
    )
    return note


@transaction.atomic
def record_external_contact(
    *,
    support_request: SupportRequest,
    actor: User,
    channel: ExternalContactChannel,
    occurred_at: datetime,
    outcome: str,
    summary: str,
) -> SupportExternalContact:
    support_request = SupportRequest.objects.select_for_update().get(id=support_request.id)
    _ensure_assigned_operator(support_request=support_request, actor=actor)
    if occurred_at > timezone.now():
        raise ValidationError("External-contact time cannot be in the future.")
    outcome = outcome.strip()
    summary = summary.strip()
    if not outcome or not summary:
        raise ValidationError("An external-contact outcome and concise summary are required.")
    contact = cast(
        SupportExternalContact,
        SupportExternalContact.objects.create(
            support_request=support_request,
            actor=actor,
            channel=channel,
            occurred_at=occurred_at,
            outcome=outcome,
            summary=summary,
        ),
    )
    SupportRequestEvent.objects.create(
        support_request=support_request,
        actor=actor,
        event_type=SupportRequestEventType.EXTERNAL_CONTACT_RECORDED,
        prior_state=support_request.status,
        new_state=support_request.status,
        classification=support_request.classification,
        reason=summary,
    )
    return contact


@transaction.atomic
def record_identity_verification(
    *,
    support_request: SupportRequest,
    actor: User,
    method: IdentityVerificationMethod,
    verified_at: datetime,
    summary: str,
) -> SupportIdentityVerification:
    support_request = SupportRequest.objects.select_for_update().get(id=support_request.id)
    _ensure_assigned_operator(support_request=support_request, actor=actor)
    if not support_request_requires_privacy_capability(support_request):
        raise ValidationError("Identity verification can only be recorded for privacy work.")
    if verified_at > timezone.now():
        raise ValidationError("Identity-verification time cannot be in the future.")
    summary = summary.strip()
    if not summary:
        raise ValidationError("A concise identity-verification summary is required.")
    verification = cast(
        SupportIdentityVerification,
        SupportIdentityVerification.objects.create(
            support_request=support_request,
            actor=actor,
            method=method,
            verified_at=verified_at,
            summary=summary,
        ),
    )
    SupportRequestEvent.objects.create(
        support_request=support_request,
        actor=actor,
        event_type=SupportRequestEventType.IDENTITY_VERIFIED,
        prior_state=support_request.status,
        new_state=support_request.status,
        classification=support_request.classification,
        reason=summary,
    )
    return verification


@transaction.atomic
def record_privacy_action(
    *,
    support_request: SupportRequest,
    actor: User,
    action: PrivacyActionType,
    completed_at: datetime,
    summary: str,
) -> SupportPrivacyAction:
    support_request = SupportRequest.objects.select_for_update().get(id=support_request.id)
    _ensure_assigned_operator(support_request=support_request, actor=actor)
    if not support_request_requires_privacy_capability(support_request):
        raise ValidationError("Privacy action completion can only be recorded for privacy work.")
    if completed_at > timezone.now():
        raise ValidationError("Privacy-action completion time cannot be in the future.")
    if (
        action == PrivacyActionType.PERMANENT_ACCOUNT_ACTION
        and not support_request.account_linked_at_intake
        and not support_request.identity_verifications.filter(
            verified_at__lte=completed_at
        ).exists()
    ):
        raise ValidationError(
            "A permanent account action requires an account-linked request or recorded "
            "out-of-band identity verification."
        )
    summary = summary.strip()
    if not summary:
        raise ValidationError("A concise privacy-action summary is required.")
    privacy_action = cast(
        SupportPrivacyAction,
        SupportPrivacyAction.objects.create(
            support_request=support_request,
            actor=actor,
            action=action,
            completed_at=completed_at,
            summary=summary,
        ),
    )
    SupportRequestEvent.objects.create(
        support_request=support_request,
        actor=actor,
        event_type=SupportRequestEventType.PRIVACY_ACTION_RECORDED,
        prior_state=support_request.status,
        new_state=support_request.status,
        classification=support_request.classification,
        reason=summary,
    )
    return privacy_action


def _record_assignment_transition(
    *,
    support_request: SupportRequest,
    actor: User,
    event_type: SupportRequestEventType,
    new_state: SupportRequestStatus,
    reason: str = "",
) -> SupportRequest:
    prior_state = support_request.status
    prior_assignee = support_request.assignee
    if new_state == SupportRequestStatus.IN_PROGRESS:
        support_request.assignee = actor
        support_request.assigned_at = timezone.now()
    else:
        support_request.assignee = None
        support_request.assigned_at = None
    support_request.status = new_state
    support_request.public_updated_at = timezone.now()
    support_request.save(
        update_fields=("status", "assignee", "assigned_at", "public_updated_at", "updated_at")
    )
    SupportRequestEvent.objects.create(
        support_request=support_request,
        actor=actor,
        event_type=event_type,
        prior_state=prior_state,
        new_state=new_state,
        classification=support_request.classification,
        prior_assignee=prior_assignee,
        new_assignee=support_request.assignee,
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
            "Only the assigned Operator may release this Support Request.",
        )
    _record_assignment_transition(
        support_request=support_request,
        actor=actor,
        event_type=SupportRequestEventType.RELEASED,
        new_state=SupportRequestStatus.OPEN,
        reason="Released by the assigned Operator.",
    )


@transaction.atomic
def reassign_abandoned_support_request(
    *,
    support_request: SupportRequest,
    actor: User,
    new_assignee: User,
    reason: str,
) -> SupportRequest:
    support_request = SupportRequest.objects.select_for_update().get(id=support_request.id)
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
        classification=support_request.classification,
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
        if new_status != SupportRequestStatus.ESCALATED:
            raise SupportRequestConflict(
                "invalid_support_request_transition",
                "Support triage can only transition a Support Request to escalated.",
            )
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
                classification=classification,
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
                classification=support_request.classification,
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
                classification=support_request.classification,
                escalation_destination=escalation_destination,
                required_capability=required_capability or "",
                reason=reason,
            )
        )
    support_request.save(update_fields=update_fields)
    for event in events:
        event.save()


@transaction.atomic
def resolve_support_request(
    *,
    support_request: SupportRequest,
    actor: User,
    category: SupportResolutionCategory,
    summary: str,
) -> SupportRequest:
    support_request = SupportRequest.objects.select_for_update().get(id=support_request.id)
    _ensure_assigned_operator(support_request=support_request, actor=actor)
    summary = summary.strip()
    if not summary:
        raise ValidationError("A concise internal resolution summary is required.")
    records_permanent_account_action = category == SupportResolutionCategory.ACTION_COMPLETED and (
        support_request_is_account_deletion(support_request)
    )
    if records_permanent_account_action and (
        not support_request.account_linked_at_intake
        and not support_request.identity_verifications.exists()
    ):
        raise ValidationError(
            "Resolving a permanent account action requires an account-linked request or "
            "recorded out-of-band identity verification."
        )
    if (
        records_permanent_account_action
        and not support_request.privacy_actions.filter(
            action=PrivacyActionType.PERMANENT_ACCOUNT_ACTION
        ).exists()
    ):
        raise ValidationError(
            "Record completion of the privileged permanent account action before resolving."
        )
    prior_assignee = support_request.assignee
    support_request.status = SupportRequestStatus.RESOLVED
    support_request.assignee = None
    support_request.assigned_at = None
    support_request.resolved_by = actor
    support_request.resolved_at = timezone.now()
    support_request.resolution_category = category
    support_request.resolution_summary = summary
    support_request.public_updated_at = timezone.now()
    support_request.save(
        update_fields=(
            "status",
            "assignee",
            "assigned_at",
            "resolved_by",
            "resolved_at",
            "resolution_category",
            "resolution_summary",
            "public_updated_at",
            "updated_at",
        )
    )
    SupportRequestEvent.objects.create(
        support_request=support_request,
        actor=actor,
        event_type=SupportRequestEventType.RESOLVED,
        prior_state=SupportRequestStatus.IN_PROGRESS,
        new_state=SupportRequestStatus.RESOLVED,
        classification=support_request.classification,
        prior_assignee=prior_assignee,
        resolution_category=category,
        resolution_summary=summary,
    )
    return support_request


@transaction.atomic
def reopen_support_request(
    *,
    support_request: SupportRequest,
    actor: User,
    reason: str,
) -> SupportRequest:
    support_request = SupportRequest.objects.select_for_update().get(id=support_request.id)
    _ensure_operator_may_handle(support_request=support_request, actor=actor)
    if support_request.status != SupportRequestStatus.RESOLVED:
        raise SupportRequestConflict(
            "support_request_not_resolved",
            "Only a resolved Support Request can be reopened.",
        )
    reason = reason.strip()
    if not reason:
        raise ValidationError("A reason is required to reopen a Support Request.")
    resolution_event = (
        support_request.events
        .filter(event_type=SupportRequestEventType.RESOLVED)
        .select_related("prior_assignee")
        .order_by("-created_at", "-id")
        .first()
    )
    prior_assignee = resolution_event.prior_assignee if resolution_event else None
    restored_assignee = prior_assignee
    if restored_assignee is not None:
        try:
            _ensure_operator_may_handle(
                support_request=support_request,
                actor=restored_assignee,
            )
        except ValidationError:
            restored_assignee = None
    prior_category = support_request.resolution_category
    prior_summary = support_request.resolution_summary
    support_request.status = (
        SupportRequestStatus.IN_PROGRESS
        if restored_assignee is not None
        else SupportRequestStatus.OPEN
    )
    support_request.assignee = restored_assignee
    support_request.assigned_at = timezone.now() if restored_assignee is not None else None
    support_request.resolved_by = None
    support_request.resolved_at = None
    support_request.resolution_category = None
    support_request.resolution_summary = ""
    support_request.public_updated_at = timezone.now()
    support_request.save(
        update_fields=(
            "status",
            "assignee",
            "assigned_at",
            "resolved_by",
            "resolved_at",
            "resolution_category",
            "resolution_summary",
            "public_updated_at",
            "updated_at",
        )
    )
    SupportRequestEvent.objects.create(
        support_request=support_request,
        actor=actor,
        event_type=SupportRequestEventType.REOPENED,
        prior_state=SupportRequestStatus.RESOLVED,
        new_state=support_request.status,
        classification=support_request.classification,
        prior_assignee=prior_assignee,
        new_assignee=restored_assignee,
        reason=reason,
        resolution_category=prior_category,
        resolution_summary=prior_summary,
    )
    return support_request
