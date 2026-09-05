import pytest

from tests.test_extraction_publication import execute_run


def revoke(client, case, **payload):
    return client.post(
        f"/api/v1/operator/source-proposals/{case[0].pk}/assignment/revoke/",
        {"reviewed_revision": 1, "reason": "اختیار نماینده اشتباه تأیید شده است", **payload},
        format="json",
    )


@pytest.mark.django_db
def test_revocation_withdraws_publications_cancels_pending_work_and_retains_history(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.catalog.models import Listing, Property
    from apps.source_proposals.models import SourceAssignment

    proposal, assignment, operator, representative, _ = assigned_case
    first = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    approved = api_client.post(
        f"/api/v1/operator/source-proposals/{proposal.pk}/runs/{first['id']}/approve/",
        {"reviewed_revision": first["revision"], "confirmed": True},
        format="json",
    )
    assert approved.status_code == 200
    second = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    api_client.force_authenticate(representative)
    request_url = f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/"
    queued = api_client.post(
        request_url, {"assignment": assignment["id"], "url": proposal.website_url}, format="json"
    )
    assert queued.status_code == 201
    api_client.force_authenticate(operator)
    response = revoke(api_client, assigned_case)
    assert response.status_code == 200, response.content
    assert response.json()["state"] == "revoked"
    assert response.json()["assignment"]["state"] == "revoked"
    assert response.json()["assignment"]["active_profile_version"] is None
    assert Listing.objects.count() == Property.objects.count() == 10
    assert set(Listing.objects.values_list("state", flat=True)) == {"unavailable"}
    record = SourceAssignment.objects.get(pk=assignment["id"])
    assert record.source.profile.active_version_id is None
    assert record.revocation.reason == "اختیار نماینده اشتباه تأیید شده است"
    assert record.revocation.actor == operator
    assert record.approval.event.new_state == "approved"
    assert revoke(api_client, assigned_case).status_code == 409
    api_client.force_authenticate(representative)
    detail = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()
    requests = {item["id"]: item for item in detail["assignment"]["recent_requests"]}
    assert requests[queued.json()["id"]]["state"] == "cancelled"
    runs = {item["run"]["id"]: item["run"] for item in requests.values() if item["run"]}
    assert all(item["state"] == "cancelled" for item in runs[second["id"]]["candidates"])
    assert runs[first["id"]]["decisions"] == approved.json()["decisions"]
    assert all(item["state"] == "published" for item in runs[first["id"]]["candidates"])
    assert (
        api_client.post(
            request_url,
            {"assignment": assignment["id"], "url": proposal.website_url},
            format="json",
        ).status_code
        == 400
    )
    messages = api_client.get("/api/v1/messages/")
    assert messages.status_code == 200
    assert "تخصیص منبع لغو شد" in str(messages.json())
    assert detail["history"][-1]["reason"] == record.revocation.reason


@pytest.mark.django_db
@pytest.mark.parametrize("denial", ["capability", "self", "revision", "reason"])
def test_revocation_requires_capability_independent_operator_revision_and_reason(
    api_client, assigned_case, denial
):
    from tests.test_source_proposal_review import make_operator, make_user

    operator = assigned_case[2]
    payload = {}
    if denial == "capability":
        operator = make_user(email="unprivileged@example.com")
    elif denial == "self":
        operator = assigned_case[3]
        privileged = make_operator(email="grant-template@example.com")
        operator.user_permissions.set(privileged.user_permissions.all())
        operator.groups.set(privileged.groups.all())
    elif denial == "revision":
        payload["reviewed_revision"] = 99
    else:
        payload["reason"] = "   "
    api_client.force_authenticate(operator)
    assert revoke(api_client, assigned_case, **payload).status_code in (400, 403, 409)
    api_client.force_authenticate(assigned_case[3])
    detail = api_client.get(f"/api/v1/source-proposals/{assigned_case[0].pk}/").json()
    assert detail["assignment"]["state"] == "active"
    assert detail["assignment"]["active_profile_version"] is not None


@pytest.mark.django_db
def test_reassignment_requires_fresh_onboarding_and_preserves_revocation_after_account_deletion(
    api_client, assigned_case, django_capture_on_commit_callbacks
):
    from django.core.exceptions import ValidationError

    from apps.source_proposals.models import SourceAssignment, SourceProposalEvent
    from tests.test_source_proposal_review import make_pending_proposal, make_user

    proposal, assignment, operator, representative, _ = assigned_case
    api_client.force_authenticate(operator)
    assert revoke(api_client, assigned_case).status_code == 200
    old = SourceAssignment.objects.get(pk=assignment["id"])
    event = old.revocation
    with pytest.raises(ValidationError):
        SourceProposalEvent.objects.filter(pk=event.pk).update(reason="rewrite")
    with pytest.raises(ValidationError):
        event.delete()
    successor = make_user(email="successor@example.com", submitter=True)
    representative.delete()
    old.refresh_from_db()
    assert old.representative is None
    assert old.revocation.actor == operator
    assert old.revocation.reason == event.reason
    fresh = make_pending_proposal(submitter=successor)
    base = f"/api/v1/operator/source-proposals/{fresh.pk}"
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    premature = api_client.post(
        f"{base}/profile/approve/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": assignment["active_profile_version"]["id"],
            "confirmed": True,
            "review_mode": "automatic",
        },
        format="json",
    )
    assert premature.status_code == 409
    assert old.source.profile.active_version_id is None
    with django_capture_on_commit_callbacks(execute=True):
        assert (
            api_client.post(
                f"{base}/approve/", {"reviewed_revision": 1, "confirmed": True}, format="json"
            ).status_code
            == 200
        )
    case = next(
        item
        for item in api_client.get("/api/v1/operator/source-proposals/").json()
        if item["id"] == str(fresh.pk)
    )
    assert case["assignment"] is None
    version = case["profile_versions"][0]
    assert version["id"] != assignment["active_profile_version"]["id"]
    assert old.source.profile.active_version_id is None
    response = api_client.post(
        f"{base}/profile/approve/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": version["id"],
            "confirmed": True,
            "review_mode": "approval_required",
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.json()["assignment"]["id"] != assignment["id"]
    assert response.json()["assignment"]["review_mode"] == "approval_required"
    assert response.json()["assignment"]["active_profile_version"]["id"] == version["id"]
    assert SourceAssignment.objects.filter(source=old.source).count() == 2
    old.refresh_from_db()
    assert old.revocation == event
    assert old.approval.version_id != old.source.profile.active_version_id


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("decision", ["batch", "candidate"])
def test_revocation_racing_publication_leaves_no_active_listings(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks, decision
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    from apps.catalog.models import Listing

    if connection.vendor != "postgresql":
        pytest.skip("Publication and revocation serialization requires PostgreSQL")
    if decision == "candidate":
        url = "https://khaneh.example/listing/10000"
        assigned_case[4].pages[url] = (
            assigned_case[4].pages[url].replace('class="area">85', 'class="area">95')
        )
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    if decision == "candidate":
        candidate = next(item for item in run["candidates"] if item["validation_errors"])
        base = f"/api/v1/operator/external-listing-candidates/{candidate['id']}"
        assert api_client.post(f"{base}/claim/", {}).status_code == 201
        corrected = api_client.post(
            f"{base}/correct/",
            {
                "reviewed_revision": candidate["revision"],
                "reason": "بررسی متراژ",
                "values": {"area_sqm": 95},
            },
            format="json",
        )
        assert corrected.status_code == 200
        endpoint = f"{base}/approve/"
        revision = corrected.json()["revision"]
    else:
        endpoint = (
            f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/"
        )
        revision = run["revision"]
    barrier = Barrier(2)

    def act(action):
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(assigned_case[2])
            barrier.wait(timeout=10)
            if action == "revoke":
                return revoke(client, assigned_case).status_code
            return client.post(
                endpoint, {"reviewed_revision": revision, "confirmed": True}, format="json"
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(act, ["revoke", "publish"]))
    assert results[0] == 200
    assert results[1] in (200, 400, 409)
    assert not Listing.objects.filter(state="published").exists()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("assigned_case", ["automatic", "approval_required"], indirect=True)
def test_revocation_during_inflight_extraction_discards_stale_results(
    api_client, assigned_case, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    from apps.catalog.models import Listing

    if connection.vendor != "postgresql":
        pytest.skip("In-flight cancellation requires PostgreSQL")
    entered, resume = Event(), Event()
    fetcher = assigned_case[4]

    class PausedFetcher:
        def fetch(self, urls, **kwargs):
            entered.set()
            assert resume.wait(timeout=15)
            return fetcher.fetch(urls, **kwargs)

    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: PausedFetcher()
    )

    def extract():
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(assigned_case[3])
            return client.post(
                f"/api/v1/source-proposals/{assigned_case[0].pk}/extraction-requests/",
                {
                    "assignment": assigned_case[1]["id"],
                    "url": assigned_case[0].website_url,
                },
                format="json",
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(extract)
        try:
            assert entered.wait(timeout=15)
            api_client.force_authenticate(assigned_case[2])
            assert revoke(api_client, assigned_case).status_code == 200
        finally:
            resume.set()
        assert future.result(timeout=20) == 201
    api_client.force_authenticate(assigned_case[3])
    detail = api_client.get(f"/api/v1/source-proposals/{assigned_case[0].pk}/").json()
    request = detail["assignment"]["recent_requests"][0]
    assert request["state"] == request["run"]["state"] == "cancelled"
    assert request["run"]["candidates"] == []
    assert not Listing.objects.exists()


@pytest.mark.django_db
def test_revocation_preserves_failed_run_diagnostics_and_blocks_retry(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_proposals.extraction import run_extraction
    from tests.test_source_extraction_contract import FixtureFetcher

    failed_case = (*assigned_case[:4], FixtureFetcher({}))
    run = execute_run(api_client, failed_case, monkeypatch, django_capture_on_commit_callbacks)
    assert run["state"] == "failed"
    assert run["errors"]
    assert revoke(api_client, assigned_case).status_code == 200
    api_client.force_authenticate(assigned_case[3])
    detail_url = f"/api/v1/source-proposals/{assigned_case[0].pk}/"
    request = api_client.get(detail_url).json()["assignment"]["recent_requests"][0]
    assert request["state"] == "cancelled"
    assert request["run"]["errors"] == run["errors"]
    assert request["run"]["completed_at"] == run["completed_at"]
    assert run_extraction(request["id"]) is False
    assert api_client.get(detail_url).json()["assignment"]["recent_requests"][0] == request
