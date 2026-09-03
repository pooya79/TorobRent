from concurrent.futures import ThreadPoolExecutor

import pytest
from django.contrib.auth.models import Permission
from django.core.exceptions import ValidationError
from django.db import IntegrityError, close_old_connections, connection, transaction
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.contact.models import (
    ExternalContactChannel,
    IdentityVerificationMethod,
    IntakeKind,
    PrivacyActionType,
    SupportClassification,
    SupportExternalContact,
    SupportIdentityVerification,
    SupportMessage,
    SupportMessageAuthor,
    SupportPrivacyAction,
    SupportRequest,
    SupportRequestEventType,
    SupportRequestNote,
    SupportRequestStatus,
    SupportResolutionCategory,
)
from apps.contact.services import (
    SupportRequestConflict,
    redact_support_request_content,
    resolve_support_request,
    triage_support_request,
)


def operator_with_support_capability(
    *, email: str = "operator@example.com", privacy: bool = False
) -> User:
    operator = User.objects.create_user(
        email=email,
        password="password",
        email_verified_at=timezone.now(),
    )
    permission = "handle_privacy_support_requests" if privacy else "handle_general_support_requests"
    operator.user_permissions.add(Permission.objects.get(codename=permission))
    return operator


def assigned_request(*, operator: User, **overrides: object) -> SupportRequest:
    values: dict[str, object] = {
        "name": "Requester",
        "email": "requester@example.com",
        "intake_kind": IntakeKind.GENERAL,
        "message": "Please help with this Support Request.",
        "status": SupportRequestStatus.IN_PROGRESS,
        "assignee": operator,
        "assigned_at": timezone.now(),
    }
    values.update(overrides)
    return SupportRequest.objects.create(**values)


@pytest.mark.django_db
def test_privileged_redaction_removes_personal_content_without_rewriting_operational_history(
    api_client: APIClient,
):
    administrator = User.objects.create_superuser(
        email="administrator@example.com", password="password"
    )
    operator = operator_with_support_capability()
    requester = User.objects.create_user(
        email="personal.requester@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    support_request = assigned_request(
        operator=operator,
        submitter=requester,
        name="Personal Requester Name",
        email="personal.requester@example.com",
        message="Personal Support Request content to remove.",
        escalation_destination="Privacy queue",
    )
    requester_message = SupportMessage.objects.create(
        support_request=support_request,
        author=requester,
        author_kind=SupportMessageAuthor.REQUESTER,
        body="A requester reply with personal content.",
    )
    operator_reply = SupportMessage.objects.create(
        support_request=support_request,
        author=operator,
        author_kind=SupportMessageAuthor.OPERATOR,
        body="An Operator reply containing personal content.",
    )
    requester_reopen_event = support_request.events.create(
        actor=requester,
        event_type=SupportRequestEventType.REOPENED,
        prior_state=SupportRequestStatus.RESOLVED,
        new_state=SupportRequestStatus.OPEN,
        classification=SupportClassification.GUIDANCE,
    )
    original_event = support_request.events.create(
        actor=operator,
        event_type=SupportRequestEventType.ASSIGNED,
        prior_state=SupportRequestStatus.OPEN,
        new_state=SupportRequestStatus.IN_PROGRESS,
        classification=SupportClassification.GUIDANCE,
        new_assignee=operator,
        reason="Routed to the privacy queue.",
        escalation_destination="Privacy queue",
        resolution_summary="Personal resolution content to remove.",
    )
    note = SupportRequestNote.objects.create(
        support_request=support_request,
        actor=operator,
        body="Personal note content to remove.",
    )
    external_contact = SupportExternalContact.objects.create(
        support_request=support_request,
        actor=operator,
        channel=ExternalContactChannel.EMAIL,
        occurred_at=timezone.now(),
        outcome="answered",
        summary="Personal external contact content to remove.",
    )
    identity_verification = SupportIdentityVerification.objects.create(
        support_request=support_request,
        actor=operator,
        method=IdentityVerificationMethod.OUT_OF_BAND,
        verified_at=timezone.now(),
        summary="Personal verification content to remove.",
    )
    privacy_action = SupportPrivacyAction.objects.create(
        support_request=support_request,
        actor=operator,
        action=PrivacyActionType.DEFENSIVE_CONTACT_REMOVAL,
        completed_at=timezone.now(),
        summary="Personal privacy action content to remove.",
    )
    original_created_at = original_event.created_at

    redact_support_request_content(support_request=support_request, actor=administrator)

    support_request.refresh_from_db()
    original_event.refresh_from_db()
    note.refresh_from_db()
    external_contact.refresh_from_db()
    identity_verification.refresh_from_db()
    privacy_action.refresh_from_db()
    requester_message.refresh_from_db()
    operator_reply.refresh_from_db()
    requester_reopen_event.refresh_from_db()
    assert support_request.name == "Former requester"
    assert "personal.requester@example.com" not in support_request.email
    assert support_request.message == "[Personal Support Request content redacted]"
    assert support_request.submitter is None
    assert support_request.assignee == operator
    assert support_request.status == SupportRequestStatus.IN_PROGRESS
    assert support_request.escalation_destination == "Privacy queue"
    assert support_request.personal_content_redacted_at is not None
    assert original_event.actor == operator
    assert original_event.created_at == original_created_at
    assert original_event.event_type == SupportRequestEventType.ASSIGNED
    assert original_event.new_state == SupportRequestStatus.IN_PROGRESS
    assert original_event.new_assignee == operator
    assert original_event.reason == "Routed to the privacy queue."
    assert original_event.escalation_destination == "Privacy queue"
    assert original_event.resolution_summary == "[Personal content redacted]"
    assert note.actor == operator
    assert note.body == "[Personal content redacted]"
    assert external_contact.channel == ExternalContactChannel.EMAIL
    assert external_contact.outcome == "answered"
    assert external_contact.summary == "[Personal content redacted]"
    assert identity_verification.method == IdentityVerificationMethod.OUT_OF_BAND
    assert identity_verification.summary == "[Personal content redacted]"
    assert privacy_action.action == PrivacyActionType.DEFENSIVE_CONTACT_REMOVAL
    assert privacy_action.summary == "[Personal content redacted]"
    assert requester_message.body == "[Personal content redacted]"
    assert requester_message.author is None
    assert requester_message.author_kind == SupportMessageAuthor.REQUESTER
    assert operator_reply.body == "[Personal content redacted]"
    assert operator_reply.author == operator
    assert requester_reopen_event.actor is None
    assert requester_reopen_event.event_type == SupportRequestEventType.REOPENED
    assert requester_reopen_event.prior_state == SupportRequestStatus.RESOLVED
    assert requester_reopen_event.new_state == SupportRequestStatus.OPEN
    requester.delete()
    assert SupportRequest.objects.filter(id=support_request.id).exists()
    assert SupportMessage.objects.filter(id=requester_message.id).exists()
    api_client.force_authenticate(operator)
    detail = api_client.get(f"/api/v1/operator/support-requests/{support_request.id}/")
    redacted_reopen = next(
        event
        for event in detail.data["history"]
        if str(event["id"]) == str(requester_reopen_event.id)
    )
    assert redacted_reopen["actor_id"] is None
    assert redacted_reopen["actor_reference"] is None
    assert redacted_reopen["actor_label"] is None
    assert redacted_reopen["actor_email"] is None
    assert support_request.events.filter(
        event_type=SupportRequestEventType.PERSONAL_CONTENT_REDACTED,
        actor=administrator,
    ).exists()


@pytest.mark.django_db
def test_operator_support_messages_require_an_author_identity():
    operator = operator_with_support_capability()
    support_request = assigned_request(operator=operator)

    with pytest.raises(IntegrityError), transaction.atomic():
        SupportMessage.objects.create(
            support_request=support_request,
            author=None,
            author_kind=SupportMessageAuthor.OPERATOR,
            body="An Operator reply must retain its author identity.",
        )


@pytest.mark.django_db
def test_account_deletion_cannot_bypass_redaction_for_a_legacy_linked_request():
    requester = User.objects.create_user(
        email="legacy.requester@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    support_request = SupportRequest.objects.create(
        submitter=requester,
        name="Legacy requester",
        email=requester.email,
        intake_kind=IntakeKind.GENERAL,
        message="Legacy personal content must be redacted before account deletion.",
        account_linked_at_intake=True,
    )

    with pytest.raises(ProtectedError):
        requester.delete()

    requester.refresh_from_db()
    support_request.refresh_from_db()
    assert support_request.submitter == requester
    assert support_request.personal_content_redacted_at is None
    assert support_request.message == (
        "Legacy personal content must be redacted before account deletion."
    )


@pytest.mark.django_db
def test_operator_adds_append_only_note_and_corrects_it_with_another_note(
    api_client: APIClient,
):
    operator = operator_with_support_capability()
    support_request = assigned_request(operator=operator)
    api_client.force_authenticate(operator)

    first = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/notes/",
        {"body": "The requester called on Tuesday."},
        format="json",
    )
    correction = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/notes/",
        {
            "body": "Correction: the requester called on Wednesday.",
            "corrects_note": first.data["id"],
        },
        format="json",
    )

    assert first.status_code == 201
    assert correction.status_code == 201
    detail = api_client.get(f"/api/v1/operator/support-requests/{support_request.id}/")
    assert "operator_note" not in detail.data
    assert [note["body"] for note in detail.data["notes"]] == [
        "The requester called on Tuesday.",
        "Correction: the requester called on Wednesday.",
    ]
    assert detail.data["notes"][0]["actor_email"] == operator.email
    assert detail.data["notes"][0]["created_at"] is not None
    assert str(detail.data["notes"][1]["corrects_note"]) == str(first.data["id"])

    note = support_request.notes.get(id=first.data["id"])
    note.body = "Silently edited history."
    with pytest.raises(ValidationError):
        note.save()
    with pytest.raises(ValidationError):
        note.delete()
    event = support_request.events.filter(event_type=SupportRequestEventType.NOTE_ADDED).first()
    assert event is not None
    event.reason = "Silently edited event history."
    with pytest.raises(ValidationError):
        event.save()
    with pytest.raises(ValidationError):
        event.delete()
    with pytest.raises(ValidationError):
        support_request.notes.update(body="Bulk-edited history.")
    with pytest.raises(ValidationError):
        support_request.events.filter(event_type=SupportRequestEventType.NOTE_ADDED).delete()


@pytest.mark.django_db
def test_operator_records_privacy_minimal_external_contact_summary(api_client: APIClient):
    operator = operator_with_support_capability()
    support_request = assigned_request(operator=operator)
    api_client.force_authenticate(operator)
    occurred_at = "2026-08-25T10:30:00Z"

    response = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/external-contacts/",
        {
            "channel": "email",
            "occurred_at": occurred_at,
            "outcome": "answered",
            "summary": "Shared the account recovery steps; no conversation transcript retained.",
        },
        format="json",
    )

    assert response.status_code == 201
    detail = api_client.get(f"/api/v1/operator/support-requests/{support_request.id}/")
    assert len(detail.data["external_contacts"]) == 1
    contact = detail.data["external_contacts"][0]
    assert contact["channel"] == "email"
    assert contact["occurred_at"] == "2026-08-25T10:30:00Z"
    assert contact["actor_email"] == operator.email
    assert contact["outcome"] == "answered"
    assert contact["summary"] == (
        "Shared the account recovery steps; no conversation transcript retained."
    )

    record = support_request.external_contacts.get()
    record.summary = "A copied full email conversation."
    with pytest.raises(ValidationError):
        record.save()


@pytest.mark.django_db
def test_assigned_operator_resolves_with_controlled_outcome_and_reopens_with_reason(
    api_client: APIClient,
):
    operator = operator_with_support_capability()
    support_request = assigned_request(
        operator=operator,
        classification=SupportClassification.GUIDANCE,
    )
    api_client.force_authenticate(operator)

    invalid = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/resolve/",
        {"category": "custom-outcome", "summary": "Not controlled."},
        format="json",
    )
    resolved = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/resolve/",
        {
            "category": "answered_externally",
            "summary": "Sent account recovery guidance through the requester's email.",
        },
        format="json",
    )

    assert invalid.status_code == 400
    assert resolved.status_code == 200
    assert resolved.data["status"] == SupportRequestStatus.RESOLVED
    assert resolved.data["assignee_id"] is None
    assert resolved.data["resolution_category"] == "answered_externally"
    assert resolved.data["resolution_summary"] == (
        "Sent account recovery guidance through the requester's email."
    )
    resolution_event = support_request.events.get(event_type=SupportRequestEventType.RESOLVED)
    assert resolution_event.actor == operator
    assert resolution_event.prior_state == SupportRequestStatus.IN_PROGRESS
    assert resolution_event.new_state == SupportRequestStatus.RESOLVED
    assert resolution_event.classification == SupportClassification.GUIDANCE
    assert resolution_event.prior_assignee == operator
    assert resolution_event.new_assignee is None
    assert resolution_event.resolution_category == "answered_externally"

    missing_reason = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/reopen/",
        {"reason": ""},
        format="json",
    )
    reopened = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/reopen/",
        {"reason": "The requester reported that the guidance did not solve the problem."},
        format="json",
    )

    assert missing_reason.status_code == 400
    assert reopened.status_code == 200
    assert reopened.data["status"] == SupportRequestStatus.IN_PROGRESS
    assert reopened.data["assignee_id"] == operator.id
    assert reopened.data["resolution_category"] is None
    reopen_event = support_request.events.get(event_type=SupportRequestEventType.REOPENED)
    assert reopen_event.prior_assignee == operator
    assert reopen_event.new_assignee == operator
    assert reopen_event.reason == (
        "The requester reported that the guidance did not solve the problem."
    )


@pytest.mark.django_db
def test_operator_with_privacy_capability_records_verification_and_action_completion(
    api_client: APIClient,
):
    operator = operator_with_support_capability(privacy=True)
    support_request = assigned_request(
        operator=operator,
        intake_kind=IntakeKind.ACCOUNT_DELETION,
        classification=SupportClassification.ACCOUNT_DELETION,
    )
    api_client.force_authenticate(operator)

    defensive = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/privacy-actions/",
        {
            "action": "defensive_contact_removal",
            "completed_at": "2026-08-25T11:00:00Z",
            "summary": "Removed the publicly exposed phone number while verification continues.",
        },
        format="json",
    )
    unverified_permanent = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/privacy-actions/",
        {
            "action": "permanent_account_action",
            "completed_at": "2026-08-25T11:10:00Z",
            "summary": "Recorded account deletion completion.",
        },
        format="json",
    )
    unverified_resolution = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/resolve/",
        {
            "category": "action_completed",
            "summary": "Attempted to resolve a permanent action without verification.",
        },
        format="json",
    )
    verification = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/identity-verifications/",
        {
            "method": "out_of_band",
            "verified_at": "2026-08-25T11:15:00Z",
            "summary": "Verified through the separately registered recovery channel.",
        },
        format="json",
    )
    action_before_verification = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/privacy-actions/",
        {
            "action": "permanent_account_action",
            "completed_at": "2026-08-25T11:10:00Z",
            "summary": "Attempted to record an action before identity verification.",
        },
        format="json",
    )
    permanent = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/privacy-actions/",
        {
            "action": "permanent_account_action",
            "completed_at": "2026-08-25T11:20:00Z",
            "summary": "Recorded privileged Django-admin account deletion completion.",
        },
        format="json",
    )
    resolved = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/resolve/",
        {
            "category": "action_completed",
            "summary": "Identity and privileged account-deletion completion were recorded.",
        },
        format="json",
    )

    assert defensive.status_code == 201
    assert unverified_permanent.status_code == 400
    assert unverified_resolution.status_code == 400
    assert verification.status_code == 201
    assert action_before_verification.status_code == 400
    assert permanent.status_code == 201
    assert resolved.status_code == 200
    detail = api_client.get(f"/api/v1/operator/support-requests/{support_request.id}/")
    assert len(detail.data["identity_verifications"]) == 1
    assert len(detail.data["privacy_actions"]) == 2
    assert [record["action"] for record in detail.data["privacy_actions"]] == [
        "defensive_contact_removal",
        "permanent_account_action",
    ]


@pytest.mark.django_db
def test_account_linked_at_intake_allows_permanent_action_record_without_oob_verification(
    api_client: APIClient,
):
    operator = operator_with_support_capability(privacy=True)
    support_request = assigned_request(
        operator=operator,
        intake_kind=IntakeKind.ACCOUNT_DELETION,
        classification=SupportClassification.ACCOUNT_DELETION,
        account_linked_at_intake=True,
    )
    api_client.force_authenticate(operator)

    response = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/privacy-actions/",
        {
            "action": "permanent_account_action",
            "completed_at": "2026-08-25T12:00:00Z",
            "summary": "Recorded privileged account deletion completion.",
        },
        format="json",
    )

    assert response.status_code == 201


@pytest.mark.django_db
def test_corrected_account_deletion_intake_resolves_as_ordinary_action(api_client: APIClient):
    operator = operator_with_support_capability()
    support_request = assigned_request(
        operator=operator,
        intake_kind=IntakeKind.ACCOUNT_DELETION,
        classification=SupportClassification.GUIDANCE,
    )
    api_client.force_authenticate(operator)

    response = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/resolve/",
        {
            "category": "action_completed",
            "summary": "Completed the ordinary guidance action after classification correction.",
        },
        format="json",
    )

    assert response.status_code == 200
    assert response.data["status"] == SupportRequestStatus.RESOLVED


@pytest.mark.django_db
def test_reopening_releases_request_when_prior_assignee_lost_access(api_client: APIClient):
    prior_assignee = operator_with_support_capability(email="prior@example.com")
    reopening_operator = operator_with_support_capability(email="reopen@example.com")
    support_permission = Permission.objects.get(codename="handle_general_support_requests")
    support_request = assigned_request(operator=prior_assignee)
    api_client.force_authenticate(prior_assignee)
    assert (
        api_client.post(
            f"/api/v1/operator/support-requests/{support_request.id}/resolve/",
            {"category": "no_action_required", "summary": "Initially considered complete."},
            format="json",
        ).status_code
        == 200
    )
    prior_assignee.user_permissions.remove(support_permission)
    api_client.force_authenticate(reopening_operator)

    response = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/reopen/",
        {"reason": "New evidence requires another review."},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["status"] == SupportRequestStatus.OPEN
    assert response.data["assignee_id"] is None
    event = support_request.events.get(event_type=SupportRequestEventType.REOPENED)
    assert event.prior_assignee == prior_assignee
    assert event.new_assignee is None


@pytest.mark.django_db
def test_requester_cannot_access_internal_support_history(api_client: APIClient):
    requester = User.objects.create_user(
        email="requester@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator = operator_with_support_capability()
    support_request = assigned_request(operator=operator, submitter=requester)
    api_client.force_authenticate(requester)

    detail = api_client.get(f"/api/v1/operator/support-requests/{support_request.id}/")
    notes = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/notes/",
        {"body": "Requester must not add or read internal notes."},
        format="json",
    )

    assert detail.status_code == 403
    assert notes.status_code == 403


@pytest.mark.django_db
def test_domain_service_rejects_non_escalation_triage_state_transition():
    operator = operator_with_support_capability()
    support_request = assigned_request(operator=operator)

    with pytest.raises(SupportRequestConflict) as exc_info:
        triage_support_request(
            support_request=support_request,
            actor=operator,
            classification=None,
            priority=None,
            new_status=SupportRequestStatus.RESOLVED,
            escalation_destination="",
            required_capability=None,
            reason="Attempted to bypass controlled resolution.",
        )

    assert exc_info.value.code == "invalid_support_request_transition"
    support_request.refresh_from_db()
    assert support_request.status == SupportRequestStatus.IN_PROGRESS


@pytest.mark.django_db(transaction=True)
def test_competing_resolutions_produce_exactly_one_immutable_resolution_event():
    if connection.vendor != "postgresql":
        pytest.skip("row-lock concurrency behavior is PostgreSQL-specific")
    operator = operator_with_support_capability()
    support_request = assigned_request(operator=operator)

    def resolve() -> str:
        close_old_connections()
        try:
            resolve_support_request(
                support_request=SupportRequest.objects.get(id=support_request.id),
                actor=User.objects.get(id=operator.id),
                category=SupportResolutionCategory.NO_ACTION_REQUIRED,
                summary="No further action is required.",
            )
        except SupportRequestConflict:
            return "lost"
        finally:
            close_old_connections()
        return "won"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: resolve(), range(2)))

    assert results.count("won") == 1
    assert support_request.events.filter(event_type=SupportRequestEventType.RESOLVED).count() == 1
