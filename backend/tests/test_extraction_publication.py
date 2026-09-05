import pytest


def execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks):
    proposal, assignment, operator, representative, fetcher = assigned_case
    monkeypatch.setattr("apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: fetcher)
    api_client.force_authenticate(representative)
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(
            f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
            {"assignment": assignment["id"], "url": proposal.website_url},
            format="json",
        )
    assert response.status_code == 201
    api_client.force_authenticate(operator)
    case = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    return case["assignment"]["recent_requests"][0]["run"]


@pytest.mark.django_db
def test_source_proposal_to_publication_journey_preserves_evidence_and_publishes_once(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.catalog.models import Listing

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert len(run["candidates"]) == 10
    sample = run["candidates"][0]
    assert "simulated" not in sample
    assert sample["extraction_run"] == run["id"]
    assert sample["validation_errors"] == {}
    assert sample["evidence"]["floor_area_sqm"]
    assert sample["source_claims"]
    assert Listing.objects.count() == 0
    url = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/"
    approved = api_client.post(
        url, {"reviewed_revision": run["revision"], "confirmed": True}, format="json"
    )
    assert approved.status_code == 200, approved.data
    assert approved.json()["published"] == 10
    assert len(approved.json()["decisions"]) == 1
    assert Listing.objects.count() == 10
    listing = Listing.objects.get(pk=approved.json()["candidates"][0]["listing_id"])
    assert listing.terms.deposit_rial == 5_000_000_000
    assert listing.terms.monthly_rent_rial == 200_000_000
    assert listing.property.area_sqm == 85
    assert listing.source_claims
    assert (
        api_client.post(
            url, {"reviewed_revision": run["revision"], "confirmed": True}, format="json"
        ).status_code
        == 409
    )


@pytest.mark.django_db
def test_exceptions_do_not_block_batch_and_can_be_corrected_without_profile_changes(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.catalog.models import Listing
    from apps.source_proposals.models import SourceProfileVersion

    fetcher = assigned_case[4]
    bad_url = "https://khaneh.example/listing/10000"
    fetcher.pages[bad_url] = fetcher.pages[bad_url].replace('class="area">85', 'class="area">95')
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    bad = next(item for item in run["candidates"] if item["external_url"] == bad_url)
    assert "area_sqm" in bad["validation_errors"]
    assert run["needs_attention"] == 1
    url = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/"
    approved = api_client.post(
        url, {"reviewed_revision": run["revision"], "confirmed": True}, format="json"
    )
    assert approved.status_code == 200
    assert approved.json()["published"] == 9
    assert approved.json()["needs_attention"] == 1
    profile_count = SourceProfileVersion.objects.count()
    base = f"/api/v1/operator/external-listing-candidates/{bad['id']}"
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    corrected = api_client.post(
        f"{base}/correct/",
        {
            "reviewed_revision": bad["revision"],
            "reason": "متراژ بررسی شد",
            "values": {"area_sqm": 95},
        },
        format="json",
    )
    assert corrected.status_code == 200, corrected.data
    assert corrected.json()["validation_errors"] == {}
    assert corrected.json()["evidence"] == bad["evidence"]
    assert corrected.json()["conflicts"] == bad["conflicts"]
    result = api_client.post(
        f"{base}/approve/",
        {"reviewed_revision": corrected.json()["revision"], "confirmed": True},
        format="json",
    )
    assert result.status_code == 200, result.data
    assert Listing.objects.get(pk=result.json()["listing_id"]).property.area_sqm == 95
    assert SourceProfileVersion.objects.count() == profile_count
    api_client.force_authenticate(assigned_case[3])
    messages = api_client.get("/api/v1/messages/").json()
    assert "نتایج معتبر استخراج منتشر شد" in str(messages)
    assert "نتیجه استخراج منتشر شد" in str(messages)


@pytest.mark.django_db
def test_later_run_refreshes_identity_and_preserves_old_evidence(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.catalog.models import Listing, Property, RentalTerms
    from apps.source_proposals.models import ExtractionRun

    first = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)

    def approve(run):
        return api_client.post(
            f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/",
            {"reviewed_revision": run["revision"], "confirmed": True},
            format="json",
        )

    original = approve(first).json()
    url = "https://khaneh.example/listing/10000"
    assigned_case[4].pages[url] = assigned_case[4].pages[url].replace("۲۰ میلیون", "۲۵ میلیون")
    second = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    refreshed = approve(second)
    assert refreshed.status_code == 200
    assert (
        refreshed.json()["candidates"][0]["listing_id"] == original["candidates"][0]["listing_id"]
    )
    assert Listing.objects.filter(source_id=assigned_case[1]["source"]["id"]).count() == 10
    assert Property.objects.count() == RentalTerms.objects.count() == 10
    assert Listing.objects.get(external_url=url).terms.monthly_rent_rial == 250_000_000
    retained = ExtractionRun.objects.get(pk=first["id"]).results[0]
    assert retained["normalized"]["monthly_rent_rial"] == 200_000_000


@pytest.mark.django_db
@pytest.mark.parametrize(
    "change", ["operator", "representative", "revoked", "profile", "revision", "confirmation"]
)
def test_batch_rechecks_authorization_and_revision(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks, change
):
    from django.utils import timezone

    from apps.catalog.models import Listing
    from apps.source_proposals.models import SourceAssignment, SourceProfile
    from tests.test_source_proposal_review import make_operator

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    if change == "operator":
        api_client.force_authenticate(make_operator(email="other-review@example.com"))
    elif change == "representative":
        api_client.force_authenticate(assigned_case[3])
    elif change == "revoked":
        SourceAssignment.objects.filter(pk=assigned_case[1]["id"]).update(revoked_at=timezone.now())
    elif change == "profile":
        SourceProfile.objects.filter(source_id=assigned_case[1]["source"]["id"]).update(
            active_version=None
        )
    response = api_client.post(
        f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/",
        {
            "reviewed_revision": 99 if change == "revision" else run["revision"],
            "confirmed": change != "confirmation",
        },
        format="json",
    )
    assert response.status_code in (400, 403, 409)
    assert Listing.objects.count() == 0


@pytest.mark.django_db
@pytest.mark.parametrize("outcome", ["404", "410", "unavailable", "503", "absent", "temporary_404"])
def test_only_durable_unavailability_withdraws_an_existing_listing(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks, outcome
):
    from apps.catalog.models import Listing
    from apps.source_extraction.fetching import FetchBatch, FetchedPage, FetchRecord

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    response = api_client.post(
        f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/",
        {"reviewed_revision": run["revision"], "confirmed": True},
        format="json",
    )
    assert response.status_code == 200
    target = "https://khaneh.example/listing/10000"
    original_fetcher = assigned_case[4]
    calls = []

    class ChangedFetcher:
        def fetch(self, urls, **kwargs):
            if urls == [target]:
                calls.append(target)
                if outcome == "unavailable":
                    return FetchBatch((
                        FetchRecord(
                            target,
                            page=FetchedPage(
                                target,
                                200,
                                "<main><h1>این آگهی دیگر در دسترس نیست</h1></main>".encode(),
                                {"content-type": "text/html"},
                            ),
                        ),
                    ))
                if outcome in ("404", "410", "503", "temporary_404") and not (
                    outcome == "temporary_404" and len(calls) > 1
                ):
                    return FetchBatch((
                        FetchRecord(
                            target,
                            page=FetchedPage(
                                target, 404 if outcome == "temporary_404" else int(outcome), b"", {}
                            ),
                        ),
                    ))
            return original_fetcher.fetch(urls, **kwargs)

    if outcome == "absent":
        original_fetcher.pages[assigned_case[0].website_url] = original_fetcher.pages[
            assigned_case[0].website_url
        ].replace(f'<a href="{target}">اجاره آپارتمان تهران</a>', "")
    changed_case = (*assigned_case[:4], ChangedFetcher())
    later = execute_run(api_client, changed_case, monkeypatch, django_capture_on_commit_callbacks)
    assert Listing.objects.get(external_url=target).state == (
        "unavailable" if outcome in ("404", "410", "unavailable") else "published"
    )
    assert bool(later["withdrawals"]) == (outcome in ("404", "410", "unavailable"))
    assert Listing.objects.exclude(external_url=target).filter(state="published").count() == 9


@pytest.mark.django_db
@pytest.mark.parametrize(
    "field",
    [
        "city",
        "district",
        "neighborhood",
        "property_type",
        "floor_area_sqm",
        "bedroom_count",
        "deposit_rial",
        "monthly_rent_rial",
        "optional",
        "commercial",
        "out_of_range",
    ],
)
def test_required_fields_quarantine_only_the_affected_result(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks, field
):
    from dataclasses import replace

    from apps.source_extraction.contract import ExtractionContract

    apply = ExtractionContract.apply_profile

    def controlled_batch(self, profile, pages):
        results = list(apply(self, profile, pages))
        normalized = dict(results[0].normalized)
        conflicts = dict(results[0].conflicts)
        if field == "commercial":
            normalized["property_type"] = "office"
            normalized.pop("bedroom_count", None)
        elif field == "optional":
            conflicts["parking"] = ("present", "absent")
            normalized.pop("description", None)
        elif field == "out_of_range":
            normalized["deposit_rial"] = -5
        else:
            normalized.pop(field, None)
        results[0] = replace(results[0], normalized=normalized, conflicts=conflicts)
        return tuple(results)

    monkeypatch.setattr(ExtractionContract, "apply_profile", controlled_batch)
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    expected_attention = 0 if field in ("commercial", "optional") else 1
    assert run["extracted"] == 10
    assert run["needs_attention"] == expected_attention
    approved = api_client.post(
        f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/",
        {"reviewed_revision": run["revision"], "confirmed": True},
        format="json",
    )
    assert approved.status_code == 200, approved.data
    assert approved.json()["published"] == 10 - expected_attention


@pytest.mark.django_db
def test_exception_request_changes_correction_and_rejection_are_audited(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from django.core.exceptions import ValidationError

    from apps.source_proposals.models import ExternalListingCandidateEvent

    url = "https://khaneh.example/listing/10000"
    assigned_case[4].pages[url] = (
        assigned_case[4].pages[url].replace('class="area">85', 'class="area">95')
    )
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    candidate = run["candidates"][0]
    base = f"/api/v1/operator/external-listing-candidates/{candidate['id']}"
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    requested = api_client.post(
        f"{base}/request-changes/",
        {"reviewed_revision": 1, "reason": "متراژ را بررسی کنید"},
        format="json",
    )
    assert requested.status_code == 200
    assert requested.json()["state"] == "changes_requested"
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    corrected = api_client.post(
        f"{base}/correct/",
        {"reviewed_revision": 1, "reason": "بررسی سند", "values": {"area_sqm": 95}},
        format="json",
    )
    assert corrected.status_code == 200
    assert corrected.json()["history"][-1]["corrections"]["area_sqm"] == 95
    rejected = api_client.post(
        f"{base}/reject/",
        {"reviewed_revision": 2, "reason": "اطلاعات منبع قابل تأیید نیست"},
        format="json",
    )
    assert rejected.status_code == 200
    case = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    assert case["assignment"]["recent_requests"][0]["run"]["rejected"] == 1
    event = ExternalListingCandidateEvent.objects.get(pk=rejected.json()["history"][-1]["id"])
    with pytest.raises(ValidationError):
        event.delete()
    with pytest.raises(ValidationError):
        ExternalListingCandidateEvent.objects.filter(pk=event.pk).update(reason="rewrite")


@pytest.mark.django_db(transaction=True)
def test_concurrent_batch_decisions_publish_once(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    from apps.catalog.models import Listing

    if connection.vendor != "postgresql":
        pytest.skip("Batch serialization requires PostgreSQL")
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    barrier = Barrier(2)

    def decide():
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(assigned_case[2])
            barrier.wait(timeout=10)
            return client.post(
                f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/",
                {"reviewed_revision": run["revision"], "confirmed": True},
                format="json",
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(decide) for _ in range(2)]
        assert sorted(future.result(timeout=20) for future in futures) == [200, 409]
    assert Listing.objects.count() == 10


@pytest.mark.django_db
def test_valid_results_cannot_bypass_batch_review_through_individual_endpoints(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.catalog.models import Listing
    from tests.test_source_proposal_review import make_operator

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    base = f"/api/v1/operator/external-listing-candidates/{run['candidates'][0]['id']}"
    for operator in (assigned_case[2], make_operator(email="unassigned@example.com")):
        api_client.force_authenticate(operator)
        assert api_client.post(f"{base}/claim/", {}).status_code == 400
        assert (
            api_client.post(
                f"{base}/approve/", {"reviewed_revision": 1, "confirmed": True}, format="json"
            ).status_code
            == 400
        )
    assert Listing.objects.count() == 0


@pytest.mark.django_db
def test_previous_workers_can_insert_runs_candidates_and_events_after_migration(
    api_client, assigned_case
):
    from django.db import connection
    from django.db.migrations.loader import MigrationLoader
    from django.utils import timezone

    from apps.catalog.models import Neighborhood
    from apps.source_proposals.models import ExternalListingCandidateEvent, ExtractionRun

    proposal, assignment, operator, _, _ = assigned_case
    request = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {"assignment": assignment["id"], "url": proposal.website_url},
        format="json",
    ).json()
    old_apps = (
        MigrationLoader(connection)
        .project_state([("source_proposals", "0012_merge_20260905_0823")])
        .apps
    )
    old_run = old_apps.get_model("source_proposals", "ExtractionRun").objects.create(
        request_id=request["id"],
        profile_version_id=request["profile_version"],
        pipeline_version="old-worker",
        started_at=timezone.now(),
    )
    assert ExtractionRun.objects.get(pk=old_run.pk).revision == 1
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    old_candidate = old_apps.get_model(
        "source_proposals", "ExternalListingCandidate"
    ).objects.create(
        source_proposal_id=proposal.pk,
        source_id=assignment["source"]["id"],
        title="Legacy worker result",
        external_url="https://khaneh.example/legacy",
        city_id=neighborhood.district.city_id,
        district_id=neighborhood.district_id,
        neighborhood_id=neighborhood.pk,
        property_type="apartment",
        area_sqm=85,
        room_count=2,
        deposit_rial=5_000_000_000,
        monthly_rent_rial=200_000_000,
    )
    old_event = old_apps.get_model(
        "source_proposals", "ExternalListingCandidateEvent"
    ).objects.create(
        candidate_id=old_candidate.pk,
        actor_id=operator.pk,
        revision=1,
        prior_state="pending",
        new_state="rejected",
        reason="Legacy review",
    )
    assert ExternalListingCandidateEvent.objects.get(pk=old_event.pk).corrections == {}
