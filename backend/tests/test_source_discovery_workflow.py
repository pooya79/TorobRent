import pytest
from rest_framework.test import APIClient

from tests.test_source_proposal_review import make_operator, make_pending_proposal, make_user


@pytest.mark.django_db
def test_url_approval_keeps_case_and_claim_open_without_publishing(api_client: APIClient):
    representative = make_user(email="rep@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    api_client.force_authenticate(make_operator())
    base = f"/api/v1/operator/source-proposals/{proposal.id}"
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    response = api_client.post(
        f"{base}/approve/", {"reviewed_revision": 1, "confirmed": True}, format="json"
    )
    assert response.status_code == 200
    assert response.data["state"] == "pending"
    assert response.data["discovery_stage"] == "queued"
    assert proposal.review_claims.filter(released_at__isnull=True).count() == 1
    assert proposal.external_listing_candidates.count() == 0
    assert api_client.get("/api/v1/operator/source-proposals/").data[0]["id"] == str(proposal.id)


@pytest.mark.django_db
def test_discovery_delivery_is_idempotent_and_evidence_is_visible(
    api_client, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_extraction.fetching import FetchBatch, FetchedPage, FetchRecord
    from apps.source_proposals.tasks import discover_source

    fetched = []

    class FixtureFetcher:
        def fetch(self, urls, *, render=False):
            fetched.extend(urls)
            return FetchBatch(
                tuple(
                    FetchRecord(
                        requested_url=url,
                        page=FetchedPage(
                            url=url,
                            status_code=200,
                            headers={"content-type": "text/html"},
                            body=b"<html><h1>About our company</h1></html>",
                        ),
                    )
                    for url in urls
                )
            )

    monkeypatch.setattr(
        "apps.source_proposals.discovery_workflow.SourcePageFetcher", lambda **kw: FixtureFetcher()
    )
    representative = make_user(email="rep@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    api_client.force_authenticate(make_operator())
    base = f"/api/v1/operator/source-proposals/{proposal.id}"
    api_client.post(f"{base}/claim/", {})
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(
            f"{base}/approve/", {"reviewed_revision": 1, "confirmed": True}, format="json"
        )
        assert response.status_code == 200
        assert fetched == []
    reservation = proposal.reservations.get()
    discover_source(str(reservation.pk))
    assert fetched == [proposal.website_url]
    case = api_client.get("/api/v1/operator/source-proposals/").data[0]
    assert case["discovery_stage"] == "complete"
    assert case["discovery"]["evidence"]["page_count"] == 1
    assert case["discovery"]["evidence"]["classifications"] == {"irrelevant": 1}
    api_client.force_authenticate(representative)
    assert (
        api_client.get(f"/api/v1/source-proposals/{proposal.id}/").data["discovery_stage"]
        == "complete"
    )


@pytest.mark.django_db
def test_exact_host_reservation_blocks_competitors_until_abandoned(api_client):
    first = make_pending_proposal(submitter=make_user(email="first@example.com", submitter=True))
    second = make_pending_proposal(submitter=make_user(email="second@example.com", submitter=True))
    api_client.force_authenticate(make_operator())
    for proposal in (first, second):
        api_client.post(f"/api/v1/operator/source-proposals/{proposal.pk}/claim/", {})

    def approve(proposal):
        return api_client.post(
            f"/api/v1/operator/source-proposals/{proposal.pk}/approve/",
            {"reviewed_revision": 1, "confirmed": True},
            format="json",
        )

    assert approve(first).status_code == 200
    assert approve(second).status_code == 409
    assert (
        api_client.post(
            f"/api/v1/operator/source-proposals/{first.pk}/claim/release/",
            {"reviewed_revision": 1, "reason": "اپراتور در دسترس نیست"},
            format="json",
        ).status_code
        == 200
    )
    assert approve(second).status_code == 200
    assert first.reservations.get().release_reason == "abandoned"
    assert first.events.count() == 2


@pytest.mark.django_db
def test_no_fetch_validation_preserves_exact_host(api_client, monkeypatch):
    import socket

    from tests.test_source_proposals import authenticate_submitter

    def forbidden(*args, **kwargs):
        pytest.fail("Submission must not resolve or fetch any URL")

    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    authenticate_submitter(api_client)
    proposal = api_client.post("/api/v1/source-proposals/", {}, format="json").data
    url = f"/api/v1/source-proposals/{proposal['id']}/"
    details = {
        "website_name": "وب‌سایت",
        "website_url": "https://WWW.Khaneh.example./rentals#top",
        "sitemap_url": "https://www.khaneh.example/sitemap.xml",
        "relationship": "website_owner",
        "inventory_range": "unknown",
        "authority_declared": True,
    }
    response = api_client.patch(url, details, format="json")
    assert response.status_code == 200
    assert response.data["website_url"] == "https://www.khaneh.example/rentals"
    details["sitemap_url"] = "https://khaneh.example/sitemap.xml"
    assert api_client.patch(url, details, format="json").status_code == 400
    assert api_client.post(f"{url}preview/", {}, format="json").status_code == 200
    submitted = api_client.post(f"{url}submit/", {"preview_confirmed": True}, format="json")
    assert submitted.status_code == 200
    assert submitted.data["discovery_stage"] == "awaiting_url"


@pytest.mark.django_db
@pytest.mark.parametrize("decision", ["reject", "request-changes"])
def test_decisions_cancel_discovery_and_keep_notifications(api_client, decision):
    from apps.communications.models import SystemNotification
    from apps.source_proposals.tasks import discover_source

    proposal = make_pending_proposal(submitter=make_user(email="rep@example.com", submitter=True))
    api_client.force_authenticate(make_operator())
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    api_client.post(f"{base}/claim/", {})
    api_client.post(f"{base}/approve/", {"reviewed_revision": 1, "confirmed": True}, format="json")
    response = api_client.post(
        f"{base}/{decision}/", {"reviewed_revision": 1, "reason": "نیازمند اصلاح"}, format="json"
    )
    assert response.status_code == 200
    reservation = proposal.reservations.get()
    discover_source(str(reservation.pk))
    reservation.refresh_from_db()
    assert reservation.released_at is not None
    assert reservation.started_at is None
    assert SystemNotification.objects.count() == 1
    assert proposal.events.count() == 2


@pytest.mark.django_db
def test_claim_renews_and_queue_manager_can_force_release(api_client):
    from datetime import timedelta

    from django.contrib.auth.models import Permission
    from django.utils import timezone

    proposal = make_pending_proposal(submitter=make_user(email="rep@example.com", submitter=True))
    operator = make_operator()
    api_client.force_authenticate(operator)
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    api_client.post(f"{base}/claim/", {})
    api_client.post(f"{base}/approve/", {"reviewed_revision": 1, "confirmed": True}, format="json")
    old_expiry = timezone.now() + timedelta(seconds=30)
    proposal.review_claims.update(expires_at=old_expiry)
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    assert proposal.review_claims.get().expires_at > old_expiry
    manager = make_user(email="manager@example.com")
    manager.user_permissions.add(Permission.objects.get(codename="manage_operator_queue"))
    api_client.force_authenticate(manager)
    assert api_client.get("/api/v1/operator/source-proposals/").status_code == 200
    assert api_client.post(f"{base}/claim/", {}).status_code == 403
    released = api_client.post(
        f"{base}/claim/release/",
        {"reviewed_revision": 1, "reason": "اپراتور غایب است"},
        format="json",
    )
    assert released.status_code == 200
    assert proposal.review_claims.get().released_at is not None
    assert proposal.reservations.get().release_reason == "abandoned"


@pytest.mark.django_db
def test_expiry_keeps_history_and_allows_new_approval(api_client):
    from datetime import timedelta

    from django.utils import timezone

    from apps.source_proposals.tasks import discover_source, expire_source_reservations

    proposal = make_pending_proposal(submitter=make_user(email="rep@example.com", submitter=True))
    api_client.force_authenticate(make_operator())
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    api_client.post(f"{base}/claim/", {})
    payload = {"reviewed_revision": 1, "confirmed": True}
    api_client.post(f"{base}/approve/", payload, format="json")
    old = proposal.reservations.get()
    proposal.reservations.update(expires_at=timezone.now() - timedelta(seconds=1))
    expire_source_reservations()
    discover_source(str(old.pk))
    old.refresh_from_db()
    assert old.started_at is None
    assert old.release_reason == "expired"
    assert api_client.post(f"{base}/approve/", payload, format="json").status_code == 200
    assert proposal.reservations.count() == 2
    assert proposal.events.count() == 3


@pytest.mark.django_db
def test_active_assignment_prevents_url_approval(api_client):
    from apps.catalog.models import Source
    from apps.source_proposals.models import SourceAssignment

    representative = make_user(email="rep@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    source = Source.objects.create(name="assigned", domain=proposal.normalized_domain)
    SourceAssignment.objects.create(source=source, representative=representative, proposal=proposal)
    api_client.force_authenticate(make_operator())
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    api_client.post(f"{base}/claim/", {})
    assert (
        api_client.post(
            f"{base}/approve/", {"reviewed_revision": 1, "confirmed": True}, format="json"
        ).status_code
        == 409
    )
    assert proposal.reservations.count() == 0


@pytest.mark.django_db(transaction=True)
def test_concurrent_host_approvals_reserve_only_once(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from apps.source_proposals.models import SourceReservation

    if connection.vendor != "postgresql":
        pytest.skip("Row locking contract requires PostgreSQL")
    monkeypatch.setattr("apps.source_proposals.tasks.discover_source.delay", lambda *args: None)
    proposals = [
        make_pending_proposal(submitter=make_user(email=f"rep{i}@example.com", submitter=True))
        for i in range(2)
    ]
    operators = [make_operator(email=f"op{i}@example.com") for i in range(2)]
    barrier = Barrier(2)

    def approve(index):
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(operators[index])
            base = f"/api/v1/operator/source-proposals/{proposals[index].pk}"
            assert client.post(f"{base}/claim/", {}).status_code == 201
            barrier.wait(timeout=10)
            return client.post(
                f"{base}/approve/", {"reviewed_revision": 1, "confirmed": True}, format="json"
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(approve, range(2))) == [200, 409]
    assert SourceReservation.objects.filter(released_at__isnull=True).count() == 1


@pytest.mark.django_db
def test_running_discovery_stops_after_abandonment_and_cannot_overwrite_case(
    api_client, monkeypatch
):
    from apps.source_extraction.fetching import FetchBatch, FetchedPage, FetchRecord
    from apps.source_proposals.tasks import discover_source

    proposal = make_pending_proposal(submitter=make_user(email="rep@example.com", submitter=True))
    api_client.force_authenticate(make_operator())
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    api_client.post(f"{base}/claim/", {})
    api_client.post(f"{base}/approve/", {"reviewed_revision": 1, "confirmed": True}, format="json")
    fetched = []

    class InterruptedFetcher:
        def fetch(self, urls, *, render=False):
            fetched.extend(urls)
            assert (
                api_client.post(
                    f"{base}/claim/release/",
                    {"reviewed_revision": 1, "reason": "توقف بررسی"},
                    format="json",
                ).status_code
                == 200
            )
            return FetchBatch((
                FetchRecord(
                    requested_url=urls[0],
                    page=FetchedPage(
                        url=urls[0],
                        status_code=200,
                        body=(
                            '<html><a href="/rent/apartment-1">اجاره آپارتمان تهران</a></html>'
                        ).encode(),
                    ),
                ),
            ))

    monkeypatch.setattr(
        "apps.source_proposals.discovery_workflow.SourcePageFetcher",
        lambda **kw: InterruptedFetcher(),
    )
    discover_source(str(proposal.reservations.get().pk))
    assert fetched == [proposal.website_url]
    assert (
        api_client.get("/api/v1/operator/source-proposals/").data[0]["discovery_stage"]
        == "released"
    )


@pytest.mark.django_db
def test_resubmitted_revision_waits_for_its_own_url_approval(api_client):
    from tests.test_source_proposals import complete_details, submit_proposal

    representative = make_user(email="rep@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    api_client.force_authenticate(make_operator())
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    api_client.post(f"{base}/claim/", {})
    api_client.post(f"{base}/approve/", {"reviewed_revision": 1, "confirmed": True}, format="json")
    api_client.post(
        f"{base}/request-changes/",
        {"reviewed_revision": 1, "reason": "نشانی را اصلاح کنید"},
        format="json",
    )
    api_client.force_authenticate(representative)
    assert complete_details(api_client, proposal.pk, proposal.website_url).status_code == 200
    submit_proposal(api_client, proposal.pk)
    case = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").data
    assert case["revision"] == 2
    assert case["discovery_stage"] == "awaiting_url"


@pytest.mark.django_db
def test_http_error_discovery_is_failed_and_releases_host(api_client, monkeypatch):
    from apps.source_extraction.fetching import FetchBatch, FetchedPage, FetchRecord
    from apps.source_proposals.tasks import discover_source

    class ErrorFetcher:
        def fetch(self, urls, *, render=False):
            return FetchBatch((
                FetchRecord(
                    requested_url=urls[0],
                    page=FetchedPage(
                        url=urls[0],
                        status_code=500,
                        body=b"<html>Service unavailable</html>",
                        headers={"content-type": "text/html"},
                    ),
                ),
            ))

    monkeypatch.setattr(
        "apps.source_proposals.discovery_workflow.SourcePageFetcher", lambda **kw: ErrorFetcher()
    )
    proposal = make_pending_proposal(submitter=make_user(email="rep@example.com", submitter=True))
    api_client.force_authenticate(make_operator())
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    api_client.post(f"{base}/claim/", {})
    api_client.post(f"{base}/approve/", {"reviewed_revision": 1, "confirmed": True}, format="json")
    discover_source(str(proposal.reservations.get().pk))
    case = api_client.get("/api/v1/operator/source-proposals/").data[0]
    assert case["discovery_stage"] == "failed"
    assert case["discovery"]["release_reason"] == "failed"
    assert case["discovery"]["evidence"]["failures"][0]["code"] == "unsupported_response"


@pytest.mark.django_db
@pytest.mark.parametrize("recover_by", ["delivery", "maintenance"])
def test_interrupted_worker_recovers_as_failed_without_duplicate_fetch(api_client, recover_by):
    from datetime import timedelta

    from django.utils import timezone

    from apps.source_proposals.tasks import discover_source, expire_source_reservations

    proposal = make_pending_proposal(submitter=make_user(email="rep@example.com", submitter=True))
    api_client.force_authenticate(make_operator())
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    api_client.post(f"{base}/claim/", {})
    api_client.post(f"{base}/approve/", {"reviewed_revision": 1, "confirmed": True}, format="json")
    proposal.reservations.update(started_at=timezone.now() - timedelta(minutes=13))
    if recover_by == "delivery":
        discover_source(str(proposal.reservations.get().pk))
    else:
        expire_source_reservations()
    case = api_client.get("/api/v1/operator/source-proposals/").data[0]
    assert case["discovery_stage"] == "failed"
    assert case["discovery"]["release_reason"] == "failed"
    assert case["discovery"]["evidence"]["failures"][0]["code"] == "worker_interrupted"
    assert case["discovery"]["completed_at"] is not None
