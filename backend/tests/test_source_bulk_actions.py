import pytest

from tests.test_extraction_publication import execute_run


@pytest.mark.django_db
def test_preview_mixed_results_then_publish_only_selected_eligible_pages(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    fetcher = assigned_case[4]
    bad_url = "https://khaneh.example/listing/10000"
    fetcher.pages[bad_url] = fetcher.pages[bad_url].replace('class="area">85', 'class="area">95')
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    case = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    pages = case["assignment"]["current_results"]
    base = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/exceptions/bulk"
    preview = api_client.post(
        f"{base}/preview/",
        {"exception_ids": [item["id"] for item in pages[:3]], "action": "publish"},
        format="json",
    )
    assert preview.status_code == 200, preview.data
    assert [row["status"] for row in preview.data["items"]] == ["blocked", "eligible", "eligible"]
    applied = api_client.post(
        f"{base}/apply/", {"token": preview.data["token"], "confirmed": True}, format="json"
    )
    assert applied.status_code == 200, applied.data
    assert applied.data["affected"] == 2
    assert (
        api_client.post(
            f"{base}/apply/", {"token": preview.data["token"], "confirmed": True}, format="json"
        ).status_code
        == 409
    )
    fresh = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    assert fresh["assignment"]["recent_requests"][0]["run"]["published"] == 2


@pytest.mark.django_db
def test_bulk_exclusion_previews_published_impact_and_does_not_withdraw(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    root = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}"
    assert (
        api_client.post(
            f"{root}/runs/{run['id']}/approve/",
            {
                "reviewed_revision": run["revision"],
                "confirmed": True,
            },
            format="json",
        ).status_code
        == 200
    )
    pages = api_client.get("/api/v1/operator/source-proposals/").json()[0]["assignment"][
        "current_results"
    ]
    preview = api_client.post(
        f"{root}/exceptions/bulk/preview/",
        {
            "exception_ids": [pages[0]["id"], pages[1]["id"]],
            "action": "exclude",
            "reason": "صفحه خارج از محدوده",
        },
        format="json",
    )
    assert preview.status_code == 200, preview.data
    assert [row["published_listing_count"] for row in preview.data["items"]] == [1, 1]
    assert all(row["action_eligible"] for row in preview.data["items"])
    applied = api_client.post(
        f"{root}/exceptions/bulk/apply/",
        {
            "token": preview.data["token"],
            "confirmed": True,
        },
        format="json",
    )
    assert applied.status_code == 200, applied.data
    assert applied.data["affected"] == 2
    fresh = api_client.get("/api/v1/operator/source-proposals/").json()[0]["assignment"]
    assert len(fresh["exclusions"]) == 2
    assert fresh["recent_requests"][0]["run"]["published"] == 10


@pytest.mark.django_db
def test_representative_request_is_explicit_scoped_and_sent_once(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    pages = api_client.get("/api/v1/operator/source-proposals/").json()[0]["assignment"][
        "current_results"
    ]
    root = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/exceptions/bulk"
    preview = api_client.post(
        f"{root}/preview/",
        {
            "exception_ids": [pages[0]["id"]],
            "action": "request_action",
            "reason": "لطفا متراژ این صفحه را بررسی کنید",
        },
        format="json",
    )
    assert preview.status_code == 200, preview.data
    assert api_client.get("/api/v1/messages/?kind=source_conversation").json()["count"] == 0
    applied = api_client.post(
        f"{root}/apply/",
        {
            "token": preview.data["token"],
            "confirmed": True,
        },
        format="json",
    )
    assert applied.status_code == 200, applied.data
    assert (
        api_client.post(
            f"{root}/apply/",
            {
                "token": preview.data["token"],
                "confirmed": True,
            },
            format="json",
        ).status_code
        == 409
    )
    api_client.force_authenticate(assigned_case[3])
    feed = api_client.get("/api/v1/messages/?kind=source_conversation&unread=true").json()
    assert feed["count"] == 1
    detail = api_client.get(f"/api/v1/messages/{feed['results'][0]['id']}/").json()
    assert len(detail["entries"]) == 1
    assert "لطفا متراژ این صفحه را بررسی کنید" in detail["entries"][0]["body"]
    assert pages[0]["canonical_url"] in detail["entries"][0]["body"]
    assert pages[1]["canonical_url"] not in detail["entries"][0]["body"]
    assert detail["reply_allowed"] is True


@pytest.mark.django_db
@pytest.mark.parametrize(
    "change", ["pause", "exclusion", "rerun", "mode", "responsibility", "claim"]
)
def test_changed_scope_requires_a_fresh_preview(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks, change
):
    from datetime import timedelta

    from django.utils import timezone

    from apps.source_proposals.models import ExternalListingCandidateReviewClaim
    from tests.test_source_proposal_review import make_operator

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    case = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    page = case["assignment"]["current_results"][0]
    root = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}"
    preview = api_client.post(
        f"{root}/exceptions/bulk/preview/",
        {
            "exception_ids": [page["id"]],
            "action": "publish",
        },
        format="json",
    )
    assert preview.status_code == 200
    if change == "pause":
        result = api_client.post(
            f"{root}/processing/",
            {
                "action": "pause",
                "reviewed_processing_revision": 0,
                "reason": "توقف بررسی",
                "confirmed": True,
            },
            format="json",
        )
        assert result.status_code == 200, result.data
    elif change == "exclusion":
        assert (
            api_client.post(
                f"{root}/exclusions/add/",
                {
                    "kind": "exact",
                    "url": page["canonical_url"],
                    "reason": "خارج از محدوده",
                    "confirmed": True,
                },
                format="json",
            ).status_code
            == 200
        )
    elif change == "rerun":
        execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    elif change == "mode":
        assert (
            api_client.post(
                f"{root}/publication-mode/",
                {
                    "reviewed_profile_version": case["assignment"]["active_profile_version"]["id"],
                    "reviewed_mode_revision": 0,
                    "review_mode": "automatic",
                },
                format="json",
            ).status_code
            == 200
        )
    elif change == "responsibility":
        from apps.catalog.models import Source

        Source.objects.filter(pk=case["assignment"]["source"]["id"]).update(
            responsible_operator=make_operator(email="new@example.com")
        )
    else:
        candidate = next(
            item for item in run["candidates"] if item["external_url"] == page["canonical_url"]
        )
        ExternalListingCandidateReviewClaim.objects.create(
            candidate_id=candidate["id"],
            operator=make_operator(email="claim@example.com"),
            revision=candidate["revision"],
            expires_at=timezone.now() + timedelta(minutes=10),
        )
    applied = api_client.post(
        f"{root}/exceptions/bulk/apply/",
        {
            "token": preview.data["token"],
            "confirmed": True,
        },
        format="json",
    )
    assert applied.status_code in (400, 409), applied.data
    fresh = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    assert all(item["run"]["published"] == 0 for item in fresh["assignment"]["recent_requests"])


@pytest.mark.django_db
def test_cross_source_duplicate_and_tampered_selections_are_rejected(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.catalog.models import Source
    from apps.source_proposals.models import SourceExtractionException

    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    page = api_client.get("/api/v1/operator/source-proposals/").json()[0]["assignment"][
        "current_results"
    ][0]
    root = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/exceptions/bulk"
    other_source = Source.objects.create(display_name="منبع دیگر", domain="other.example")
    other_page = SourceExtractionException.objects.get(pk=page["id"])
    other_page.pk = None
    other_page.source = other_source
    other_page.canonical_url = "https://other.example/listing/1"
    other_page.save()
    for ids in ([page["id"], str(other_page.pk)], [page["id"], page["id"]]):
        assert (
            api_client.post(
                f"{root}/preview/", {"exception_ids": ids, "action": "publish"}, format="json"
            ).status_code
            == 400
        )
    preview = api_client.post(
        f"{root}/preview/", {"exception_ids": [page["id"]], "action": "publish"}, format="json"
    ).data
    assert (
        api_client.post(
            f"{root}/apply/",
            {"token": preview["token"] + "tamper", "confirmed": True},
            format="json",
        ).status_code
        == 409
    )
    assert (
        api_client.post(
            f"{root}/apply/", {"token": preview["token"], "confirmed": False}, format="json"
        ).status_code
        == 400
    )
    api_client.force_authenticate(assigned_case[3])
    assert (
        api_client.post(
            f"{root}/preview/", {"exception_ids": [page["id"]], "action": "publish"}, format="json"
        ).status_code
        == 403
    )


@pytest.mark.django_db
def test_superseded_result_and_excluded_candidate_are_visible_but_not_published(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_proposals.models import ExternalListingCandidate

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    case = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    pages = case["assignment"]["current_results"][:3]
    root = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}"
    ExternalListingCandidate.objects.filter(
        extraction_run_id=run["id"], external_url=pages[0]["canonical_url"]
    ).update(superseded=True)
    assert (
        api_client.post(
            f"{root}/exclusions/add/",
            {
                "kind": "exact",
                "url": pages[1]["canonical_url"],
                "reason": "خارج از محدوده",
                "confirmed": True,
            },
            format="json",
        ).status_code
        == 200
    )
    preview = api_client.post(
        f"{root}/exceptions/bulk/preview/",
        {
            "exception_ids": [page["id"] for page in pages],
            "action": "publish",
        },
        format="json",
    )
    assert preview.status_code == 200
    assert [item["status"] for item in preview.data["items"]] == [
        "obsolete",
        "excluded",
        "eligible",
    ]
    result = api_client.post(
        f"{root}/exceptions/bulk/apply/",
        {"token": preview.data["token"], "confirmed": True},
        format="json",
    )
    assert result.status_code == 200
    assert result.data["affected"] == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_bulk_confirmation_publishes_once(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    if connection.vendor != "postgresql":
        pytest.skip("Bulk confirmation races require PostgreSQL")
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    pages = api_client.get("/api/v1/operator/source-proposals/").json()[0]["assignment"][
        "current_results"
    ]
    root = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/exceptions/bulk"
    preview = api_client.post(
        f"{root}/preview/", {"exception_ids": [pages[0]["id"]], "action": "publish"}, format="json"
    )
    assert preview.status_code == 200
    barrier = Barrier(2)

    def confirm():
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(assigned_case[2])
            barrier.wait(timeout=20)
            return client.post(
                f"{root}/apply/", {"token": preview.data["token"], "confirmed": True}, format="json"
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: confirm(), range(2)))
    assert sorted(responses) == [200, 409]
    fresh = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    assert fresh["assignment"]["recent_requests"][0]["run"]["published"] == 1


@pytest.mark.django_db
def test_group_candidate_can_be_corrected_with_evidence_retained_and_preview_invalidated(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    case = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    page = case["assignment"]["current_results"][0]
    root = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/exceptions/bulk"
    body = {"exception_ids": [page["id"]], "action": "publish"}
    preview = api_client.post(f"{root}/preview/", body, format="json").data
    candidate = preview["items"][0]["candidate"]
    endpoint = f"/api/v1/operator/external-listing-candidates/{candidate['id']}"
    claim = api_client.post(f"{endpoint}/claim/", {"for_correction": True}, format="json")
    assert claim.status_code == 201, claim.data
    corrected = api_client.post(
        f"{endpoint}/correct/",
        {
            "reviewed_revision": candidate["revision"],
            "reason": "متراژ با منبع بررسی شد",
            "values": {"area_sqm": 120},
        },
        format="json",
    )
    assert corrected.status_code == 200, corrected.data
    assert corrected.data["evidence"] == candidate["evidence"]
    assert corrected.data["area_sqm"] == 120
    assert (
        api_client.post(
            f"{root}/apply/", {"token": preview["token"], "confirmed": True}, format="json"
        ).status_code
        == 409
    )
    fresh = api_client.post(f"{root}/preview/", body, format="json").data
    assert fresh["items"][0]["status"] == "eligible"
    assert fresh["items"][0]["candidate"]["area_sqm"] == 120
    assert (
        api_client.post(
            f"{root}/apply/", {"token": fresh["token"], "confirmed": True}, format="json"
        ).data["affected"]
        == 1
    )
    after = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    assert (
        after["assignment"]["active_profile_version"]["id"]
        == case["assignment"]["active_profile_version"]["id"]
    )
