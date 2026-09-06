import pytest
from django.contrib.auth.models import Permission

from tests.test_source_proposal_review import make_operator


def queue_manager():
    manager = make_operator(email="queue@example.com")
    manager.user_permissions.add(Permission.objects.get(codename="manage_operator_queue"))
    return manager


def reassign(client, proposal, operator, revision=1):
    return client.post(
        f"/api/v1/operator/source-proposals/{proposal.pk}/responsibility/",
        {
            "assignee_email": operator.email,
            "reviewed_responsibility_revision": revision,
            "reason": "تغییر مسئول شیفت",
        },
        format="json",
    )


@pytest.mark.django_db
def test_responsibility_starts_with_approver_and_reassignment_retains_history(
    api_client, assigned_case
):
    proposal, _, original, representative, _ = assigned_case
    api_client.force_authenticate(queue_manager())
    before = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    assert before["responsibility"]["operator"] == str(original.pk)
    successor = make_operator(email="next@example.com")
    response = reassign(api_client, proposal, successor)
    assert response.status_code == 200, response.content
    after = response.json()
    assert after["responsibility"]["operator"] == str(successor.pk)
    assert after["responsibility"]["revision"] == 2
    assert after["profile_versions"] == before["profile_versions"]
    assert after["responsibility"]["history"][0]["operator"] == str(original.pk)
    assert after["responsibility"]["history"][1]["reason"] == "تغییر مسئول شیفت"
    assert reassign(api_client, proposal, original).status_code == 409
    api_client.force_authenticate(representative)
    detail = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()
    assert "responsibility" not in detail
    assert detail["assignment"]["review_operator"] == str(successor.pk)


@pytest.mark.django_db
def test_new_responsible_operator_can_publish_and_old_operator_is_refused(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from tests.test_extraction_publication import execute_run

    proposal, _, original, _, _ = assigned_case
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    successor = queue_manager()
    api_client.force_authenticate(successor)
    assert reassign(api_client, proposal, successor).status_code == 200
    url = f"/api/v1/operator/source-proposals/{proposal.pk}/runs/{run['id']}/approve/"
    payload = {"reviewed_revision": run["revision"], "confirmed": True}
    api_client.force_authenticate(original)
    assert api_client.post(url, payload, format="json").status_code == 400
    api_client.force_authenticate(successor)
    approved = api_client.post(url, payload, format="json")
    assert approved.status_code == 200, approved.content
    assert approved.json()["published"] == 10


@pytest.mark.django_db
@pytest.mark.parametrize(
    "denial", ["manager", "capability", "own_work", "inactive", "unverified", "reason"]
)
def test_reassignment_requires_manager_eligible_independent_operator_and_reason(
    api_client, assigned_case, denial
):
    proposal, _, original, representative, _ = assigned_case
    manager = queue_manager()
    successor = make_operator(email="next@example.com")
    if denial == "manager":
        manager = original
    elif denial == "capability":
        successor.user_permissions.clear()
    elif denial == "own_work":
        successor = representative
        successor.user_permissions.set(original.user_permissions.all())
    elif denial == "inactive":
        successor.is_active = False
        successor.save()
    elif denial == "unverified":
        successor.email_verified_at = None
        successor.save()
    api_client.force_authenticate(manager)
    if denial == "reason":
        response = api_client.post(
            f"/api/v1/operator/source-proposals/{proposal.pk}/responsibility/",
            {
                "assignee_email": successor.email,
                "reviewed_responsibility_revision": 1,
                "reason": " ",
            },
            format="json",
        )
    else:
        response = reassign(api_client, proposal, successor)
    assert response.status_code == 400
    assert api_client.get("/api/v1/operator/source-proposals/").json()[0]["responsibility"][
        "operator"
    ] == str(original.pk)


@pytest.mark.django_db
def test_reassignment_during_profile_review_allows_new_claim_and_refuses_old_claim(
    api_client, assigned_case
):
    proposal, _, original, _, _ = assigned_case
    api_client.force_authenticate(original)
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    started = api_client.post(
        f"{base}/profile/review/",
        {
            "reviewed_revision": 1,
            "confirmed": True,
            "max_pages": 50,
            "target_detail_pages": 30,
        },
        format="json",
    )
    assert started.status_code == 200
    manager = queue_manager()
    api_client.force_authenticate(manager)
    assert reassign(api_client, proposal, manager).status_code == 200
    api_client.force_authenticate(original)
    assert api_client.post(f"{base}/claim/", {}).status_code == 400
    api_client.force_authenticate(manager)
    assert api_client.post(f"{base}/claim/", {}).status_code == 201


@pytest.mark.django_db(transaction=True)
def test_concurrent_reassignments_accept_only_one_reviewed_responsibility(
    api_client, assigned_case
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    if connection.vendor != "postgresql":
        pytest.skip("Responsibility serialization requires PostgreSQL")
    proposal = assigned_case[0]
    manager = queue_manager()
    successors = [make_operator(email=f"next{n}@example.com") for n in range(2)]
    barrier = Barrier(2)

    def change(operator):
        close_old_connections()
        client = APIClient()
        client.force_authenticate(manager)
        try:
            barrier.wait(timeout=10)
            return reassign(client, proposal, operator).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(change, successors)) == [200, 409]
    api_client.force_authenticate(manager)
    result = api_client.get("/api/v1/operator/source-proposals/").json()[0]["responsibility"]
    assert result["revision"] == 2
    assert len(result["history"]) == 2


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("legacy_approval", [False, True])
def test_existing_approval_backfills_responsibility_without_changing_evidence(
    api_client, assigned_case, legacy_approval
):
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor

    proposal, _, operator, _, _ = assigned_case
    api_client.force_authenticate(operator)
    before = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    if legacy_approval:
        from apps.source_proposals.models import SourceAssignment

        SourceAssignment.objects.filter(proposal=proposal).update(approval=None)
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    try:
        executor.migrate([
            ("source_proposals", "0025_sourceprofiledecision_limitations_acknowledged"),
            ("catalog", "0014_reference_common_media_asset"),
        ])
        MigrationExecutor(connection).migrate(latest)
        after = api_client.get("/api/v1/operator/source-proposals/").json()[0]
        assert after["responsibility"]["operator"] == str(operator.pk)
        assert after["responsibility"]["revision"] == 1
        assert after["responsibility"]["history"][0]["actor"] == str(operator.pk)
        assert after["profile_versions"] == before["profile_versions"]
        assert after["history"] == before["history"]
    finally:
        MigrationExecutor(connection).migrate(latest)


@pytest.mark.django_db
def test_responsibility_fences_revocation_and_profile_review(api_client, assigned_case):
    proposal, _, original, _, _ = assigned_case
    manager = queue_manager()
    api_client.force_authenticate(manager)
    assert reassign(api_client, proposal, manager).status_code == 200
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    payload = {
        "reviewed_revision": 1,
        "confirmed": True,
        "max_pages": 50,
        "target_detail_pages": 30,
    }
    api_client.force_authenticate(original)
    assert api_client.post(f"{base}/profile/review/", payload, format="json").status_code == 400
    assert (
        api_client.post(
            f"{base}/assignment/revoke/", {"reviewed_revision": 1, "reason": "لغو"}, format="json"
        ).status_code
        == 400
    )
    api_client.force_authenticate(manager)
    assert api_client.post(f"{base}/profile/review/", payload, format="json").status_code == 200


@pytest.mark.django_db
def test_reassignment_invalidates_candidate_claim_and_stale_capability_cache(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from tests.test_extraction_publication import execute_run

    proposal, _, original, _, fetcher = assigned_case
    url = "https://khaneh.example/listing/10000"
    fetcher.pages[url] = fetcher.pages[url].replace('class="area">85', 'class="area">95')
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    candidate = next(item for item in run["candidates"] if item["external_url"] == url)
    base = f"/api/v1/operator/external-listing-candidates/{candidate['id']}"
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    manager = queue_manager()
    api_client.force_authenticate(manager)
    assert reassign(api_client, proposal, manager).status_code == 200
    api_client.force_authenticate(original)
    payload = {
        "reviewed_revision": candidate["revision"],
        "reason": "بررسی",
        "values": {"area_sqm": 95},
    }
    assert api_client.post(f"{base}/correct/", payload, format="json").status_code == 400
    api_client.force_authenticate(manager)
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    # The APIClient retains its authenticated instance and its permission cache.
    manager.user_permissions.clear()
    assert api_client.post(f"{base}/correct/", payload, format="json").status_code in (400, 403)


def grant_source_admin(operator):
    operator.is_staff = True
    operator.save(update_fields=("is_staff",))
    operator.user_permissions.add(
        *Permission.objects.filter(
            codename__in=("change_source", "add_sourceimagehost", "change_sourceimagehost")
        )
    )


@pytest.mark.django_db
def test_admin_cannot_reassign_source_without_workflow(client, api_client, assigned_case):
    proposal, assignment, operator, _, _ = assigned_case
    grant_source_admin(operator)
    client.force_login(operator)
    successor = make_operator(email="admin-next@example.com")
    response = client.post(
        f"/admin/catalog/source/{assignment['source']['id']}/change/",
        {
            "name": f"external-{proposal.pk}",
            "domain": assignment["source"]["domain"],
            "display_name": "خانه‌یاب",
            "is_active": "on",
            "outbound_policy": "external_link",
            "responsible_operator": str(successor.pk),
            "responsibility_revision": 99,
            "_save": "Save",
        },
    )
    assert response.status_code == 302
    api_client.force_authenticate(operator)
    result = api_client.get("/api/v1/operator/source-proposals/").json()[0]["responsibility"]
    assert result["operator"] == str(operator.pk)
    assert result["revision"] == 1


@pytest.mark.django_db
def test_image_host_admin_follows_current_responsibility(client, api_client, assigned_case):
    proposal, assignment, original, _, _ = assigned_case
    manager = queue_manager()
    grant_source_admin(original)
    grant_source_admin(manager)
    api_client.force_authenticate(manager)
    assert reassign(api_client, proposal, manager).status_code == 200
    payload = {"source": assignment["source"]["id"], "host": "cdn.example", "_save": "Save"}
    client.force_login(original)
    assert client.post("/admin/source_proposals/sourceimagehost/add/", payload).status_code == 403
    client.force_login(manager)
    assert client.post("/admin/source_proposals/sourceimagehost/add/", payload).status_code == 302


@pytest.mark.django_db
def test_pending_image_host_approval_keeps_time_limited_review_claim(client, discovered_case):
    from datetime import timedelta

    from django.utils import timezone

    proposal, _, operator, _, _ = discovered_case
    proposal.refresh_from_db()
    grant_source_admin(operator)
    client.force_login(operator)
    payload = {"source": str(proposal.source_id), "host": "first-cdn.example", "_save": "Save"}
    assert client.post("/admin/source_proposals/sourceimagehost/add/", payload).status_code == 302
    proposal.review_claims.update(expires_at=timezone.now() - timedelta(seconds=1))
    payload["host"] = "next-cdn.example"
    assert client.post("/admin/source_proposals/sourceimagehost/add/", payload).status_code == 403
