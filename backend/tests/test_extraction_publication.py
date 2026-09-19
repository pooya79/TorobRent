import pytest


def execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks):
    proposal, assignment, operator, representative, fetcher = assigned_case
    monkeypatch.setattr(
        "apps.source_proposals.source_processing.extraction.SourcePageFetcher", lambda **kw: fetcher
    )
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
def test_exceptions_do_not_block_batch_and_can_be_rejected_without_profile_changes(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
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
    result = api_client.post(
        f"{base}/reject/",
        {"reviewed_revision": bad["revision"], "reason": "اطلاعات منبع نادرست است"},
        format="json",
    )
    assert result.status_code == 200, result.data
    assert result.json()["state"] == "rejected"
    assert result.json()["evidence"] == bad["evidence"]
    assert SourceProfileVersion.objects.count() == profile_count
    api_client.force_authenticate(assigned_case[3])
    messages = api_client.get("/api/v1/messages/").json()
    assert "نتایج معتبر استخراج منتشر شد" in str(messages)


@pytest.mark.django_db
def test_later_run_refreshes_identity_and_discards_old_evidence(
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
    assert first["publication_outcomes"] == {
        "new": 0,
        "updated": 0,
        "unchanged": 0,
        "unclassified": 0,
    }
    assert original["publication_outcomes"] == {
        "new": 10,
        "updated": 0,
        "unchanged": 0,
        "unclassified": 0,
    }
    url = "https://khaneh.example/listing/10000"
    assigned_case[4].pages[url] = assigned_case[4].pages[url].replace("۲۰ میلیون", "۲۵ میلیون")
    second = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    refreshed = approve(second)
    assert refreshed.status_code == 200
    assert refreshed.json()["publication_outcomes"] == {
        "new": 0,
        "updated": 1,
        "unchanged": 9,
        "unclassified": 0,
    }
    from apps.source_proposals.extraction_serializers import (
        ExtractionRunSerializer,
    )

    assert (
        ExtractionRunSerializer(ExtractionRun.objects.get(pk=first["id"])).data[
            "publication_outcomes"
        ]
        == original["publication_outcomes"]
    )
    assert (
        refreshed.json()["candidates"][0]["listing_id"] == original["candidates"][0]["listing_id"]
    )
    assert Listing.objects.filter(source_id=assigned_case[1]["source"]["id"]).count() == 10
    assert Property.objects.count() == RentalTerms.objects.count() == 10
    assert Listing.objects.get(external_url=url).terms.monthly_rent_rial == 250_000_000
    proposal = api_client.get(
        "/api/v1/operator/source-proposals/",
        {"proposal": str(assigned_case[0].pk)},
    ).json()[0]
    assert len(proposal["properties"]) == 10
    assert {item["extraction_run"] for item in proposal["properties"]} == {second["id"]}
    assert ExtractionRun.objects.get(pk=first["id"]).results == []
    assert all(c.evidence == {} for c in ExtractionRun.objects.get(pk=first["id"]).candidates.all())


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
def test_candidate_rejection_remains_audited(
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
    rejected = api_client.post(
        f"{base}/reject/",
        {"reviewed_revision": 1, "reason": "اطلاعات منبع قابل تأیید نیست"},
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
def test_valid_results_support_individual_review_by_responsible_operator(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.catalog.models import Listing
    from tests.test_source_proposal_review import make_operator

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    candidate = run["candidates"][0]
    base = f"/api/v1/operator/external-listing-candidates/{candidate['id']}"
    api_client.force_authenticate(make_operator(email="unassigned@example.com"))
    assert api_client.post(f"{base}/claim/", {}).status_code in (400, 409)
    assert Listing.objects.count() == 0
    api_client.force_authenticate(assigned_case[2])
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    response = api_client.post(
        f"{base}/approve/",
        {"reviewed_revision": candidate["revision"], "confirmed": True},
        format="json",
    )
    assert response.status_code == 200, response.json()
    assert response.json()["state"] == "published"
    assert Listing.objects.count() == 1


@pytest.mark.django_db
def test_source_properties_remain_inspectable_outside_recent_run_history(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_proposals.models import ExternalListingCandidate
    from apps.source_proposals.serializers import SourceAssignmentSerializer

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    proposal = assigned_case[0]
    superseded_id = run["candidates"][0]["id"]
    retained_id = run["candidates"][1]["id"]
    ExternalListingCandidate.objects.filter(pk=superseded_id).update(superseded=True)
    monkeypatch.setattr(SourceAssignmentSerializer, "get_recent_requests", lambda self, obj: [])
    endpoint = "/api/v1/operator/source-proposals/"
    result = api_client.get(endpoint, {"proposal": str(proposal.pk)}).json()[0]
    assert result["assignment"]["recent_requests"] == []
    assert len(result["properties"]) == 9
    assert superseded_id not in {item["id"] for item in result["properties"]}
    assert all(item["is_current"] for item in result["properties"])
    assert api_client.get(endpoint).json()[0]["properties"] == []
    resolved = api_client.get(endpoint, {"candidate": retained_id}).json()
    assert len(resolved) == 1
    assert resolved[0]["id"] == str(proposal.pk)
    proposal.refresh_from_db()
    proposal.source.processing_paused = True
    proposal.source.save(update_fields=["processing_paused"])
    paused = api_client.get(endpoint, {"proposal": str(proposal.pk)}).json()[0]
    assert len(paused["properties"]) == 9
    assert not any(item["is_current"] for item in paused["properties"])


@pytest.mark.django_db
@pytest.mark.parametrize("reason", [None, "", "   ", "اطلاعات نادرست است"])
def test_optional_rejection_reason_preserves_requester_notification(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks, reason
):
    from apps.communications.models import SystemNotification

    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    candidate = run["candidates"][0]
    payload = {"reviewed_revision": candidate["revision"]}
    if reason is not None:
        payload["reason"] = reason
    response = api_client.post(
        f"/api/v1/operator/external-listing-candidates/{candidate['id']}/reject/",
        payload,
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.json()["state"] == "rejected"
    notice = SystemNotification.objects.get(
        originating_candidate_event__candidate_id=candidate["id"]
    )
    assert notice.recipient == assigned_case[3]
    assert notice.target_source_proposal == assigned_case[0]
    assert notice.originating_candidate_event.reason == (reason or "").strip()
    api_client.force_authenticate(assigned_case[3])
    messages = api_client.get("/api/v1/messages/").json()["results"]
    message = next(item for item in messages if item["id"] == str(notice.pk))
    assert message["title"] == "نتیجه استخراج رد شد"
    assert message["preview"] == ((reason or "").strip() or "نتیجه بررسی آگهی استخراج‌شده ثبت شد.")


@pytest.mark.django_db
def test_publication_uses_retained_coordinate_evidence_after_run_payload_cleanup(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from decimal import Decimal

    from apps.catalog.models import Listing
    from apps.source_proposals.models import ExtractionRun

    fetcher = assigned_case[4]
    for url, html in list(fetcher.pages.items()):
        if "/listing/" in url:
            fetcher.pages[url] = html.replace(
                "</head>",
                '<meta property="place:location:latitude" content="35.750123">'
                '<meta property="place:location:longitude" content="51.380456"></head>',
            )
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert ExtractionRun.objects.get(pk=run["id"]).results == []
    assert any(
        item["disposition"] == "selected" for item in run["candidates"][0]["evidence"]["latitude"]
    )
    response = api_client.post(
        f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/runs/{run['id']}/approve/",
        {"reviewed_revision": run["revision"], "confirmed": True},
        format="json",
    )
    assert response.status_code == 200, response.data
    property_ = Listing.objects.get(pk=response.json()["candidates"][0]["listing_id"]).property
    assert property_.latitude == Decimal("35.750123")
    assert property_.longitude == Decimal("51.380456")
    assert property_.approximate_latitude is not None
    assert property_.approximate_longitude is not None
    assert property_.location_precision == "approximate"
    assert (property_.approximate_latitude, property_.approximate_longitude) != (
        property_.latitude,
        property_.longitude,
    )

    api_client.force_authenticate(None)
    search = api_client.get(
        "/api/v1/catalog/properties/",
        {
            "viewport_north": "35.80",
            "viewport_east": "51.46",
            "viewport_south": "35.70",
            "viewport_west": "51.30",
            "viewport_zoom": "14",
        },
    )
    assert search.status_code == 200
    assert str(property_.pk) in {marker["id"] for marker in search.data["map"]["markers"]}
    detail = api_client.get(f"/api/v1/catalog/properties/{property_.pk}/")
    assert detail.status_code == 200
    assert "35.750123" not in str(detail.data)
    assert "51.380456" not in str(detail.data)


@pytest.mark.parametrize(
    ("latitude", "longitude", "disposition", "conflicts"),
    [
        ("91", "51", "selected", {}),
        ("35", "-181", "selected", {}),
        ("NaN", "51", "selected", {}),
        ("Infinity", "51", "selected", {}),
        ("invalid", "51", "selected", {}),
        (True, "51", "selected", {}),
        ("35", None, "selected", {}),
        ("35", "51", "alternative_evidence", {}),
        ("35", "51", "selected", {"latitude": [35, 36]}),
    ],
)
def test_publication_does_not_use_invalid_or_unselected_coordinate_pairs(
    latitude, longitude, disposition, conflicts
):
    from apps.source_proposals.models import ExternalListingCandidate
    from apps.source_proposals.source_processing.candidate_publication import candidate_coordinates

    candidate = ExternalListingCandidate(
        evidence={
            "latitude": [{"normalized_value": latitude, "disposition": disposition}],
            "longitude": [{"normalized_value": longitude, "disposition": disposition}],
        },
        conflicts=conflicts,
    )
    assert candidate_coordinates(candidate) == {}
