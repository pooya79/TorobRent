import pytest

from tests.test_extraction_publication import execute_run


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_valid_results_publish_automatically_and_reuse_canonical_identity(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    first = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert first["published"] == 10
    assert first["needs_attention"] == 0
    assert first["decisions"] == []
    assert all(candidate["state"] == "published" for candidate in first["candidates"])
    assert first["candidates"][0]["history"][-1]["actor_label"] == "انتشار خودکار"
    target = "https://khaneh.example/listing/10000"
    assigned_case[4].pages[target] = (
        assigned_case[4].pages[target].replace("۲۰ میلیون", "۲۵ میلیون")
    )
    second = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert second["published"] == 10
    assert [c["listing_id"] for c in second["candidates"]] == [
        c["listing_id"] for c in first["candidates"]
    ]
    assert second["candidates"][0]["monthly_rent_rial"] == 250_000_000


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_changed_review_mode_cancels_queued_work(api_client, assigned_case, monkeypatch):
    from django.db import connection

    from apps.source_proposals.extraction import run_extraction

    proposal, assignment, _, _, fetcher = assigned_case
    monkeypatch.setattr("apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: fetcher)
    response = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {"assignment": assignment["id"], "url": proposal.website_url},
        format="json",
    )
    assert response.status_code == 201
    # Simulate an administrative authority change, bypassing immutable decision APIs.
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE source_proposals_sourceprofiledecision SET review_mode = %s",
            ["approval_required"],
        )
    assert run_extraction(response.json()["id"]) is False
    case = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()
    run = case["assignment"]["recent_requests"][0]["run"]
    assert run["state"] == "cancelled"
    assert run["published"] == 0
    assert run["candidates"] == []


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
@pytest.mark.parametrize("exception", ["conflict", "missing", "low_coverage", "drift"])
def test_exceptions_stay_individually_reviewable_while_other_pages_publish(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks, exception
):
    target = "https://khaneh.example/listing/10000"
    html = assigned_case[4].pages[target]
    if exception == "conflict":
        html = html.replace('class="area">85', 'class="area">95')
    elif exception == "missing":
        html = html.replace("۵۰۰ میلیون تومان", "نامشخص")
    elif exception == "low_coverage":
        html = html.replace("۵۰۰ میلیون تومان", "نامشخص").replace("۲۰ میلیون تومان", "نامشخص")
        html = html.replace('"value":"85"', '"value":"نامشخص"').replace("85 متر", "نامشخص")
    else:
        html = (
            "<article><h1>اجاره آپارتمان در تهران</h1>"
            "<section>متراژ اتاق ودیعه ساختار تازه</section></article>"
        )
    assigned_case[4].pages[target] = html
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert run["published"] == 9
    assert run["needs_attention"] == 1
    candidate = next(c for c in run["candidates"] if c["external_url"] == target)
    assert candidate["state"] == "pending"
    assert candidate["listing_id"] is None
    base = f"/api/v1/operator/external-listing-candidates/{candidate['id']}"
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    case_before = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    corrected = api_client.post(
        f"{base}/correct/",
        {
            "reviewed_revision": candidate["revision"],
            "reason": "بررسی مستقل اطلاعات ملک",
            "values": {
                **{
                    name: run["candidates"][1][name]
                    for name in ("city", "district", "neighborhood")
                },
                "property_type": "apartment",
                "area_sqm": 95,
                "room_count": 2,
                "deposit_rial": 5_000_000_000,
                "monthly_rent_rial": 200_000_000,
            },
        },
        format="json",
    )
    assert corrected.status_code == 200, corrected.data
    assert corrected.json()["validation_errors"] == {}
    approved = api_client.post(
        f"{base}/approve/",
        {"reviewed_revision": corrected.json()["revision"], "confirmed": True},
        format="json",
    )
    assert approved.status_code == 200, approved.data
    case_after = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    assert case_after["profile_versions"] == case_before["profile_versions"]
    assert case_after["assignment"]["recent_requests"][0]["run"]["published"] == 10


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_operator_starts_explicit_profile_review_separately_from_candidates(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    first = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    before = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    base = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}"
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(
            f"{base}/profile/review/",
            {"reviewed_revision": before["revision"], "confirmed": True},
            format="json",
        )
    assert response.status_code == 200, response.data
    review = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    assert review["state"] == "pending"
    assert len(review["profile_versions"]) == 2
    assert review["profile_versions"][0]["parent"] == before["profile_versions"][0]["id"]
    assert review["assignment"]["recent_requests"][0]["run"] == first
    new_version = review["profile_versions"][0]
    approved = api_client.post(
        f"{base}/profile/approve/",
        {
            "reviewed_revision": review["revision"],
            "reviewed_profile_version": new_version["id"],
            "confirmed": True,
            "review_mode": "approval_required",
        },
        format="json",
    )
    assert approved.status_code == 200, approved.data
    assert approved.json()["assignment"]["id"] == before["assignment"]["id"]
    assert approved.json()["assignment"]["active_profile_version"]["id"] == new_version["id"]


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
def test_partial_fetch_failure_does_not_block_publication_or_duplicate_delivery(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_extraction.fetching import (
        FetchBatch,
        FetchFailure,
        FetchFailureCode,
        FetchRecord,
    )
    from apps.source_proposals.extraction import run_extraction

    fetcher = assigned_case[4]
    target = "https://khaneh.example/listing/10000"

    class PartialFetcher:
        def fetch(self, urls, **kwargs):
            if urls == [target]:
                return FetchBatch((
                    FetchRecord(
                        target,
                        failure=FetchFailure(
                            FetchFailureCode.TIMEOUT, target, "timeout", transient=True
                        ),
                    ),
                ))
            return fetcher.fetch(urls, **kwargs)

    run = execute_run(
        api_client,
        (*assigned_case[:4], PartialFetcher()),
        monkeypatch,
        django_capture_on_commit_callbacks,
    )
    assert run["state"] == "complete"
    assert run["failed"] == 1
    assert run["extracted"] == run["published"] == 9
    assert run["needs_attention"] == run["rejected"] == 0
    case = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    request = case["assignment"]["recent_requests"][0]
    assert run_extraction(request["id"]) is False
    assert api_client.get("/api/v1/operator/source-proposals/").json()[0] == case


@pytest.mark.django_db
@pytest.mark.parametrize("assigned_case", ["automatic"], indirect=True)
@pytest.mark.parametrize(
    "change", ["confirmation", "revision", "operator", "representative", "revoked"]
)
def test_starting_profile_review_requires_current_explicit_operator_authority(
    api_client, assigned_case, change
):
    from django.utils import timezone

    from apps.source_proposals.models import SourceAssignment
    from tests.test_source_proposal_review import make_operator

    proposal, assignment, operator, representative, _ = assigned_case
    api_client.force_authenticate(operator)
    before = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    if change == "operator":
        api_client.force_authenticate(make_operator(email="other-profile-review@example.com"))
    elif change == "representative":
        api_client.force_authenticate(representative)
    elif change == "revoked":
        SourceAssignment.objects.filter(pk=assignment["id"]).update(revoked_at=timezone.now())
    response = api_client.post(
        f"/api/v1/operator/source-proposals/{proposal.pk}/profile/review/",
        {
            "reviewed_revision": 99 if change == "revision" else before["revision"],
            "confirmed": change != "confirmation",
        },
        format="json",
    )
    assert response.status_code in (400, 403, 409)
    api_client.force_authenticate(operator)
    after = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    assert after["profile_versions"] == before["profile_versions"]
    assert after["state"] == "approved"
