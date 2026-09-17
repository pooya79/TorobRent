import pytest

from tests.test_extraction_publication import execute_run


@pytest.mark.django_db
def test_queue_and_overview_do_not_embed_extraction_or_profile_evidence(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    proposal = assigned_case[0]
    for params in ({"section": "queue"}, {"section": "overview", "proposal": str(proposal.pk)}):
        response = api_client.get("/api/v1/operator/source-proposals/", params)
        assert response.status_code == 200
        case = response.json()[0]
        assert case["profile_versions"] == []
        assert case["profile_repairs"] == []
        assert case["properties"] == []
        assert case["history"] == []
        assert case["assignment"]["recent_requests"] == []
        assert case["assignment"]["current_results"] == []
        assert case["assignment"]["exceptions"] == []
        assert case["assignment"]["exclusions"] == []
        assert case["counts"]["properties"] == 10
        assert len(response.content) < 12000


@pytest.mark.django_db
def test_results_search_and_pagination_return_summaries_and_evidence_is_separate(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_proposals.models import ExternalListingCandidate

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    proposal = assigned_case[0]
    source_id = assigned_case[1]["source"]["id"]
    candidates = ExternalListingCandidate.objects.bulk_create([
        ExternalListingCandidate(
            source_proposal=proposal,
            source_id=source_id,
            extraction_run_id=run["id"],
            title=f"Page {i:02}",
            external_url=f"https://khaneh.example/page/{i}",
            evidence={"title": [{"evidence_snippet": "private extraction evidence"}]},
            state="rejected" if i >= 20 else "pending",
        )
        for i in range(25)
    ])
    endpoint = f"/api/v1/operator/source-proposals/{proposal.pk}/results/"
    first = api_client.get(endpoint, {"q": "Page"})
    assert first.status_code == 200
    assert first.data["count"] == 25
    assert len(first.data["results"]) == 20
    assert b"private extraction evidence" not in first.content
    second = api_client.get(endpoint, {"q": "Page", "page": 2})
    assert len(second.data["results"]) == 5
    assert not (
        {r["id"] for r in first.data["results"]} & {r["id"] for r in second.data["results"]}
    )
    archived = api_client.get(endpoint, {"q": "Page", "status": "archived"})
    assert archived.data["count"] == 5
    detail = api_client.get(f"/api/v1/operator/external-listing-candidates/{candidates[0].pk}/")
    assert detail.status_code == 200
    assert detail.data["evidence"]["title"][0]["evidence_snippet"] == "private extraction evidence"
    api_client.force_authenticate(assigned_case[3])
    assert api_client.get(endpoint).status_code == 403
    assert (
        api_client.get(
            f"/api/v1/operator/external-listing-candidates/{candidates[0].pk}/"
        ).status_code
        == 403
    )


@pytest.mark.django_db
def test_run_history_is_paginated_without_nested_candidates(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from django.utils import timezone

    from apps.source_proposals.models import ExtractionRequest, ExtractionRun

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    original = ExtractionRequest.objects.get(run__pk=run["id"])
    for i in range(24):
        request = ExtractionRequest.objects.create(
            assignment=original.assignment,
            requester=original.requester,
            profile_version=original.profile_version,
            review_mode=original.review_mode,
            submitted_url=f"https://khaneh.example/history/{i}",
            canonical_url=f"https://khaneh.example/history/{i}",
            state="complete",
        )
        ExtractionRun.objects.create(
            request=request,
            profile_version=original.profile_version,
            state="complete",
            started_at=timezone.now(),
            results=[{"evidence": "do not send"}],
        )
    endpoint = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/"
    first = api_client.get(endpoint)
    assert first.status_code == 200
    assert first.data["count"] == 25
    assert len(first.data["results"]) == 20
    last = api_client.get(endpoint, {"page": 2})
    assert len(last.data["results"]) == 5
    assert all(row["run"]["candidates"] == [] for row in last.data["results"])
    assert b"do not send" not in first.content
    searched = api_client.get(endpoint, {"q": "/history/23"})
    assert searched.data["count"] == 1


@pytest.mark.django_db
def test_case_history_pages_are_separate_from_overview(api_client, assigned_case):
    from apps.source_proposals.models import SourceProposalEvent

    proposal = assigned_case[0]
    api_client.force_authenticate(assigned_case[2])
    for i in range(24):
        SourceProposalEvent.objects.create(
            proposal=proposal,
            actor=assigned_case[2],
            revision=1,
            prior_state="pending",
            new_state="pending",
            reason=f"Review note {i}",
        )
    endpoint = f"/api/v1/operator/source-proposals/{proposal.pk}/history/"
    first = api_client.get(endpoint, {"q": "Review note"})
    assert first.status_code == 200
    assert first.data["count"] == 24
    assert len(first.data["results"]) == 20
    assert len(api_client.get(endpoint, {"q": "Review note", "page": 2}).data["results"]) == 4


@pytest.mark.django_db
def test_new_success_replaces_old_payload_but_preserves_run_summary(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_proposals.models import ExternalListingCandidate, ExtractionRun

    first = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    second = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    old = ExternalListingCandidate.objects.filter(extraction_run_id=first["id"])
    assert old.count() == 10
    assert all(c.superseded and c.evidence == {} and c.source_claims == {} for c in old)
    assert all(
        c.evidence for c in ExternalListingCandidate.objects.filter(extraction_run_id=second["id"])
    )
    retained = ExtractionRun.objects.get(pk=first["id"])
    assert retained.extracted == 10
    assert retained.results == []


@pytest.mark.django_db
def test_all_case_collections_are_bounded_and_operator_only(api_client, assigned_case):
    proposal = assigned_case[0]
    api_client.force_authenticate(assigned_case[2])
    for resource in (
        "history",
        "responsibility-history",
        "profiles",
        "repairs",
        "problems",
        "exclusions",
    ):
        response = api_client.get(
            f"/api/v1/operator/source-proposals/{proposal.pk}/{resource}/",
            {"q": "", "page_size": 1000},
        )
        assert response.status_code == 200, (resource, response.data)
        assert len(response.data["results"]) <= 20
    api_client.force_authenticate(assigned_case[3])
    for resource in (
        "history",
        "responsibility-history",
        "profiles",
        "repairs",
        "problems",
        "exclusions",
    ):
        assert (
            api_client.get(
                f"/api/v1/operator/source-proposals/{proposal.pk}/{resource}/"
            ).status_code
            == 403
        )


@pytest.mark.django_db
def test_failed_attempt_preserves_previous_success_and_published_content(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.catalog.models import Listing
    from apps.source_proposals.models import ExternalListingCandidate, ExtractionRun
    from apps.source_proposals.retention import replace_obsolete_results

    first = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    endpoint = (
        f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{first['id']}/approve/"
    )
    assert (
        api_client.post(
            endpoint, {"reviewed_revision": first["revision"], "confirmed": True}, format="json"
        ).status_code
        == 200
    )
    content = list(Listing.objects.order_by("pk").values("id", "description", "source_claims"))
    run = ExtractionRun.objects.get(pk=first["id"])
    from apps.source_proposals.models import ExtractionRequest

    failed_request = ExtractionRequest.objects.create(
        assignment=run.request.assignment,
        requester=run.request.requester,
        profile_version=run.profile_version,
        review_mode=run.request.review_mode,
        submitted_url=run.request.submitted_url,
        canonical_url=run.request.canonical_url,
        state="failed",
    )
    failed = ExtractionRun.objects.create(
        request=failed_request,
        profile_version=run.profile_version,
        state="failed",
        started_at=run.started_at,
    )
    replace_obsolete_results(failed)
    assert (
        ExternalListingCandidate.objects.filter(extraction_run=run, superseded=False).count() == 10
    )
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert (
        list(Listing.objects.order_by("pk").values("id", "description", "source_claims")) == content
    )
    assert all(
        c.evidence == {} for c in ExternalListingCandidate.objects.filter(extraction_run=run)
    )
