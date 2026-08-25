from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from django.contrib.auth.models import Permission
from django.db import close_old_connections, connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.contact.models import (
    IntakeKind,
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
            "Released by the assigned Support Operator.",
        ),
    ]


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
