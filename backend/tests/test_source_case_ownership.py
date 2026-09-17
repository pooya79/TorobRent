"""Case ownership starts at the queue and guards every onboarding decision."""

from datetime import timedelta

import pytest
from django.utils import timezone

from tests.test_source_proposal_review import make_operator, make_pending_proposal, make_user
from tests.test_source_responsibility import queue_manager


@pytest.mark.django_db
def test_queue_claim_is_durable_and_other_operators_only_read(api_client):
    proposal = make_pending_proposal(submitter=make_user(email="owner@example.com", submitter=True))
    operator = make_operator()
    other = make_operator(email="other@example.com")
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    api_client.force_authenticate(operator)
    claimed = api_client.post(f"{base}/claim/", {}).json()
    assert claimed["responsibility"]["operator"] == str(operator.pk)
    assert claimed["responsibility"]["revision"] == 1
    assert claimed["assignment"] is None
    # Retrying a claim is idempotent; elapsed review time doesn't release ownership.
    assert api_client.post(f"{base}/claim/", {}).json()["responsibility"]["revision"] == 1
    proposal.review_claims.update(expires_at=timezone.now() - timedelta(days=1))
    api_client.force_authenticate(other)
    assert (
        api_client.get(f"/api/v1/operator/source-proposals/?proposal={proposal.pk}").status_code
        == 200
    )
    assert api_client.post(f"{base}/claim/", {}).status_code == 409
    payload = {"reviewed_revision": 1, "reason": "مدرک لازم است"}
    assert api_client.post(f"{base}/request-changes/", payload, format="json").status_code == 400
    api_client.force_authenticate(operator)
    response = api_client.post(f"{base}/request-changes/", payload, format="json")
    assert response.status_code == 200, response.content
    assert response.json()["responsibility"]["operator"] == str(operator.pk)
    assert response.json()["state"] == "changes_requested"


@pytest.mark.django_db
def test_manager_can_transfer_before_discovery_and_fences_old_operator(api_client):
    proposal = make_pending_proposal(submitter=make_user(email="owner@example.com", submitter=True))
    original = make_operator()
    successor = make_operator(email="successor@example.com")
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    api_client.force_authenticate(original)
    api_client.post(f"{base}/claim/", {})
    api_client.force_authenticate(queue_manager())
    payload = {
        "assignee_email": successor.email,
        "reviewed_responsibility_revision": 1,
        "reason": "تحویل شیفت",
    }
    response = api_client.post(f"{base}/responsibility/", payload, format="json")
    assert response.status_code == 200, response.content
    assert response.json()["responsibility"]["revision"] == 2
    assert len(response.json()["responsibility"]["history"]) == 2
    assert api_client.post(f"{base}/responsibility/", payload, format="json").status_code == 409
    api_client.force_authenticate(original)
    decision = {"reviewed_revision": 1, "reason": "مدرک لازم است"}
    assert api_client.post(f"{base}/request-changes/", decision, format="json").status_code == 400
    api_client.force_authenticate(successor)
    assert api_client.post(f"{base}/request-changes/", decision, format="json").status_code == 200


@pytest.mark.django_db(transaction=True)
def test_two_operators_cannot_claim_the_same_unassigned_case(api_client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    if connection.vendor != "postgresql":
        pytest.skip("Requires PostgreSQL row locking")
    proposal = make_pending_proposal(submitter=make_user(email="owner@example.com", submitter=True))
    operators = [make_operator(email=f"operator{index}@example.com") for index in range(2)]
    barrier = Barrier(2)

    def claim(operator):
        close_old_connections()
        client = APIClient()
        client.force_authenticate(operator)
        try:
            barrier.wait(timeout=10)
            return client.post(
                f"/api/v1/operator/source-proposals/{proposal.pk}/claim/", {}
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(claim, operators)) == [201, 409]


@pytest.mark.django_db
def test_correction_drafts_stay_in_queue_but_discarded_cases_cannot_be_claimed(api_client):
    representative = make_user(email="owner@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    operator = make_operator()
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    api_client.force_authenticate(operator)
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    assert (
        api_client.post(
            f"{base}/request-changes/",
            {"reviewed_revision": 1, "reason": "مدرک لازم است"},
            format="json",
        ).status_code
        == 200
    )
    api_client.force_authenticate(representative)
    edited = api_client.patch(
        f"/api/v1/source-proposals/{proposal.pk}/draft/",
        {"website_name": "نام اصلاح‌شده"},
        format="json",
    )
    assert edited.status_code == 200, edited.content
    assert edited.json()["state"] == "draft"
    api_client.force_authenticate(operator)
    queued = api_client.get("/api/v1/operator/source-proposals/").json()
    assert queued[0]["responsibility"]["operator"] == str(operator.pk)
    assert queued[0]["id"] == str(proposal.pk)
    # Withdrawal must remove the action, even if a stale browser still has the ID.
    proposal.discarded_at = timezone.now()
    proposal.save(update_fields=("discarded_at",))
    assert api_client.get("/api/v1/operator/source-proposals/").json() == []
    assert api_client.post(f"{base}/claim/", {}).status_code == 400
