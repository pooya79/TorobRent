import pytest


@pytest.fixture
def assigned_case(api_client, discovered_case, monkeypatch):
    monkeypatch.setattr(
        "apps.source_extraction.fetching.resolve_addresses", lambda *args: ["93.184.216.34"]
    )
    proposal, base, operator, representative, fetcher = discovered_case
    version = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
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
    assert response.status_code == 200
    api_client.force_authenticate(representative)
    return proposal, response.data["assignment"], operator, representative, fetcher


@pytest.mark.django_db
def test_request_records_authorization_and_queues_after_commit(api_client, assigned_case):
    proposal, assignment, _, representative, _ = assigned_case
    response = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {
            "assignment": assignment["id"],
            "url": "https://KHANEH.example/rentals#top",
        },
        format="json",
    )
    assert response.status_code == 201
    request = response.json()
    assert request["requester"] == str(representative.pk)
    assert request["assignment"] == assignment["id"]
    assert request["submitted_url"] == "https://KHANEH.example/rentals#top"
    assert request["canonical_url"] == "https://khaneh.example/rentals"
    assert request["state"] == "queued"
    assert request["run"] is None
    detail = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()
    assert detail["assignment"]["recent_requests"] == [request]


@pytest.mark.django_db
def test_run_uses_approved_profile_and_duplicate_delivery_preserves_results(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_proposals.tasks import extract_source

    proposal, assignment, operator, _, fetcher = assigned_case
    monkeypatch.setattr("apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: fetcher)
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(
            f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
            {
                "assignment": assignment["id"],
                "url": proposal.website_url,
            },
            format="json",
        )
    assert response.status_code == 201
    detail_url = f"/api/v1/source-proposals/{proposal.pk}/"
    record = api_client.get(detail_url).json()["assignment"]["recent_requests"][0]
    assert record["state"] == "complete"
    run = record["run"]
    assert run["profile_version"] == assignment["active_profile_version"]["id"]
    assert run["pipeline_version"]
    assert run["attempts"] == 1
    assert run["discovered"] == 10
    assert run["extracted"] == 10
    assert [run[key] for key in ("published", "needs_attention", "rejected", "failed")] == [
        0,
        0,
        0,
        0,
    ]
    assert run["completed_at"] >= run["started_at"]
    extract_source.run(record["id"])
    assert api_client.get(detail_url).json()["assignment"]["recent_requests"][0] == record
    api_client.force_authenticate(operator)
    case = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    assert case["assignment"]["recent_requests"][0] == record


@pytest.mark.django_db
@pytest.mark.parametrize(
    "url",
    [
        "https://sub.khaneh.example/",
        "https://other.example/",
        "https://user:secret@khaneh.example/",
        "http://127.0.0.1/",
        "https://khaneh.example:8080/",
    ],
)
def test_unsafe_urls_create_no_request(api_client, assigned_case, url):
    proposal, assignment, _, _, _ = assigned_case
    response = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {
            "assignment": assignment["id"],
            "url": url,
        },
        format="json",
    )
    assert response.status_code == 400
    assert (
        api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()["assignment"][
            "recent_requests"
        ]
        == []
    )


@pytest.mark.django_db
def test_private_dns_destination_is_rejected_before_queueing(
    api_client, assigned_case, monkeypatch
):
    proposal, assignment, _, _, _ = assigned_case
    monkeypatch.setattr(
        "apps.source_extraction.fetching.resolve_addresses", lambda *args: ["127.0.0.1"]
    )
    response = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {
            "assignment": assignment["id"],
            "url": proposal.website_url,
        },
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
@pytest.mark.parametrize("change", ["representative", "revoked", "profile"])
def test_stale_authorization_cancels_queued_run_and_blocks_requests(
    api_client, assigned_case, change
):
    from django.utils import timezone

    from apps.source_proposals.models import SourceAssignment, SourceProfile
    from apps.source_proposals.tasks import extract_source
    from tests.test_source_proposal_review import make_user

    proposal, assignment, _, _, _ = assigned_case
    url = f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/"
    payload = {"assignment": assignment["id"], "url": proposal.website_url}
    record = api_client.post(url, payload, format="json").json()
    if change == "representative":
        SourceAssignment.objects.filter(pk=assignment["id"]).update(
            representative=make_user(email="other@example.com", submitter=True)
        )
    elif change == "revoked":
        SourceAssignment.objects.filter(pk=assignment["id"]).update(revoked_at=timezone.now())
    else:
        SourceProfile.objects.filter(source_id=assignment["source"]["id"]).update(
            active_version=None
        )
    extract_source.run(record["id"])
    from apps.source_proposals.models import ExtractionRequest

    request = ExtractionRequest.objects.get(pk=record["id"])
    assert request.state == "cancelled"
    assert request.run.results == []
    assert api_client.post(url, payload, format="json").status_code in (400, 404)


@pytest.mark.django_db
def test_transient_failure_is_bounded_and_retry_reuses_run(api_client, assigned_case, monkeypatch):
    from apps.source_extraction.fetching import (
        FetchBatch,
        FetchFailure,
        FetchFailureCode,
        FetchRecord,
    )
    from apps.source_proposals.extraction import run_extraction

    proposal, assignment, _, _, fetcher = assigned_case

    class FailedFetcher:
        def fetch(self, urls, **kw):
            return FetchBatch(
                tuple(
                    FetchRecord(
                        url,
                        failure=FetchFailure(
                            FetchFailureCode.TIMEOUT, url, "sensitive exception", transient=True
                        ),
                    )
                    for url in urls
                )
            )

    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: FailedFetcher()
    )
    record = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {
            "assignment": assignment["id"],
            "url": proposal.website_url,
        },
        format="json",
    ).json()
    assert run_extraction(record["id"]) is True
    detail_url = f"/api/v1/source-proposals/{proposal.pk}/"
    failed = api_client.get(detail_url).json()["assignment"]["recent_requests"][0]["run"]
    assert failed["state"] == "failed"
    assert failed["errors"][0]["transient"] is True
    assert "sensitive" not in str(failed)
    monkeypatch.setattr("apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: fetcher)
    assert run_extraction(record["id"]) is False
    recovered = api_client.get(detail_url).json()["assignment"]["recent_requests"][0]["run"]
    assert recovered["id"] == failed["id"]
    assert recovered["attempts"] == 2
    assert recovered["state"] == "complete"
    assert recovered["extracted"] == 10


@pytest.mark.django_db(transaction=True)
def test_concurrent_delivery_and_revocation_discard_inflight_results(
    api_client, assigned_case, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.db import close_old_connections, connection
    from django.utils import timezone

    from apps.source_proposals.extraction import run_extraction
    from apps.source_proposals.models import ExtractionRequest, ExtractionRun, SourceAssignment

    if connection.vendor != "postgresql":
        pytest.skip("Concurrent run execution requires PostgreSQL.")
    proposal, assignment, _, _, fetcher = assigned_case
    monkeypatch.setattr("apps.source_proposals.tasks.extract_source.delay", lambda *args: None)
    record = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {
            "assignment": assignment["id"],
            "url": proposal.website_url,
        },
        format="json",
    ).json()
    started, release = Event(), Event()

    class PausedFetcher:
        def fetch(self, urls, **kwargs):
            started.set()
            assert release.wait(10)
            return fetcher.fetch(urls, **kwargs)

    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: PausedFetcher()
    )

    def execute():
        close_old_connections()
        try:
            return run_extraction(record["id"])
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(execute)
        try:
            assert started.wait(10)
            assert run_extraction(record["id"]) is True
            SourceAssignment.objects.filter(pk=assignment["id"]).update(revoked_at=timezone.now())
        finally:
            release.set()
        assert future.result(timeout=15) is False
    assert ExtractionRun.objects.filter(request_id=record["id"]).count() == 1
    request = ExtractionRequest.objects.get(pk=record["id"])
    assert request.state == "cancelled"
    assert request.run.results == []
    assert request.run.attempts == 1


@pytest.mark.django_db
def test_other_representative_cannot_submit_or_see_history(api_client, assigned_case):
    from tests.test_source_proposal_review import make_user

    proposal, assignment, _, _, _ = assigned_case
    api_client.force_authenticate(make_user(email="outsider-run@example.com", submitter=True))
    assert (
        api_client.post(
            f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
            {
                "assignment": assignment["id"],
                "url": proposal.website_url,
            },
            format="json",
        ).status_code
        == 404
    )
    assert api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").status_code == 404


@pytest.mark.django_db
def test_interrupted_worker_recovery_is_bounded(api_client, assigned_case, monkeypatch):
    from datetime import timedelta

    from django.utils import timezone

    from apps.source_proposals.extraction import run_extraction
    from apps.source_proposals.models import ExtractionRequest, ExtractionRun

    proposal, assignment, _, _, fetcher = assigned_case
    monkeypatch.setattr("apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: fetcher)
    record = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {
            "assignment": assignment["id"],
            "url": proposal.website_url,
        },
        format="json",
    ).json()
    request = ExtractionRequest.objects.get(pk=record["id"])
    run = ExtractionRun.objects.create(
        request=request,
        profile_version=request.profile_version,
        pipeline_version="assignment-extraction-v1",
        started_at=timezone.now() - timedelta(minutes=13),
    )
    assert run_extraction(record["id"]) is False
    run.refresh_from_db()
    assert run.attempts == 2
    assert run.state == "complete"
    assert len(run.results) == 10


@pytest.mark.django_db
@pytest.mark.parametrize(
    "status, transient", [(503, True), (429, True), (404, False), (200, False)]
)
def test_http_errors_and_non_html_are_visible_run_failures(
    api_client, assigned_case, monkeypatch, status, transient
):
    from apps.source_extraction.fetching import FetchBatch, FetchedPage, FetchRecord
    from apps.source_proposals.extraction import run_extraction

    proposal, assignment, _, _, _ = assigned_case

    class HttpErrorFetcher:
        def fetch(self, urls, **kwargs):
            return FetchBatch(
                tuple(
                    FetchRecord(
                        url,
                        page=FetchedPage(
                            url, status, b"failure", {"content-type": "application/json"}
                        ),
                    )
                    for url in urls
                )
            )

    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: HttpErrorFetcher()
    )
    record = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {
            "assignment": assignment["id"],
            "url": proposal.website_url,
        },
        format="json",
    ).json()
    assert run_extraction(record["id"]) is transient
    run = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()["assignment"][
        "recent_requests"
    ][0]["run"]
    assert run["state"] == "failed"
    assert run["failed"] == 1
    assert run["errors"][0]["transient"] is transient
