import pytest

from tests.test_extraction_publication import execute_run

BAD_URL = "https://khaneh.example/listing/10000"


def exceptions(client, case):
    client.force_authenticate(case[3])
    return client.get(f"/api/v1/source-proposals/{case[0].pk}/").json()["assignment"]["exceptions"]


@pytest.mark.django_db
def test_repeated_failure_resolves_before_approval_and_reopens_with_history(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    fetcher = assigned_case[4]
    original = fetcher.pages[BAD_URL]
    fetcher.pages[BAD_URL] = original.replace('class="area">85', 'class="area">95')
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    first = exceptions(api_client, assigned_case)
    assert len(first) == 1
    assert first[0]["state"] == "open"
    assert first[0]["problem"] == "candidate_checks"
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    repeated = exceptions(api_client, assigned_case)
    assert len(repeated) == 1
    assert repeated[0]["id"] == first[0]["id"]
    assert repeated[0]["first_occurrence"] == first[0]["first_occurrence"]
    assert len(repeated[0]["history"]) == 2
    fetcher.pages[BAD_URL] = original
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert run["published"] == 0
    assert exceptions(api_client, assigned_case)[0]["state"] == "resolved"
    fetcher.pages[BAD_URL] = original.replace('class="area">85', 'class="area">95')
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    reopened = exceptions(api_client, assigned_case)[0]
    assert reopened["id"] == first[0]["id"]
    assert reopened["state"] == "open"
    assert len(reopened["history"]) == 4


@pytest.mark.django_db
def test_retry_is_bounded_deduplicated_and_assignment_isolated(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from tests.test_source_proposal_review import make_user

    fetcher = assigned_case[4]
    fetcher.pages[BAD_URL] = fetcher.pages[BAD_URL].replace('class="area">85', 'class="area">95')
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    item = exceptions(api_client, assigned_case)[0]
    url = f"/api/v1/source-proposals/{assigned_case[0].pk}/exceptions/retry/"
    payload = {"exception_ids": [item["id"]]}
    first = api_client.post(url, payload, format="json")
    assert first.status_code == 201, first.content
    assert first.json()[0]["canonical_url"] == BAD_URL
    assert api_client.post(url, payload, format="json").json() == first.json()
    assert (
        api_client.post(url, {"exception_ids": [item["id"]] * 21}, format="json").status_code == 400
    )
    api_client.force_authenticate(make_user(email="other-exception@example.com", submitter=True))
    assert api_client.post(url, payload, format="json").status_code == 404
    assert api_client.get(f"/api/v1/source-proposals/{assigned_case[0].pk}/").status_code == 404


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_correction_and_exclusion_do_not_claim_extraction_recovered(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from tests.test_source_exclusions import add_exclusion, exclusion_action

    fetcher = assigned_case[4]
    fetcher.pages[BAD_URL] = fetcher.pages[BAD_URL].replace('class="area">85', 'class="area">95')
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert run["published"] == 9
    candidate = next(c for c in run["candidates"] if c["external_url"] == BAD_URL)
    base = f"/api/v1/operator/external-listing-candidates/{candidate['id']}"
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    correction = api_client.post(
        f"{base}/correct/",
        {
            "reviewed_revision": candidate["revision"],
            "reason": "بررسی متراژ",
            "values": {"area_sqm": 95},
        },
        format="json",
    )
    assert correction.status_code == 200
    assert correction.json()["validation_errors"] == {}
    assert exceptions(api_client, assigned_case)[0]["state"] == "open"
    added = add_exclusion(api_client, assigned_case, url=BAD_URL, kind="exact")
    rule = added.json()["assignment"]["exclusions"][0]
    assert exceptions(api_client, assigned_case)[0]["state"] == "excluded"
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert run["published"] == 9
    item = exceptions(api_client, assigned_case)[0]
    assert item["state"] == "excluded"
    retry_url = f"/api/v1/source-proposals/{assigned_case[0].pk}/exceptions/retry/"
    assert (
        api_client.post(retry_url, {"exception_ids": [item["id"]]}, format="json").status_code
        == 400
    )
    exclusion_action(
        api_client,
        assigned_case,
        "remove",
        exclusion_id=rule["id"],
        reason="إعادة الدعم",
        confirmed=True,
    )
    assert exceptions(api_client, assigned_case)[0]["state"] != "resolved"


@pytest.mark.django_db
@pytest.mark.parametrize("newer_valid", [True, False])
def test_late_completion_cannot_overwrite_newer_page_outcome(
    api_client, assigned_case, monkeypatch, newer_valid
):
    from apps.source_proposals.tasks import extract_source

    proposal, assignment, _, _, fetcher = assigned_case
    original = fetcher.pages[BAD_URL]
    bad = original.replace('class="area">85', 'class="area">95')
    endpoint = f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/"
    # Two different entry points discover the same canonical page.
    old = api_client.post(
        endpoint, {"assignment": assignment["id"], "url": proposal.website_url}, format="json"
    ).json()
    new = api_client.post(
        endpoint, {"assignment": assignment["id"], "url": BAD_URL}, format="json"
    ).json()
    monkeypatch.setattr("apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: fetcher)
    fetcher.pages[BAD_URL] = original if newer_valid else bad
    extract_source.run(new["id"])
    fetcher.pages[BAD_URL] = bad if newer_valid else original
    extract_source.run(old["id"])
    item = exceptions(api_client, assigned_case)[0]
    assert item["state"] == ("resolved" if newer_valid else "open")
    assert len(item["history"]) == 2
    assert sum(not h["is_current"] for h in item["history"]) == 1


@pytest.mark.django_db
def test_retry_delivery_keeps_one_page_history_entry(api_client, assigned_case, monkeypatch):
    from apps.source_proposals.tasks import extract_source

    proposal, assignment, _, _, fetcher = assigned_case
    fetcher.pages[BAD_URL] = fetcher.pages[BAD_URL].replace('class="area">85', 'class="area">95')
    monkeypatch.setattr("apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: fetcher)
    record = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {"assignment": assignment["id"], "url": BAD_URL},
        format="json",
    ).json()
    extract_source.run(record["id"])
    before = exceptions(api_client, assigned_case)
    extract_source.run(record["id"])
    assert exceptions(api_client, assigned_case) == before


@pytest.mark.django_db(transaction=True)
def test_postgres_concurrent_workers_keep_one_current_exception(
    api_client, assigned_case, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from apps.source_proposals.tasks import extract_source

    if connection.vendor != "postgresql":
        pytest.skip("Concurrent completion requires PostgreSQL")
    proposal, assignment, _, _, fetcher = assigned_case
    monkeypatch.setattr(extract_source, "delay", lambda *args: None)
    fetcher.pages[BAD_URL] = fetcher.pages[BAD_URL].replace('class="area">85', 'class="area">95')
    endpoint = f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/"
    ids = [
        api_client.post(
            endpoint, {"assignment": assignment["id"], "url": url}, format="json"
        ).json()["id"]
        for url in (proposal.website_url, BAD_URL)
    ]
    barrier = Barrier(2)

    class ConcurrentFetcher:
        def __init__(self):
            self.first = True

        def fetch(self, urls, **kwargs):
            if self.first:
                self.first = False
                barrier.wait(timeout=20)
            return fetcher.fetch(urls, **kwargs)

    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: ConcurrentFetcher()
    )

    def execute(request_id):
        close_old_connections()
        try:
            extract_source.run(request_id)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(execute, ids))
    items = exceptions(api_client, assigned_case)
    assert len(items) == 1
    assert len(items[0]["history"]) == 2
    assert items[0]["state"] == "open"


@pytest.mark.django_db
@pytest.mark.parametrize("denial", ["revoked", "other_operator", "foreign_exception"])
def test_retry_rechecks_current_assignment_and_operator_authority(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks, denial
):
    from uuid import uuid4

    from django.utils import timezone

    from apps.source_proposals.models import SourceAssignment
    from tests.test_source_proposal_review import make_operator

    fetcher = assigned_case[4]
    fetcher.pages[BAD_URL] = fetcher.pages[BAD_URL].replace('class="area">85', 'class="area">95')
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    item = exceptions(api_client, assigned_case)[0]
    prefix = ""
    if denial == "revoked":
        SourceAssignment.objects.filter(pk=assigned_case[1]["id"]).update(revoked_at=timezone.now())
    elif denial == "other_operator":
        prefix = "operator/"
        api_client.force_authenticate(make_operator(email="other-retry@example.com"))
    else:
        item["id"] = str(uuid4())
    result = api_client.post(
        f"/api/v1/{prefix}source-proposals/{assigned_case[0].pk}/exceptions/retry/",
        {"exception_ids": [item["id"]]},
        format="json",
    )
    assert result.status_code in (400, 403, 404)


@pytest.mark.django_db
def test_revoked_assignment_does_not_expose_live_source_exceptions(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from django.utils import timezone

    from apps.source_proposals.models import SourceAssignment

    fetcher = assigned_case[4]
    fetcher.pages[BAD_URL] = fetcher.pages[BAD_URL].replace('class="area">85', 'class="area">95')
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert len(exceptions(api_client, assigned_case)) == 1
    SourceAssignment.objects.filter(pk=assigned_case[1]["id"]).update(revoked_at=timezone.now())
    assert exceptions(api_client, assigned_case) == []
    assert api_client.get(f"/api/v1/source-proposals/{assigned_case[0].pk}/").json()["assignment"][
        "recent_requests"
    ]


@pytest.mark.django_db
def test_first_occurrence_includes_earlier_attempt_finishing_last(
    api_client, assigned_case, monkeypatch
):
    from apps.source_proposals.tasks import extract_source

    proposal, assignment, _, _, fetcher = assigned_case
    fetcher.pages[BAD_URL] = fetcher.pages[BAD_URL].replace('class="area">85', 'class="area">95')
    endpoint = f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/"
    old = api_client.post(
        endpoint, {"assignment": assignment["id"], "url": proposal.website_url}, format="json"
    ).json()
    new = api_client.post(
        endpoint, {"assignment": assignment["id"], "url": BAD_URL}, format="json"
    ).json()
    started_new = False

    class InterleavedFetcher:
        def fetch(self, urls, **kwargs):
            nonlocal started_new
            if not started_new:
                started_new = True
                extract_source.run(new["id"])
            return fetcher.fetch(urls, **kwargs)

    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: InterleavedFetcher()
    )
    extract_source.run(old["id"])
    item = exceptions(api_client, assigned_case)[0]
    requests = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()["assignment"][
        "recent_requests"
    ]
    old_run = next(r["run"] for r in requests if r["id"] == old["id"])
    new_run = next(r["run"] for r in requests if r["id"] == new["id"])
    assert item["last_run"] == new_run["id"]
    assert item["first_occurrence"] == old_run["started_at"]
