import pytest

from tests.test_extraction_publication import execute_run


def exclusion_action(client, case, action="preview", **body):
    client.force_authenticate(case[2])
    return client.post(
        f"/api/v1/operator/source-proposals/{case[0].pk}/exclusions/{action}/",
        body,
        format="json",
    )


@pytest.mark.django_db
def test_preview_normalizes_exact_urls_and_reports_known_examples(api_client, assigned_case):
    response = exclusion_action(
        api_client,
        assigned_case,
        kind="exact",
        url="https://KHANEH.example:443/listing/10000/?utm_source=x#top",
    )
    assert response.status_code == 200, response.content
    assert response.json() == {
        "kind": "exact",
        "url": "https://khaneh.example/listing/10000",
        "known_pages": ["https://khaneh.example/listing/10000"],
        "published_listings": [],
        "known_page_count": 1,
        "published_listing_count": 0,
    }
    empty = exclusion_action(
        api_client, assigned_case, kind="exact", url="https://khaneh.example/listing/10000?unit=2"
    )
    assert empty.json()["known_page_count"] == 0


def add_exclusion(
    client, case, url="https://khaneh.example/listing", kind="path_prefix", **overrides
):
    return exclusion_action(
        client,
        case,
        "add",
        kind=kind,
        url=url,
        reason="صفحات پشتیبانی نمی‌شود",
        confirmed=True,
        **overrides,
    )


@pytest.mark.django_db
def test_exclusion_holds_backlog_preserves_evidence_and_removal_requires_explicit_publication(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    added = add_exclusion(api_client, assigned_case)
    assert added.status_code == 200, added.content
    restriction = added.json()["assignment"]["exclusions"][0]
    assert restriction["active"] is True
    held = added.json()["assignment"]["recent_requests"][0]["run"]
    assert all(c["exclusion_hold"] == restriction["id"] for c in held["candidates"])
    assert held["candidates"][0]["evidence"] == run["candidates"][0]["evidence"]
    approve_url = (
        f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/"
    )
    assert (
        api_client.post(
            approve_url, {"reviewed_revision": held["revision"], "confirmed": True}, format="json"
        ).status_code
        == 409
    )
    removed = exclusion_action(
        api_client,
        assigned_case,
        "remove",
        exclusion_id=restriction["id"],
        reason="پشتیبانی برقرار شد",
        confirmed=True,
    )
    assert removed.status_code == 200, removed.content
    assert removed.json()["assignment"]["exclusions"][0]["active"] is False
    retained = removed.json()["assignment"]["recent_requests"][0]["run"]
    assert retained["published"] == 0
    approved = api_client.post(
        approve_url, {"reviewed_revision": retained["revision"], "confirmed": True}, format="json"
    )
    assert approved.status_code == 200, approved.content
    assert approved.json()["published"] == 10


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_excluded_pages_are_skipped_and_published_listings_need_separate_withdrawal(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.catalog.models import Listing

    first = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    added = add_exclusion(api_client, assigned_case)
    rule = added.json()["assignment"]["exclusions"][0]
    assert Listing.objects.filter(state="published").count() == 10
    preview = exclusion_action(api_client, assigned_case, kind=rule["kind"], url=rule["url"]).json()
    assert preview["published_listing_count"] == 10
    assert {item["id"] for item in preview["published_listings"]} == {
        c["listing_id"] for c in first["candidates"]
    }
    assigned_case[4].calls.clear()
    skipped = execute_run(
        api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
    )
    assert skipped["state"] == "complete"
    assert skipped["failed"] == skipped["published"] == skipped["extracted"] == 0
    assert len(skipped["skipped_pages"]) == 10
    assert all(page["reason"] == rule["reason"] for page in skipped["skipped_pages"])
    assert all("/listing/" not in url for urls, _ in assigned_case[4].calls for url in urls)
    response = exclusion_action(
        api_client,
        assigned_case,
        "withdraw",
        exclusion_id=rule["id"],
        reason="حذف آگهی‌های خارج از پشتیبانی",
        confirmed=True,
        listing_ids=[item["id"] for item in preview["published_listings"]],
    )
    assert response.status_code == 200, response.content
    assert Listing.objects.filter(state="published").count() == 0
    assert response.json()["assignment"]["exclusions"][0]["actions"][0]["listing_ids"] == [
        item["id"] for item in preview["published_listings"]
    ]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "kind,pattern,expected",
    [
        ("path_prefix", "https://khaneh.example/listing/1000", []),
        (
            "path_prefix",
            "https://khaneh.example/listing/10000/",
            ["https://khaneh.example/listing/10000"],
        ),
        (
            "path_prefix",
            "https://khaneh.example/listing",
            [f"https://khaneh.example/listing/{n}" for n in range(10000, 10010)],
        ),
    ],
)
def test_path_sections_do_not_match_similar_names(
    api_client, assigned_case, kind, pattern, expected
):
    response = exclusion_action(api_client, assigned_case, kind=kind, url=pattern)
    assert response.status_code == 200
    assert response.json()["known_pages"] == expected


@pytest.mark.django_db
@pytest.mark.parametrize(
    "url",
    [
        "https://other.example/listing",
        "https://sub.khaneh.example/listing",
        "https://khaneh.example.evil.example/listing",
        "https://khaneh.example/listing?category=1",
        "https://user@khaneh.example/listing",
    ],
)
def test_exclusions_cannot_escape_the_assigned_website(api_client, assigned_case, url):
    assert add_exclusion(api_client, assigned_case, url=url).status_code == 400


@pytest.mark.django_db
@pytest.mark.parametrize(
    "denial",
    ["other_operator", "representative", "capability", "revoked", "reason", "confirmation"],
)
def test_exclusions_require_responsibility_reason_and_confirmation(
    api_client, assigned_case, denial
):
    from django.utils import timezone

    from apps.source_proposals.models import SourceAssignment
    from tests.test_source_proposal_review import make_operator

    case = list(assigned_case)
    if denial == "other_operator":
        case[2] = make_operator(email="exclusion-other@example.com")
    elif denial == "representative":
        case[2] = case[3]
    elif denial == "capability":
        case[2].user_permissions.clear()
    elif denial == "revoked":
        SourceAssignment.objects.filter(pk=case[1]["id"]).update(revoked_at=timezone.now())
    response = exclusion_action(
        api_client,
        case,
        "add",
        kind="exact",
        url="https://khaneh.example/listing/10000",
        reason="" if denial == "reason" else "غیرقابل پشتیبانی",
        confirmed=denial != "confirmation",
    )
    assert response.status_code in (400, 403)
    api_client.force_authenticate(case[3])
    assert (
        api_client.get(f"/api/v1/source-proposals/{case[0].pk}/").json()["assignment"]["exclusions"]
        == []
    )


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
@pytest.mark.parametrize("remove_during_fetch", [False, True])
def test_in_flight_results_remain_held_even_after_removal(
    api_client, assigned_case, monkeypatch, remove_during_fetch
):
    from rest_framework.test import APIClient

    from apps.source_proposals.tasks import extract_source

    proposal, assignment, _, representative, fetcher = assigned_case
    requested = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {"assignment": assignment["id"], "url": proposal.website_url},
        format="json",
    )
    changed = False

    class ChangingFetcher:
        def fetch(self, urls, **kwargs):
            nonlocal changed
            result = fetcher.fetch(urls, **kwargs)
            if "/listing/" in urls[0] and not changed:
                changed = True
                client = APIClient()
                added = add_exclusion(client, assigned_case)
                assert added.status_code == 200
                if remove_during_fetch:
                    rule = added.json()["assignment"]["exclusions"][0]
                    assert (
                        exclusion_action(
                            client,
                            assigned_case,
                            "remove",
                            exclusion_id=rule["id"],
                            reason="إعادة الدعم",
                            confirmed=True,
                        ).status_code
                        == 200
                    )
            return result

    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: ChangingFetcher()
    )
    extract_source.run(requested.json()["id"])
    api_client.force_authenticate(representative)
    case = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()
    run = case["assignment"]["recent_requests"][0]["run"]
    assert run["state"] == "complete"
    assert run["published"] == 0
    assert all(c["exclusion_hold"] for c in run["candidates"])
    assert all("actor" not in rule for rule in case["assignment"]["exclusions"])


@pytest.mark.django_db
def test_exclusion_does_not_erase_failure_evidence_or_allow_individual_approval(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    target = "https://khaneh.example/listing/10000"
    assigned_case[4].pages[target] = (
        assigned_case[4].pages[target].replace('class="area">85', 'class="area">95')
    )
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    bad = next(c for c in run["candidates"] if c["external_url"] == target)
    base = f"/api/v1/operator/external-listing-candidates/{bad['id']}"
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    corrected = api_client.post(
        f"{base}/correct/",
        {"reviewed_revision": bad["revision"], "reason": "بررسی متراژ", "values": {"area_sqm": 95}},
        format="json",
    )
    assert corrected.status_code == 200
    added = add_exclusion(api_client, assigned_case, url=target, kind="exact")
    held = next(
        c
        for c in added.json()["assignment"]["recent_requests"][0]["run"]["candidates"]
        if c["id"] == bad["id"]
    )
    assert held["evidence"] == bad["evidence"]
    assert held["conflicts"] == bad["conflicts"]
    assert held["exclusion_reason"] == "صفحات پشتیبانی نمی‌شود"
    assert (
        api_client.post(
            f"{base}/approve/",
            {"reviewed_revision": corrected.json()["revision"], "confirmed": True},
            format="json",
        ).status_code
        == 400
    )


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_postgres_exclusion_commits_while_worker_is_fetching(
    api_client, assigned_case, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.db import close_old_connections, connection

    from apps.source_proposals.tasks import extract_source

    if connection.vendor != "postgresql":
        pytest.skip("Worker publication race requires PostgreSQL")
    proposal, assignment, _, representative, fetcher = assigned_case
    monkeypatch.setattr(extract_source, "delay", lambda *args: None)
    requested = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {"assignment": assignment["id"], "url": proposal.website_url},
        format="json",
    )
    fetching, resume = Event(), Event()

    class PausedFetcher:
        def fetch(self, urls, **kwargs):
            result = fetcher.fetch(urls, **kwargs)
            fetching.set()
            assert resume.wait(timeout=20)
            return result

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
            assert add_exclusion(api_client, assigned_case).status_code == 200
        finally:
            resume.set()
        worker.result(timeout=20)
    api_client.force_authenticate(representative)
    run = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()["assignment"][
        "recent_requests"
    ][0]["run"]
    assert run["published"] == 0
    assert len(run["skipped_pages"]) == 10


@pytest.mark.django_db(transaction=True)
def test_postgres_exclusion_and_bulk_approval_share_publication_boundary(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    from apps.catalog.models import Listing

    if connection.vendor != "postgresql":
        pytest.skip("Approval serialization requires PostgreSQL")
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    barrier = Barrier(2)

    def act(action):
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(assigned_case[2])
            barrier.wait(timeout=15)
            if action == "exclude":
                return add_exclusion(client, assigned_case).status_code
            return client.post(
                f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/",
                {"reviewed_revision": run["revision"], "confirmed": True},
                format="json",
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        exclusion, approval = list(pool.map(act, ["exclude", "approve"]))
    assert exclusion == 200
    assert approval in (200, 409)
    # Whichever holds the Source lock first commits as one complete operation.
    assert Listing.objects.filter(state="published").count() == (10 if approval == 200 else 0)


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_removal_allows_fresh_extraction_and_keeps_failed_pages_visible(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_extraction.fetching import FetchBatch, FetchedPage, FetchRecord

    added = add_exclusion(api_client, assigned_case)
    rule = added.json()["assignment"]["exclusions"][0]
    assert (
        exclusion_action(
            api_client,
            assigned_case,
            "remove",
            exclusion_id=rule["id"],
            reason="پشتیبانی برقرار شد",
            confirmed=True,
        ).status_code
        == 200
    )
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert run["published"] == 10
    assert run["skipped_pages"] == []
    fetcher = assigned_case[4]
    target = "https://khaneh.example/listing/10000"

    class FailingFetcher:
        def fetch(self, urls, **kwargs):
            if urls == [target]:
                return FetchBatch((FetchRecord(target, page=FetchedPage(target, 503, b"", {})),))
            return fetcher.fetch(urls, **kwargs)

    failed = execute_run(
        api_client,
        (*assigned_case[:4], FailingFetcher()),
        monkeypatch,
        django_capture_on_commit_callbacks,
    )
    assert failed["failed"] == 1
    assert failed["errors"][0]["code"] == "unsupported_response"
    assert failed["skipped_pages"] == []
    assert failed["published"] == 9
    assert (
        len(
            api_client.get("/api/v1/operator/source-proposals/").json()[0]["assignment"][
                "exclusions"
            ]
        )
        == 1
    )


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_withdrawal_rejects_unreviewed_nonmatching_listings_and_duplicate_decisions(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.catalog.models import Listing

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    target = run["candidates"][0]
    added = add_exclusion(api_client, assigned_case, url=target["external_url"], kind="exact")
    rule = added.json()["assignment"]["exclusions"][0]
    assert (
        add_exclusion(
            api_client, assigned_case, url=target["external_url"], kind="exact"
        ).status_code
        == 400
    )
    denied = exclusion_action(
        api_client,
        assigned_case,
        "withdraw",
        exclusion_id=rule["id"],
        reason="خروج",
        confirmed=True,
        listing_ids=[run["candidates"][1]["listing_id"]],
    )
    assert denied.status_code == 400
    assert Listing.objects.filter(state="published").count() == 10
    assert (
        exclusion_action(
            api_client,
            assigned_case,
            "remove",
            exclusion_id=rule["id"],
            reason="پایان",
            confirmed=True,
        ).status_code
        == 200
    )
    assert (
        exclusion_action(
            api_client,
            assigned_case,
            "remove",
            exclusion_id=rule["id"],
            reason="تکرار",
            confirmed=True,
        ).status_code
        == 400
    )


@pytest.mark.django_db
def test_preview_includes_newly_failed_known_pages(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_extraction.fetching import FetchBatch, FetchedPage, FetchRecord

    target = "https://khaneh.example/listing/failed-new"
    fetcher = assigned_case[4]
    fetcher.pages[assigned_case[0].website_url] += f'<a href="{target}">اجاره آپارتمان تهران</a>'

    class FailingFetcher:
        def fetch(self, urls, **kwargs):
            if urls == [target]:
                return FetchBatch((FetchRecord(target, page=FetchedPage(target, 503, b"", {})),))
            return fetcher.fetch(urls, **kwargs)

    run = execute_run(
        api_client,
        (*assigned_case[:4], FailingFetcher()),
        monkeypatch,
        django_capture_on_commit_callbacks,
    )
    assert run["failed"] == 1
    preview = exclusion_action(api_client, assigned_case, kind="exact", url=target)
    assert preview.json()["known_pages"] == [target]


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
@pytest.mark.parametrize("timing", ["during", "removed_during", "after", "published"])
def test_redirected_results_remember_restrictions_on_the_requested_url(
    api_client, assigned_case, monkeypatch, timing
):
    from dataclasses import replace

    from rest_framework.test import APIClient

    from apps.source_extraction.fetching import FetchBatch
    from apps.source_proposals.tasks import extract_source

    original = "https://khaneh.example/listing/10000"
    destination = "https://khaneh.example/rental/10000"
    proposal, assignment, _, representative, fetcher = assigned_case
    # Keep results pending for the completed-backlog scenario.
    if timing == "after":
        from tests.test_publication_modes import change_mode

        assert change_mode(api_client, assigned_case, "approval_required").status_code == 200
        api_client.force_authenticate(representative)
    requested = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {"assignment": assignment["id"], "url": proposal.website_url},
        format="json",
    )

    class RedirectingFetcher:
        def fetch(self, urls, **kwargs):
            result = fetcher.fetch(urls, **kwargs)
            if urls == [original]:
                if timing in ("during", "removed_during"):
                    client = APIClient()
                    added = add_exclusion(client, assigned_case, url=original, kind="exact")
                    assert added.status_code == 200
                    if timing == "removed_during":
                        rule = added.json()["assignment"]["exclusions"][0]
                        assert (
                            exclusion_action(
                                client,
                                assigned_case,
                                "remove",
                                exclusion_id=rule["id"],
                                reason="پشتیبانی تازه",
                                confirmed=True,
                            ).status_code
                            == 200
                        )
                return FetchBatch((
                    replace(
                        result.records[0], page=replace(result.records[0].page, url=destination)
                    ),
                ))
            return result

    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: RedirectingFetcher()
    )
    extract_source.run(requested.json()["id"])
    if timing in ("after", "published"):
        assert (
            add_exclusion(api_client, assigned_case, url=original, kind="exact").status_code == 200
        )
    api_client.force_authenticate(representative)
    run = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()["assignment"][
        "recent_requests"
    ][0]["run"]
    assert run["state"] == "complete"
    redirected = next((c for c in run["candidates"] if c["external_url"] == destination), None)
    if timing == "published":
        assert redirected["listing_id"] is not None
        preview = exclusion_action(api_client, assigned_case, kind="exact", url=original).json()
        assert preview["published_listing_count"] == 1
        rule = api_client.get("/api/v1/operator/source-proposals/").json()[0]["assignment"][
            "exclusions"
        ][0]
        assert (
            exclusion_action(
                api_client,
                assigned_case,
                "withdraw",
                exclusion_id=rule["id"],
                reason="خروج",
                confirmed=True,
                listing_ids=[redirected["listing_id"]],
            ).status_code
            == 200
        )
        return
    assert redirected is None or (redirected["listing_id"] is None and redirected["exclusion_hold"])
    if timing == "during":
        assert any(p["url"] == original for p in run["skipped_pages"])


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_exclusion_during_redirected_unavailability_preserves_listing_and_failure(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from dataclasses import replace

    from rest_framework.test import APIClient

    from apps.catalog.models import Listing
    from apps.source_extraction.fetching import FetchBatch

    original = "https://khaneh.example/listing/10000"
    destination = "https://khaneh.example/rental/10000"
    fetcher = assigned_case[4]
    unavailable = False

    class RedirectingFetcher:
        def fetch(self, urls, **kwargs):
            result = fetcher.fetch(urls, **kwargs)
            if urls == [original]:
                if unavailable:
                    assert (
                        add_exclusion(
                            APIClient(), assigned_case, url=original, kind="exact"
                        ).status_code
                        == 200
                    )
                return FetchBatch((
                    replace(
                        result.records[0],
                        page=replace(
                            result.records[0].page,
                            url=destination,
                            status_code=410 if unavailable else 200,
                        ),
                    ),
                ))
            return result

    redirected_case = (*assigned_case[:4], RedirectingFetcher())
    first = execute_run(
        api_client, redirected_case, monkeypatch, django_capture_on_commit_callbacks
    )
    assert first["published"] == 10
    unavailable = True
    second = execute_run(
        api_client, redirected_case, monkeypatch, django_capture_on_commit_callbacks
    )
    assert second["failed"] == 1
    assert second["withdrawals"] == []
    assert Listing.objects.get(external_url=destination).state == "published"
