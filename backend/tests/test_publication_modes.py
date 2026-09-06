import pytest

from tests.test_extraction_publication import execute_run


def change_mode(client, case, mode, revision=0, **overrides):
    proposal, assignment, operator, _, _ = case
    client.force_authenticate(operator)
    return client.post(
        f"/api/v1/operator/source-proposals/{proposal.pk}/publication-mode/",
        {
            "reviewed_profile_version": assignment["active_profile_version"]["id"],
            "reviewed_mode_revision": revision,
            "review_mode": mode,
            **overrides,
        },
        format="json",
    )


@pytest.mark.django_db
def test_enabling_preserves_backlog_and_approval_history(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    before = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    response = change_mode(api_client, assigned_case, "automatic")
    assert response.status_code == 200, response.content
    after = response.json()
    assert after["profile_versions"] == before["profile_versions"]
    assert after["assignment"]["recent_requests"] == before["assignment"]["recent_requests"]
    assert after["assignment"]["review_mode"] == "automatic"
    assert after["assignment"]["mode_revision"] == 1
    assert change_mode(api_client, assigned_case, "approval_required").status_code == 409
    proposal = assigned_case[0]
    approved = api_client.post(
        f"/api/v1/operator/source-proposals/{proposal.pk}/runs/{run['id']}/approve/",
        {"reviewed_revision": run["revision"], "confirmed": True},
        format="json",
    )
    assert approved.status_code == 200, approved.content
    assert approved.json()["published"] == 10
    api_client.force_authenticate(assigned_case[3])
    assert (
        api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()["assignment"][
            "review_mode"
        ]
        == "automatic"
    )
    assert "روش انتشار منبع تغییر کرد" in str(api_client.get("/api/v1/messages/").json())
    fresh = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert fresh["published"] == 10


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic", "approval_required"], indirect=True)
@pytest.mark.parametrize("timing", ["queued", "running"])
def test_mode_transitions_fence_old_work_without_discarding_results(
    api_client, assigned_case, monkeypatch, timing
):
    from rest_framework.test import APIClient

    from apps.source_proposals.tasks import extract_source

    proposal, assignment, operator, representative, fetcher = assigned_case
    response = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {"assignment": assignment["id"], "url": proposal.website_url},
        format="json",
    )
    assert response.status_code == 201
    changed = False

    def transition():
        nonlocal changed
        if changed:
            return
        changed = True
        client = APIClient()
        if assignment["review_mode"] == "automatic":
            assert change_mode(client, assigned_case, "approval_required").status_code == 200
            assert change_mode(client, assigned_case, "automatic", 1).status_code == 200
        else:
            assert change_mode(client, assigned_case, "automatic").status_code == 200

    class ChangingFetcher:
        def fetch(self, urls, **kwargs):
            if timing == "running":
                transition()
            return fetcher.fetch(urls, **kwargs)

    if timing == "queued":
        transition()
    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: ChangingFetcher()
    )
    extract_source.run(response.json()["id"])
    api_client.force_authenticate(representative)
    run = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()["assignment"][
        "recent_requests"
    ][0]["run"]
    assert run["state"] == "complete"
    assert run["extracted"] == 10
    assert run["published"] == 0
    assert all(candidate["state"] == "pending" for candidate in run["candidates"])
    api_client.force_authenticate(operator)
    approved = api_client.post(
        f"/api/v1/operator/source-proposals/{proposal.pk}/runs/{run['id']}/approve/",
        {"reviewed_revision": run["revision"], "confirmed": True},
        format="json",
    )
    assert approved.status_code == 200, approved.content
    assert approved.json()["published"] == 10


@pytest.mark.django_db
@pytest.mark.parametrize(
    "denial", ["other_operator", "capability", "own_work", "profile", "revoked", "unchanged"]
)
def test_mode_change_requires_current_independent_responsible_operator(
    api_client, assigned_case, denial
):
    import uuid

    from django.utils import timezone

    from apps.source_proposals.models import SourceAssignment
    from tests.test_source_proposal_review import make_operator

    proposal, assignment, operator, representative, fetcher = assigned_case
    api_client.force_authenticate(operator)
    before = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    overrides = {}
    actor = operator
    if denial == "other_operator":
        actor = make_operator(email="other-mode@example.com")
    elif denial == "capability":
        operator.user_permissions.clear()
    elif denial == "own_work":
        representative.user_permissions.set(operator.user_permissions.all())
        actor = representative
    elif denial == "profile":
        overrides["reviewed_profile_version"] = str(uuid.uuid4())
    elif denial == "revoked":
        SourceAssignment.objects.filter(pk=assignment["id"]).update(revoked_at=timezone.now())
    response = change_mode(
        api_client,
        (proposal, assignment, actor, representative, fetcher),
        "approval_required" if denial == "unchanged" else "automatic",
        **overrides,
    )
    assert response.status_code in (400, 403)
    api_client.force_authenticate(representative)
    after = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()
    assert after["history"] == before["history"]
    assert after["assignment"]["mode_revision"] == 0


@pytest.mark.django_db(transaction=True)
def test_concurrent_mode_changes_accept_only_one_reviewed_revision(api_client, assigned_case):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    if connection.vendor != "postgresql":
        pytest.skip("Publication mode serialization requires PostgreSQL")
    barrier = Barrier(2)

    def change(_):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return change_mode(APIClient(), assigned_case, "automatic").status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(change, range(2))) == [200, 409]
    api_client.force_authenticate(assigned_case[2])
    case = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    assert case["assignment"]["mode_revision"] == 1


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_disabling_preserves_published_listings_and_only_explicitly_approves_valid_backlog(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.catalog.models import Listing

    first = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    listings = list(Listing.objects.values())
    assert first["published"] == 10
    assert change_mode(api_client, assigned_case, "approval_required").status_code == 200
    assert list(Listing.objects.values()) == listings
    target = "https://khaneh.example/listing/10000"
    fetcher = assigned_case[4]
    fetcher.pages[target] = fetcher.pages[target].replace('class="area">85', 'class="area">95')
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert run["published"] == 0
    assert run["needs_attention"] == 1
    url = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/"
    assert (
        api_client.post(
            url, {"reviewed_revision": run["revision"], "confirmed": False}, format="json"
        ).status_code
        == 400
    )
    approved = api_client.post(
        url, {"reviewed_revision": run["revision"], "confirmed": True}, format="json"
    )
    assert approved.status_code == 200
    assert approved.json()["published"] == 9
    assert approved.json()["needs_attention"] == 1
    invalid = next(c for c in approved.json()["candidates"] if c["external_url"] == target)
    assert invalid["state"] == "pending"
    assert invalid["listing_id"] is None


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_disabling_during_worker_fetch_commits_before_publication(
    api_client, assigned_case, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.db import close_old_connections, connection

    from apps.source_proposals.tasks import extract_source

    if connection.vendor != "postgresql":
        pytest.skip("Worker transition race requires PostgreSQL")
    proposal, assignment, _, representative, fetcher = assigned_case
    monkeypatch.setattr(extract_source, "delay", lambda *args: None)
    requested = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {"assignment": assignment["id"], "url": proposal.website_url},
        format="json",
    )
    assert requested.status_code == 201
    fetching, resume = Event(), Event()

    class PausedFetcher:
        def fetch(self, urls, **kwargs):
            fetching.set()
            assert resume.wait(timeout=20)
            return fetcher.fetch(urls, **kwargs)

    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: PausedFetcher()
    )

    def execute():
        close_old_connections()
        try:
            extract_source.run(requested.json()["id"])
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1) as pool:
        worker = pool.submit(execute)
        try:
            assert fetching.wait(timeout=20)
            assert change_mode(api_client, assigned_case, "approval_required").status_code == 200
        finally:
            resume.set()
        worker.result(timeout=20)
    api_client.force_authenticate(representative)
    run = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()["assignment"][
        "recent_requests"
    ][0]["run"]
    assert run["state"] == "complete"
    assert run["extracted"] == 10
    assert run["published"] == 0
    assert all(c["state"] == "pending" for c in run["candidates"])
