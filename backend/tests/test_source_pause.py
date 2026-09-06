import pytest

from tests.test_extraction_publication import execute_run


def change_processing(client, case, action, revision, **extra):
    proposal, _, operator, _, _ = case
    client.force_authenticate(operator)
    return client.post(
        f"/api/v1/operator/source-proposals/{proposal.pk}/processing/",
        {"action": action, "reviewed_processing_revision": revision, **extra},
        format="json",
    )


@pytest.mark.django_db
def test_pause_blocks_requests_and_supervised_publication_and_notifies(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    response = change_processing(api_client, assigned_case, "pause", 0)
    assert response.status_code == 200, response.content
    assert response.json()["assignment"]["source"]["processing_paused"] is True
    proposal, assignment, _, representative, _ = assigned_case
    assert (
        api_client.post(
            f"/api/v1/operator/source-proposals/{proposal.pk}/runs/{run['id']}/approve/",
            {"reviewed_revision": run["revision"], "confirmed": True},
            format="json",
        ).status_code
        == 400
    )
    api_client.force_authenticate(representative)
    assert (
        api_client.post(
            f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
            {"assignment": assignment["id"], "url": proposal.website_url},
            format="json",
        ).status_code
        == 400
    )
    detail = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()
    assert detail["assignment"]["state"] == "active"
    assert detail["assignment"]["recent_requests"][0]["run"]["candidates"] == run["candidates"]
    assert "پردازش منبع متوقف شد" in str(api_client.get("/api/v1/messages/").json())


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_resume_requires_mode_and_fetches_fresh_without_replaying_old_permission(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.catalog.models import Listing
    from apps.source_proposals.tasks import extract_source

    published = execute_run(
        api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
    )
    listings = list(Listing.objects.values())
    proposal, assignment, _, representative, fetcher = assigned_case
    api_client.force_authenticate(representative)
    queued = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {"assignment": assignment["id"], "url": proposal.website_url},
        format="json",
    ).json()
    assert change_processing(api_client, assigned_case, "pause", 0).status_code == 200
    assert list(Listing.objects.values()) == listings
    assert change_processing(api_client, assigned_case, "resume", 1).status_code == 400
    target = "https://khaneh.example/listing/10000"
    fetcher.pages[target] = fetcher.pages[target].replace('class="area">85', 'class="area">95')
    with django_capture_on_commit_callbacks(execute=True):
        resumed = change_processing(
            api_client, assigned_case, "resume", 1, review_mode="approval_required"
        )
    assert resumed.status_code == 200, resumed.content
    extract_source.run(queued["id"])
    api_client.force_authenticate(representative)
    detail = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()
    fresh, stale, old = detail["assignment"]["recent_requests"]
    assert fresh["id"] != queued["id"]
    assert fresh["run"]["extracted"] == 10
    assert fresh["run"]["published"] == 0
    assert fresh["run"]["needs_attention"] == 1
    assert stale["state"] == "cancelled"
    assert old["run"]["id"] == published["id"]
    assert list(Listing.objects.values()) == listings
    assert "پردازش منبع از سر گرفته شد" in str(api_client.get("/api/v1/messages/").json())


@pytest.mark.django_db
def test_fresh_results_replace_pending_queue_but_retain_old_run_evidence(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    fetcher = assigned_case[4]
    target = "https://khaneh.example/listing/10000"
    fetcher.pages[target] = fetcher.pages[target].replace('class="area">85', 'class="area">95')
    old = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    queue = "/api/v1/operator/external-listing-candidates/"
    assert len(api_client.get(queue).json()) == 1
    fresh = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    pending = api_client.get(queue).json()
    assert len(pending) == 1
    assert pending[0]["extraction_run"] == fresh["id"]
    case = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    historical = case["assignment"]["recent_requests"][1]["run"]
    assert historical["id"] == old["id"]
    assert all(c["superseded"] for c in historical["candidates"])
    assert historical["candidates"][0]["evidence"] == old["candidates"][0]["evidence"]
    stale_candidate = next(c for c in old["candidates"] if c["external_url"] == target)
    assert api_client.post(f"{queue}{stale_candidate['id']}/claim/").status_code == 400


@pytest.mark.django_db
@pytest.mark.parametrize("paused", [False, True])
def test_profile_draft_keeps_active_authority_and_approval_starts_fresh_work(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks, paused
):
    old = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    proposal, assignment, operator, representative, _ = assigned_case
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(
            f"{base}/profile/review/",
            {
                "reviewed_revision": 1,
                "confirmed": True,
                "max_pages": 20,
                "target_detail_pages": 10,
            },
            format="json",
        )
    assert response.status_code == 200, response.content
    review = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    assert review["assignment"]["active_profile_version"] == assignment["active_profile_version"]
    api_client.force_authenticate(representative)
    queued = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {
            "assignment": assignment["id"],
            "url": proposal.website_url,
        },
        format="json",
    )
    assert queued.status_code == 201, queued.content
    if paused:
        assert change_processing(api_client, assigned_case, "pause", 0).status_code == 200
    api_client.force_authenticate(operator)
    with django_capture_on_commit_callbacks(execute=True):
        approved = api_client.post(
            f"{base}/profile/approve/",
            {
                "reviewed_revision": review["revision"],
                "confirmed": True,
                "reviewed_profile_version": review["profile_versions"][0]["id"],
                "review_mode": "approval_required",
            },
            format="json",
        )
    assert approved.status_code == 200, approved.content
    after = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    if paused:
        assert after["assignment"]["source"]["processing_paused"] is True
        assert len(after["assignment"]["recent_requests"]) == 2
        with django_capture_on_commit_callbacks(execute=True):
            resumed = change_processing(
                api_client, assigned_case, "resume", 2, review_mode="approval_required"
            )
        assert resumed.status_code == 200, resumed.content
        after = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    fresh = after["assignment"]["recent_requests"][0]
    assert fresh["profile_version"] == review["profile_versions"][0]["id"]
    assert fresh["run"]["extracted"] == 10
    assert fresh["run"]["published"] == 0
    assert (
        api_client.post(
            f"{base}/runs/{old['id']}/approve/",
            {
                "reviewed_revision": old["revision"],
                "confirmed": True,
            },
            format="json",
        ).status_code
        == 400
    )


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("transition", ["pause", "resume", "newer_result"])
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_delayed_completion_cannot_escape_pause_or_override_newer_results(
    api_client, assigned_case, monkeypatch, transition
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.db import close_old_connections, connection

    from apps.source_proposals.tasks import extract_source

    if connection.vendor != "postgresql":
        pytest.skip("Completion races require PostgreSQL")
    proposal, assignment, operator, representative, fetcher = assigned_case
    monkeypatch.setattr(extract_source, "delay", lambda *args: None)
    endpoint = f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/"
    old = api_client.post(
        endpoint,
        {
            "assignment": assignment["id"],
            "url": proposal.website_url,
        },
        format="json",
    ).json()
    started, release = Event(), Event()

    class DelayedFetcher:
        def fetch(self, urls, **kwargs):
            started.set()
            assert release.wait(timeout=20)
            return fetcher.fetch(urls, **kwargs)

    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: DelayedFetcher()
    )

    def execute_old():
        close_old_connections()
        try:
            extract_source.run(old["id"])
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1) as pool:
        worker = pool.submit(execute_old)
        try:
            assert started.wait(timeout=20)
            monkeypatch.setattr(
                "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: fetcher
            )
            if transition in ("pause", "resume"):
                assert change_processing(api_client, assigned_case, "pause", 0).status_code == 200
                if transition == "resume":
                    resumed = change_processing(
                        api_client, assigned_case, "resume", 1, review_mode="approval_required"
                    )
                    assert resumed.status_code == 200, resumed.content
                    fresh = resumed.json()["assignment"]["recent_requests"][0]
                    extract_source.run(fresh["id"])
            else:
                # A different entry URL reaches the same pages while the older crawl waits.
                fresh = api_client.post(
                    endpoint,
                    {
                        "assignment": assignment["id"],
                        "url": proposal.website_url + "?fresh=1",
                    },
                    format="json",
                ).json()
                fetcher.pages[proposal.website_url + "?fresh=1"] = fetcher.pages[
                    proposal.website_url
                ]
                extract_source.run(fresh["id"])
        finally:
            release.set()
        worker.result(timeout=20)
    extract_source.run(old["id"])
    api_client.force_authenticate(operator)
    case = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    old_run = next(r["run"] for r in case["assignment"]["recent_requests"] if r["id"] == old["id"])
    assert old_run["published"] == 0
    if transition == "newer_result":
        assert all(c["superseded"] for c in old_run["candidates"])
        fresh_run = case["assignment"]["recent_requests"][0]["run"]
        assert fresh_run["published"] == 10
    else:
        assert old_run["state"] == "cancelled"
        assert old_run["candidates"] == []
    assert api_client.get("/api/v1/operator/external-listing-candidates/").json() == []


@pytest.mark.django_db
@pytest.mark.parametrize(
    "denial", ["other_operator", "representative", "capability", "revoked", "revision"]
)
def test_processing_requires_current_responsible_operator(api_client, assigned_case, denial):
    from django.utils import timezone

    from apps.source_proposals.models import SourceAssignment
    from tests.test_source_proposal_review import make_operator

    proposal, assignment, operator, representative, fetcher = assigned_case
    if denial == "other_operator":
        operator = make_operator(email="other-pause@example.com")
    elif denial == "representative":
        operator = representative
    elif denial == "capability":
        operator.user_permissions.clear()
    elif denial == "revoked":
        SourceAssignment.objects.filter(pk=assignment["id"]).update(revoked_at=timezone.now())
    response = change_processing(
        api_client,
        (proposal, assignment, operator, representative, fetcher),
        "pause",
        99 if denial == "revision" else 0,
    )
    assert response.status_code in (400, 403, 409)
    api_client.force_authenticate(representative)
    after = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()
    assert after["assignment"]["source"]["processing_paused"] is False


@pytest.mark.django_db
def test_paused_candidate_approval_stays_blocked_after_resume(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    target = "https://khaneh.example/listing/10000"
    fetcher = assigned_case[4]
    fetcher.pages[target] = fetcher.pages[target].replace('class="area">85', 'class="area">95')
    old = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    candidate = next(c for c in old["candidates"] if c["external_url"] == target)
    endpoint = f"/api/v1/operator/external-listing-candidates/{candidate['id']}"
    assert api_client.post(f"{endpoint}/claim/").status_code == 201
    corrected = api_client.post(
        f"{endpoint}/correct/",
        {
            "reviewed_revision": candidate["revision"],
            "reason": "بررسی متراژ",
            "values": {"area_sqm": 85},
        },
        format="json",
    )
    assert corrected.status_code == 200, corrected.content
    assert corrected.json()["validation_errors"] == {}
    assert change_processing(api_client, assigned_case, "pause", 0).status_code == 200
    for state in ("paused", "resumed"):
        if state == "resumed":
            assert (
                change_processing(
                    api_client, assigned_case, "resume", 1, review_mode="automatic"
                ).status_code
                == 200
            )
        assert (
            api_client.post(
                f"{endpoint}/approve/",
                {
                    "reviewed_revision": corrected.json()["revision"],
                    "confirmed": True,
                },
                format="json",
            ).status_code
            == 400
        )
        assert api_client.get("/api/v1/operator/external-listing-candidates/").json() == []
