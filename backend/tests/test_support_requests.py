from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.db import close_old_connections, connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.contact.models import (
    IntakeKind,
    SupportClassification,
    SupportPriority,
    SupportRequest,
    SupportRequestEvent,
    SupportRequestEventType,
    SupportRequestStatus,
)
from apps.contact.services import SupportRequestConflict, claim_support_request


def csrf_client(api_client: APIClient) -> APIClient:
    response = api_client.get("/api/v1/auth/session/")
    api_client.credentials(HTTP_X_CSRFTOKEN=response.data["csrf_token"])
    return api_client


@pytest.mark.django_db
def test_public_contact_endpoint_creates_an_open_support_request(api_client: APIClient):
    cache.clear()
    response = csrf_client(api_client).post(
        "/api/v1/contact/messages/",
        {
            "name": "نگار محمدی",
            "email": "negar@example.com",
            "kind": "general",
            "message": "برای استفاده از بخش جست‌وجو راهنمایی می‌خواهم.",
        },
        format="json",
    )

    assert response.status_code == 201
    support_request = SupportRequest.objects.get()
    assert support_request.intake_kind == "general"
    assert support_request.status == SupportRequestStatus.OPEN


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("intake_kind", "priority"),
    [
        (IntakeKind.ACCOUNT_DELETION, SupportPriority.NORMAL),
        (IntakeKind.PUBLIC_CONTACT_REMOVAL, SupportPriority.URGENT),
    ],
)
def test_declared_privacy_intake_routes_directly_to_restricted_triage(
    api_client: APIClient,
    intake_kind: IntakeKind,
    priority: SupportPriority,
):
    cache.clear()
    response = csrf_client(api_client).post(
        "/api/v1/contact/messages/",
        {
            "name": "Privacy requester",
            "email": "privacy-requester@example.com",
            "kind": intake_kind,
            "message": "Please handle this privacy-sensitive Support Request.",
        },
        format="json",
    )

    assert response.status_code == 201
    support_request = SupportRequest.objects.get()
    assert support_request.intake_kind == intake_kind
    assert support_request.classification == SupportClassification.UNCLASSIFIED
    assert support_request.priority == priority

    general_operator = User.objects.create_user(
        email="general@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    general_operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    api_client.force_authenticate(general_operator)
    assert api_client.get("/api/v1/operator/support-requests/").data["count"] == 0

    privacy_operator = User.objects.create_user(
        email="privacy@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    privacy_operator.user_permissions.add(
        Permission.objects.get(codename="handle_privacy_support_requests")
    )
    api_client.force_authenticate(privacy_operator)
    assert api_client.get("/api/v1/operator/support-requests/").data["count"] == 1


@pytest.mark.django_db
def test_general_support_operator_retrieves_only_non_sensitive_non_self_requests(
    api_client: APIClient,
):
    operator = User.objects.create_user(
        email="operator@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="accounts",
            codename="handle_general_support_requests",
        )
    )
    permitted = SupportRequest.objects.create(
        name="Allowed",
        email="allowed@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="A permitted Support Request.",
    )
    SupportRequest.objects.create(
        name="Own account request",
        email="other@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="This belongs to the Operator account.",
        submitter=operator,
    )
    SupportRequest.objects.create(
        name="Matching anonymous request",
        email="OPERATOR@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="This anonymously matches the Operator email.",
    )
    SupportRequest.objects.create(
        name="Privacy request",
        email="privacy@example.com",
        intake_kind=IntakeKind.ACCOUNT_DELETION,
        message="This Intake Kind is privacy-sensitive.",
    )
    other_submitter = User.objects.create_user(
        email="other-submitter@example.com",
        password="password",
    )
    authenticated_with_matching_contact = SupportRequest.objects.create(
        name="Other account request",
        email="operator@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="The entered contact email matches, but this belongs to another account.",
        submitter=other_submitter,
    )
    api_client.force_authenticate(operator)

    response = api_client.get("/api/v1/operator/support-requests/")

    assert response.status_code == 200
    assert response.data["count"] == 2
    assert {item["id"] for item in response.data["results"]} == {
        str(permitted.id),
        str(authenticated_with_matching_contact.id),
    }


@pytest.mark.django_db
def test_support_operator_claims_and_releases_a_request_with_durable_event_history(
    api_client: APIClient,
):
    operator = User.objects.create_user(
        email="operator@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="accounts",
            codename="handle_general_support_requests",
        )
    )
    support_request = SupportRequest.objects.create(
        name="Allowed",
        email="allowed@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="Please help with my search account.",
    )
    api_client.force_authenticate(operator)

    claimed = api_client.post(f"/api/v1/operator/support-requests/{support_request.id}/claim/")

    assert claimed.status_code == 201
    assert claimed.data["status"] == SupportRequestStatus.IN_PROGRESS
    assert claimed.data["assignee_email"] == operator.email
    assert claimed.data["assigned_at"] is not None
    support_request.refresh_from_db()
    assert support_request.assignee == operator
    assert support_request.assigned_at is not None
    assigned_at = support_request.assigned_at

    released = api_client.delete(f"/api/v1/operator/support-requests/{support_request.id}/claim/")

    assert released.status_code == 204
    support_request.refresh_from_db()
    assert support_request.status == SupportRequestStatus.OPEN
    assert support_request.assignee is None
    assert support_request.assigned_at is None
    assert assigned_at is not None
    assert list(
        SupportRequestEvent.objects.filter(support_request=support_request).values_list(
            "event_type", "actor", "prior_state", "new_state", "reason"
        )
    ) == [
        (
            SupportRequestEventType.ASSIGNED,
            operator.id,
            SupportRequestStatus.OPEN,
            SupportRequestStatus.IN_PROGRESS,
            "",
        ),
        (
            SupportRequestEventType.RELEASED,
            operator.id,
            SupportRequestStatus.IN_PROGRESS,
            SupportRequestStatus.OPEN,
            "Released by the assigned Operator.",
        ),
    ]


@pytest.mark.django_db
def test_ordinary_support_operator_cannot_release_another_operators_assignment(
    api_client: APIClient,
):
    permission = Permission.objects.get(codename="handle_general_support_requests")
    assignee = User.objects.create_user(
        email="assignee@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    other_operator = User.objects.create_user(
        email="other@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    assignee.user_permissions.add(permission)
    other_operator.user_permissions.add(permission)
    support_request = SupportRequest.objects.create(
        name="Assigned elsewhere",
        email="requester@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="Only the assigned ordinary Operator may release this.",
        status=SupportRequestStatus.IN_PROGRESS,
        assignee=assignee,
        assigned_at=timezone.now(),
    )
    api_client.force_authenticate(other_operator)

    response = api_client.delete(f"/api/v1/operator/support-requests/{support_request.id}/claim/")

    assert response.status_code == 409
    support_request.refresh_from_db()
    assert support_request.assignee == assignee
    assert support_request.status == SupportRequestStatus.IN_PROGRESS


@pytest.mark.django_db
def test_support_assignment_survives_later_operator_sessions(api_client: APIClient):
    operator = User.objects.create_user(
        email="operator@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    support_request = SupportRequest.objects.create(
        name="Durable assignment",
        email="requester@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="This assignment must remain until explicitly released.",
    )
    api_client.force_authenticate(operator)
    claimed = api_client.post(f"/api/v1/operator/support-requests/{support_request.id}/claim/")
    assert claimed.status_code == 201
    SupportRequest.objects.filter(id=support_request.id).update(
        assigned_at=timezone.now() - timedelta(days=30)
    )

    later_session = APIClient(enforce_csrf_checks=True)
    later_session.force_authenticate(User.objects.get(id=operator.id))
    response = later_session.get(f"/api/v1/operator/support-requests/{support_request.id}/")

    assert response.status_code == 200
    assert response.data["status"] == SupportRequestStatus.IN_PROGRESS
    assert response.data["assignee_id"] == operator.id
    assert (
        SupportRequestEvent.objects.filter(
            support_request=support_request,
            event_type=SupportRequestEventType.ASSIGNED,
        ).count()
        == 1
    )


@pytest.mark.django_db
def test_support_queue_filters_by_state_assignment_age_intake_and_classification(
    api_client: APIClient,
):
    operator = User.objects.create_user(
        email="operator@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    matching = SupportRequest.objects.create(
        name="Matching",
        email="matching@example.com",
        intake_kind=IntakeKind.GENERAL,
        classification="guidance",
        message="This request matches all queue facets.",
        status=SupportRequestStatus.IN_PROGRESS,
        assignee=operator,
        assigned_at=timezone.now(),
    )
    SupportRequest.objects.filter(id=matching.id).update(
        created_at=timezone.now() - timedelta(days=8)
    )
    SupportRequest.objects.create(
        name="Open",
        email="open@example.com",
        intake_kind=IntakeKind.GENERAL,
        classification="guidance",
        message="This request has a different operational state.",
    )
    api_client.force_authenticate(operator)

    response = api_client.get(
        "/api/v1/operator/support-requests/",
        {
            "status": "in_progress",
            "assignee": "mine",
            "age_days": "5",
            "intake_kind": "general",
            "classification": "guidance",
        },
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.data["results"]] == [str(matching.id)]


@pytest.mark.django_db
def test_support_queue_priority_filter_never_counts_or_returns_restricted_privacy_records(
    api_client: APIClient,
):
    operator = User.objects.create_user(
        email="operator@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    urgent = SupportRequest.objects.create(
        name="Visible urgent",
        email="urgent@example.com",
        intake_kind=IntakeKind.GENERAL,
        classification=SupportClassification.GUIDANCE,
        priority=SupportPriority.URGENT,
        message="Shared search phrase for an urgent visible request.",
    )
    SupportRequest.objects.create(
        name="Visible normal",
        email="normal@example.com",
        intake_kind=IntakeKind.GENERAL,
        classification=SupportClassification.GUIDANCE,
        priority=SupportPriority.NORMAL,
        message="Shared search phrase for a normal visible request.",
    )
    SupportRequest.objects.create(
        name="Restricted urgent",
        email="restricted@example.com",
        intake_kind=IntakeKind.GENERAL,
        classification=SupportClassification.PRIVACY,
        priority=SupportPriority.URGENT,
        message="Shared search phrase in restricted privacy content.",
    )
    api_client.force_authenticate(operator)

    response = api_client.get(
        "/api/v1/operator/support-requests/",
        {"priority": SupportPriority.URGENT, "search": "Shared search phrase"},
    )

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert [item["id"] for item in response.data["results"]] == [str(urgent.id)]


@pytest.mark.django_db
def test_support_queue_defaults_to_fifty_records_and_caps_page_size_at_one_hundred(
    api_client: APIClient,
):
    operator = User.objects.create_user(
        email="operator@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    SupportRequest.objects.bulk_create([
        SupportRequest(
            name=f"Requester {index}",
            email=f"requester{index}@example.com",
            intake_kind=IntakeKind.GENERAL,
            message="A Support Request long enough to pass public intake validation.",
        )
        for index in range(120)
    ])
    api_client.force_authenticate(operator)

    default_page = api_client.get("/api/v1/operator/support-requests/")
    capped_page = api_client.get("/api/v1/operator/support-requests/", {"page_size": "500"})

    assert default_page.data["count"] == 120
    assert len(default_page.data["results"]) == 50
    assert len(capped_page.data["results"]) == 100


@pytest.mark.django_db
def test_privacy_operator_inspects_a_sensitive_request_using_support_vocabulary(
    api_client: APIClient,
):
    operator = User.objects.create_user(
        email="privacy@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(codename="handle_privacy_support_requests")
    )
    support_request = SupportRequest.objects.create(
        name="Privacy requester",
        email="requester@example.com",
        intake_kind=IntakeKind.PUBLIC_CONTACT_REMOVAL,
        message="Please remove the public contact information immediately.",
    )
    api_client.force_authenticate(operator)

    response = api_client.get(f"/api/v1/operator/support-requests/{support_request.id}/")

    assert response.status_code == 200
    assert response.data["intake_kind"] == IntakeKind.PUBLIC_CONTACT_REMOVAL
    assert "kind" not in response.data
    assert response.data["history"] == []


@pytest.mark.django_db
def test_general_operator_reclassifies_request_as_privacy_and_immediately_loses_access(
    api_client: APIClient,
):
    operator = User.objects.create_user(
        email="operator@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    support_request = SupportRequest.objects.create(
        name="Mistaken Intake Kind",
        email="requester@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="I selected general guidance, but need my private data removed.",
    )
    api_client.force_authenticate(operator)

    response = api_client.patch(
        f"/api/v1/operator/support-requests/{support_request.id}/triage/",
        {
            "classification": SupportClassification.PRIVACY,
            "reason": "The request asks for removal of private data.",
        },
        format="json",
    )

    assert response.status_code == 204
    support_request.refresh_from_db()
    assert support_request.intake_kind == IntakeKind.GENERAL
    assert support_request.classification == SupportClassification.PRIVACY
    event = SupportRequestEvent.objects.get(support_request=support_request)
    assert event.event_type == SupportRequestEventType.CLASSIFIED
    assert event.actor == operator
    assert event.prior_classification == SupportClassification.UNCLASSIFIED
    assert event.new_classification == SupportClassification.PRIVACY
    assert event.reason == "The request asks for removal of private data."
    assert (
        api_client.get(f"/api/v1/operator/support-requests/{support_request.id}/").status_code
        == 404
    )
    queue = api_client.get("/api/v1/operator/support-requests/")
    assert queue.status_code == 200
    assert queue.data["count"] == 0
    assert queue.data["results"] == []


@pytest.mark.django_db
def test_triage_requires_reason_for_privacy_classification_and_cannot_change_intake_kind(
    api_client: APIClient,
):
    operator = User.objects.create_user(
        email="operator@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    support_request = SupportRequest.objects.create(
        name="Historical intake",
        email="requester@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="Preserve what the requester originally selected.",
    )
    api_client.force_authenticate(operator)
    url = f"/api/v1/operator/support-requests/{support_request.id}/triage/"

    no_reason = api_client.patch(
        url,
        {"classification": SupportClassification.PRIVACY},
        format="json",
    )
    intake_edit = api_client.patch(
        url,
        {"intake_kind": IntakeKind.ACCOUNT_DELETION},
        format="json",
    )

    assert no_reason.status_code == 400
    assert intake_edit.status_code == 400
    support_request.refresh_from_db()
    assert support_request.intake_kind == IntakeKind.GENERAL
    assert support_request.classification == SupportClassification.UNCLASSIFIED
    assert not support_request.events.exists()


@pytest.mark.django_db
def test_privacy_operator_corrects_a_mistaken_sensitive_intake_kind_without_rewriting_it(
    api_client: APIClient,
):
    privacy_operator = User.objects.create_user(
        email="privacy@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    privacy_operator.user_permissions.add(
        Permission.objects.get(codename="handle_privacy_support_requests")
    )
    general_operator = User.objects.create_user(
        email="general@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    general_operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    support_request = SupportRequest.objects.create(
        name="Mistaken sensitive intake",
        email="requester@example.com",
        intake_kind=IntakeKind.ACCOUNT_DELETION,
        message="I chose account deletion but only need ordinary account guidance.",
    )
    api_client.force_authenticate(privacy_operator)

    corrected = api_client.patch(
        f"/api/v1/operator/support-requests/{support_request.id}/triage/",
        {
            "classification": SupportClassification.GUIDANCE,
            "reason": "The content asks for guidance, not account deletion.",
        },
        format="json",
    )

    assert corrected.status_code == 204
    support_request.refresh_from_db()
    assert support_request.intake_kind == IntakeKind.ACCOUNT_DELETION
    assert support_request.classification == SupportClassification.GUIDANCE
    event = support_request.events.get()
    assert event.prior_classification == SupportClassification.UNCLASSIFIED
    assert event.new_classification == SupportClassification.GUIDANCE

    api_client.force_authenticate(general_operator)
    queue = api_client.get("/api/v1/operator/support-requests/")
    assert queue.data["count"] == 1
    assert queue.data["results"][0]["id"] == str(support_request.id)


@pytest.mark.django_db
def test_support_operator_raises_priority_to_urgent_only_with_an_audited_reason(
    api_client: APIClient,
):
    operator = User.objects.create_user(
        email="operator@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    support_request = SupportRequest.objects.create(
        name="Urgent requester",
        email="requester@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="This Support Request now needs immediate attention.",
    )
    api_client.force_authenticate(operator)
    url = f"/api/v1/operator/support-requests/{support_request.id}/triage/"

    rejected = api_client.patch(url, {"priority": SupportPriority.URGENT}, format="json")

    assert rejected.status_code == 400
    support_request.refresh_from_db()
    assert support_request.priority == SupportPriority.NORMAL
    assert not support_request.events.exists()

    raised = api_client.patch(
        url,
        {
            "priority": SupportPriority.URGENT,
            "reason": "The requester reports continuing public exposure.",
        },
        format="json",
    )

    assert raised.status_code == 204
    support_request.refresh_from_db()
    assert support_request.priority == SupportPriority.URGENT
    event = support_request.events.get()
    assert event.event_type == SupportRequestEventType.PRIORITY_CHANGED
    assert event.actor == operator
    assert event.prior_priority == SupportPriority.NORMAL
    assert event.new_priority == SupportPriority.URGENT
    assert event.reason == "The requester reports continuing public exposure."


@pytest.mark.django_db
def test_manually_raised_urgency_can_be_corrected_with_an_audited_reason(
    api_client: APIClient,
):
    operator = User.objects.create_user(
        email="operator@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    support_request = SupportRequest.objects.create(
        name="Correctable urgency",
        email="requester@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="This request was mistakenly raised to urgent.",
        priority=SupportPriority.URGENT,
    )
    api_client.force_authenticate(operator)

    corrected = api_client.patch(
        f"/api/v1/operator/support-requests/{support_request.id}/triage/",
        {
            "priority": SupportPriority.NORMAL,
            "reason": "The exposure report was confirmed to be resolved.",
        },
        format="json",
    )

    assert corrected.status_code == 204
    support_request.refresh_from_db()
    assert support_request.priority == SupportPriority.NORMAL
    event = support_request.events.get()
    assert event.prior_priority == SupportPriority.URGENT
    assert event.new_priority == SupportPriority.NORMAL
    assert event.reason == "The exposure report was confirmed to be resolved."


@pytest.mark.django_db
def test_automatic_public_contact_removal_urgency_cannot_be_downgraded(
    api_client: APIClient,
):
    cache.clear()
    created = csrf_client(api_client).post(
        "/api/v1/contact/messages/",
        {
            "name": "Exposed requester",
            "email": "exposed@example.com",
            "kind": IntakeKind.PUBLIC_CONTACT_REMOVAL,
            "message": "Remove my publicly exposed contact information immediately.",
        },
        format="json",
    )
    assert created.status_code == 201
    support_request = SupportRequest.objects.get()
    assert support_request.priority_locked is True
    privacy_operator = User.objects.create_user(
        email="privacy@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    privacy_operator.user_permissions.add(
        Permission.objects.get(codename="handle_privacy_support_requests")
    )
    api_client.force_authenticate(privacy_operator)

    downgraded = api_client.patch(
        f"/api/v1/operator/support-requests/{support_request.id}/triage/",
        {
            "priority": SupportPriority.NORMAL,
            "reason": "Attempted manual downgrade.",
        },
        format="json",
    )

    assert downgraded.status_code == 409
    support_request.refresh_from_db()
    assert support_request.priority == SupportPriority.URGENT
    assert not support_request.events.exists()


@pytest.mark.django_db
def test_general_operator_classifies_and_escalates_privacy_work_for_specialized_handling(
    api_client: APIClient,
):
    general_operator = User.objects.create_user(
        email="general@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    general_operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    privacy_operator = User.objects.create_user(
        email="privacy@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    privacy_operator.user_permissions.add(
        Permission.objects.get(codename="handle_privacy_support_requests")
    )
    support_request = SupportRequest.objects.create(
        name="Privacy escalation",
        email="requester@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="I chose general by mistake and need a protected privacy action.",
    )
    api_client.force_authenticate(general_operator)

    escalated = api_client.patch(
        f"/api/v1/operator/support-requests/{support_request.id}/triage/",
        {
            "classification": SupportClassification.PRIVACY,
            "status": SupportRequestStatus.ESCALATED,
            "required_capability": "handle_privacy_requests",
            "reason": "Requires protected data handling by a Privacy Operator.",
        },
        format="json",
    )

    assert escalated.status_code == 204
    support_request.refresh_from_db()
    assert support_request.classification == SupportClassification.PRIVACY
    assert support_request.status == SupportRequestStatus.ESCALATED
    assert support_request.required_capability == "handle_privacy_requests"
    events = list(support_request.events.all())
    assert [event.event_type for event in events] == [
        SupportRequestEventType.CLASSIFIED,
        SupportRequestEventType.ESCALATED,
    ]
    assert events[1].actor == general_operator
    assert events[1].prior_state == SupportRequestStatus.OPEN
    assert events[1].new_state == SupportRequestStatus.ESCALATED
    assert events[1].required_capability == "handle_privacy_requests"
    assert events[1].reason == "Requires protected data handling by a Privacy Operator."
    assert (
        api_client.post(
            f"/api/v1/operator/support-requests/{support_request.id}/claim/"
        ).status_code
        == 404
    )

    api_client.force_authenticate(privacy_operator)
    claimed = api_client.post(f"/api/v1/operator/support-requests/{support_request.id}/claim/")

    assert claimed.status_code == 201
    assert claimed.data["status"] == SupportRequestStatus.IN_PROGRESS


@pytest.mark.django_db
def test_queue_management_capability_grants_no_support_data_visibility_by_itself(
    api_client: APIClient,
):
    queue_manager = User.objects.create_user(
        email="queue-manager@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    queue_manager.user_permissions.add(Permission.objects.get(codename="manage_operator_queue"))
    support_request = SupportRequest.objects.create(
        name="Restricted from manager",
        email="requester@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="Queue management alone must not reveal this request.",
    )
    api_client.force_authenticate(queue_manager)

    queue = api_client.get("/api/v1/operator/support-requests/")
    reassign = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/reassign/",
        {
            "assignee_email": "other@example.com",
            "reason": "Attempted reassignment without Support access.",
        },
        format="json",
    )

    assert queue.status_code == 403
    assert reassign.status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize("access_change", ["revoke", "deactivate"])
def test_support_lead_reassigns_work_abandoned_after_operator_access_loss(
    api_client: APIClient,
    access_change: str,
):
    support_permission = Permission.objects.get(codename="handle_general_support_requests")
    assigned_operator = User.objects.create_user(
        email="assigned@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    assigned_operator.user_permissions.add(support_permission)
    replacement = User.objects.create_user(
        email="replacement@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    replacement.user_permissions.add(support_permission)
    lead = User.objects.create_user(
        email="lead@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    lead.user_permissions.add(
        support_permission,
        Permission.objects.get(codename="manage_operator_queue"),
    )
    support_request = SupportRequest.objects.create(
        name="Abandoned request",
        email="requester@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="This work needs a new assignee after access is lost.",
    )
    api_client.force_authenticate(assigned_operator)
    assert (
        api_client.post(
            f"/api/v1/operator/support-requests/{support_request.id}/claim/"
        ).status_code
        == 201
    )
    if access_change == "revoke":
        assigned_operator.user_permissions.remove(support_permission)
    else:
        assigned_operator.is_active = False
        assigned_operator.save(update_fields=("is_active",))
    assigned_operator = User.objects.get(id=assigned_operator.id)
    api_client.force_authenticate(assigned_operator)

    release = api_client.delete(f"/api/v1/operator/support-requests/{support_request.id}/claim/")

    assert release.status_code == 403

    api_client.force_authenticate(replacement)
    ordinary_reassign = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/reassign/",
        {
            "assignee_email": replacement.email,
            "reason": "Only a Support lead may reassign work.",
        },
        format="json",
    )
    assert ordinary_reassign.status_code == 403

    api_client.force_authenticate(lead)
    missing_reason = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/reassign/",
        {"assignee_email": replacement.email},
        format="json",
    )
    assert missing_reason.status_code == 400

    reassigned = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/reassign/",
        {
            "assignee_email": replacement.email,
            "reason": "The previous assignee no longer has active Support access.",
        },
        format="json",
    )

    assert reassigned.status_code == 200
    assert reassigned.data["assignee_email"] == replacement.email
    support_request.refresh_from_db()
    assert support_request.assignee == replacement
    assert support_request.status == SupportRequestStatus.IN_PROGRESS
    events = list(support_request.events.all())
    assert [event.event_type for event in events] == [
        SupportRequestEventType.ASSIGNED,
        SupportRequestEventType.REASSIGNED,
    ]
    assert events[0].actor_id == assigned_operator.id
    assert events[1].actor == lead
    assert events[1].prior_assignee_id == assigned_operator.id
    assert events[1].new_assignee == replacement
    assert events[1].reason == "The previous assignee no longer has active Support access."


@pytest.mark.django_db
def test_required_capability_revocation_abandons_work_and_constrains_reassignment(
    api_client: APIClient,
):
    support_permission = Permission.objects.get(codename="handle_general_support_requests")
    privacy_permission = Permission.objects.get(codename="handle_privacy_support_requests")
    assigned_operator = User.objects.create_user(
        email="assigned-specialist@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    assigned_operator.user_permissions.add(support_permission, privacy_permission)
    general_replacement = User.objects.create_user(
        email="general-replacement@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    general_replacement.user_permissions.add(support_permission)
    specialist_replacement = User.objects.create_user(
        email="specialist-replacement@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    specialist_replacement.user_permissions.add(privacy_permission)
    lead = User.objects.create_user(
        email="privacy-lead@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    lead.user_permissions.add(
        privacy_permission,
        Permission.objects.get(codename="manage_operator_queue"),
    )
    support_request = SupportRequest.objects.create(
        name="Specialized request",
        email="requester@example.com",
        intake_kind=IntakeKind.GENERAL,
        classification=SupportClassification.GUIDANCE,
        status=SupportRequestStatus.ESCALATED,
        required_capability="handle_privacy_requests",
        message="This request needs a specialist despite its general classification.",
    )
    api_client.force_authenticate(assigned_operator)
    assert (
        api_client.post(
            f"/api/v1/operator/support-requests/{support_request.id}/claim/"
        ).status_code
        == 201
    )
    assigned_operator.user_permissions.remove(privacy_permission)
    assigned_operator = User.objects.get(id=assigned_operator.id)
    api_client.force_authenticate(assigned_operator)

    release = api_client.delete(f"/api/v1/operator/support-requests/{support_request.id}/claim/")

    assert release.status_code == 404
    api_client.force_authenticate(lead)
    invalid_reassignment = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/reassign/",
        {
            "assignee_email": general_replacement.email,
            "reason": "The assigned specialist lost the required capability.",
        },
        format="json",
    )
    assert invalid_reassignment.status_code == 400

    reassigned = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/reassign/",
        {
            "assignee_email": specialist_replacement.email,
            "reason": "The assigned specialist lost the required capability.",
        },
        format="json",
    )

    assert reassigned.status_code == 200
    assert reassigned.data["assignee_email"] == specialist_replacement.email


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("email_verified", "is_active"),
    [(False, True), (True, False)],
)
def test_support_queue_requires_an_active_verified_operator(
    api_client: APIClient,
    email_verified: bool,
    is_active: bool,
):
    operator = User.objects.create_user(
        email="restricted@example.com",
        password="password",
        email_verified_at=timezone.now() if email_verified else None,
        is_active=is_active,
    )
    operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    api_client.force_authenticate(operator)

    response = api_client.get("/api/v1/operator/support-requests/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_support_operator_cannot_inspect_or_claim_their_own_request(api_client: APIClient):
    operator = User.objects.create_user(
        email="operator@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    support_request = SupportRequest.objects.create(
        name="Operator",
        email="operator@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="This Support Request belongs to the Operator.",
        submitter=operator,
    )
    api_client.force_authenticate(operator)

    detail = api_client.get(f"/api/v1/operator/support-requests/{support_request.id}/")
    claim = api_client.post(f"/api/v1/operator/support-requests/{support_request.id}/claim/")

    assert detail.status_code == 404
    assert claim.status_code == 404


@pytest.mark.django_db(transaction=True)
def test_competing_support_request_claims_have_exactly_one_winner():
    if connection.vendor != "postgresql":
        pytest.skip("row-lock concurrency behavior is PostgreSQL-specific")
    support_request = SupportRequest.objects.create(
        name="Requester",
        email="requester@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="Two Operators must not claim this request together.",
    )
    operators = []
    permission = Permission.objects.get(codename="handle_general_support_requests")
    for index in range(2):
        operator = User.objects.create_user(
            email=f"operator{index}@example.com",
            password="password",
            email_verified_at=timezone.now(),
        )
        operator.user_permissions.add(permission)
        operators.append(operator)

    def claim(index: int) -> str:
        close_old_connections()
        try:
            claim_support_request(
                support_request=SupportRequest.objects.get(id=support_request.id),
                actor=User.objects.get(id=operators[index].id),
            )
        except SupportRequestConflict:
            return "lost"
        finally:
            close_old_connections()
        return "won"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, range(2)))

    assert results.count("won") == 1
    support_request.refresh_from_db()
    assert support_request.assignee_id in {operator.id for operator in operators}
    assert (
        SupportRequestEvent.objects.filter(
            support_request=support_request,
            event_type=SupportRequestEventType.ASSIGNED,
        ).count()
        == 1
    )
