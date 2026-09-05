import pytest

from tests.test_source_extraction_contract import FixtureFetcher, listing_html
from tests.test_source_proposal_review import make_operator, make_pending_proposal, make_user


@pytest.fixture
def discovered_case(api_client, monkeypatch, django_capture_on_commit_callbacks):
    representative = make_user(email="profile-rep@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    urls = [f"https://khaneh.example/listing/{number}" for number in range(10000, 10010)]
    fetcher = FixtureFetcher({
        proposal.website_url: "<h1>رهن و اجاره خانه</h1>"
        + "".join(f'<a href="{url}">اجاره آپارتمان تهران</a>' for url in urls),
        **{url: listing_html(area=85 + i) for i, url in enumerate(urls)},
    })
    monkeypatch.setattr(
        "apps.source_proposals.discovery_workflow.SourcePageFetcher", lambda **kw: fetcher
    )
    operator = make_operator()
    api_client.force_authenticate(operator)
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    with django_capture_on_commit_callbacks(execute=True):
        assert (
            api_client.post(
                f"{base}/approve/", {"reviewed_revision": 1, "confirmed": True}, format="json"
            ).status_code
            == 200
        )
    return proposal, base, operator, representative, fetcher


@pytest.mark.django_db
def test_discovery_proposes_one_immutable_profile_with_review_evidence(api_client, discovered_case):
    from apps.source_proposals.tasks import discover_source

    proposal, _, _, _, fetcher = discovered_case
    case = api_client.get("/api/v1/operator/source-proposals/").data[0]
    assert case["discovery_stage"] == "complete"
    profile = case["profile_versions"][0]
    assert profile["number"] == 1
    assert profile["provenance"] == "discovery"
    assert profile["status"] == "proposed"
    assert profile["rules"]
    assert profile["structural_fingerprint"]
    assert profile["validation"]["approval_enabled"] is True
    assert len(profile["validation"]["training_page_urls"]) == 5
    assert len(profile["validation"]["held_out_page_urls"]) == 5
    assert profile["samples"][0]["normalized"]["city"] == "تهران"
    assert profile["samples"][0]["evidence"]["floor_area_sqm"]
    assert profile["exclusions"] == []
    assert "09121234567" not in str(profile)
    assert "html" not in profile
    calls = len(fetcher.calls)
    discover_source(str(proposal.reservations.get().pk))
    repeated = api_client.get("/api/v1/operator/source-proposals/").data[0]
    assert repeated["profile_versions"] == case["profile_versions"]
    assert len(fetcher.calls) == calls


@pytest.mark.django_db
def test_manual_edit_versions_and_revalidates_without_fetching(api_client, discovered_case):
    _, base, _, _, fetcher = discovered_case
    initial = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    rules = {
        **initial["rules"],
        "floor_area_sqm": {"kind": "css", "selector": ".deposit", "transform": "integer"},
    }
    calls = len(fetcher.calls)
    response = api_client.post(
        f"{base}/profile/edit/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": initial["id"],
            "rules": rules,
        },
        format="json",
    )
    assert response.status_code == 200
    edited, retained = response.data["profile_versions"]
    assert retained == initial
    assert edited["number"] == 2
    assert str(edited["parent"]) == initial["id"]
    assert edited["provenance"] == "manual"
    assert edited["validation"]["held_out_page_urls"] == initial["validation"]["held_out_page_urls"]
    assert edited["validation"]["fields"]["floor_area_sqm"]["conflicts"] == 5
    assert edited["validation"]["approval_enabled"] is False
    assert len(fetcher.calls) == calls
    assert (
        api_client.post(
            f"{base}/profile/edit/",
            {
                "reviewed_revision": 1,
                "reviewed_profile_version": initial["id"],
                "rules": initial["rules"],
            },
            format="json",
        ).status_code
        == 409
    )


@pytest.mark.django_db
@pytest.mark.parametrize("mode", ["approval_required", "automatic"])
def test_approval_activates_valid_version_and_assigns_source(api_client, discovered_case, mode):
    from apps.communications.models import SystemNotification
    from apps.source_proposals.models import SourceAssignment

    proposal, base, _, representative, _ = discovered_case
    initial = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    response = api_client.post(
        f"{base}/profile/approve/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": initial["id"],
            "review_mode": mode,
            "confirmed": True,
        },
        format="json",
    )
    assert response.status_code == 200
    assert response.data["state"] == "approved"
    assert response.data["profile_versions"][0]["is_active"] is True
    assert response.data["profile_versions"][0]["status"] == "approved"
    assert response.data["profile_versions"][0]["review_mode"] == mode
    assert SourceAssignment.objects.get(proposal=proposal).representative == representative
    assert proposal.reservations.get().release_reason == "approved"
    assert proposal.review_claims.get().released_at is not None
    assert SystemNotification.objects.filter(recipient=representative).count() == 1
    assert (
        api_client.post(
            f"{base}/profile/approve/",
            {
                "reviewed_revision": 1,
                "reviewed_profile_version": initial["id"],
                "review_mode": mode,
                "confirmed": True,
            },
            format="json",
        ).status_code
        == 409
    )
    api_client.force_authenticate(representative)
    assert api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").data["state"] == "approved"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "decision,state", [("reject", "rejected"), ("request-changes", "changes_requested")]
)
def test_profile_decisions_require_reason_and_preserve_history(
    api_client, discovered_case, decision, state
):
    from apps.communications.models import SystemNotification

    proposal, base, _, representative, _ = discovered_case
    initial = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    payload = {"reviewed_revision": 1, "reviewed_profile_version": initial["id"], "reason": ""}
    assert api_client.post(f"{base}/{decision}/", payload, format="json").status_code == 400
    payload["reason"] = "ساختار صفحات نیازمند اصلاح است."
    response = api_client.post(f"{base}/{decision}/", payload, format="json")
    assert response.status_code == 200
    retained = response.data["profile_versions"][0]
    assert retained["rules"] == initial["rules"]
    assert retained["validation"] == initial["validation"]
    assert retained["status"] == state
    assert retained["is_active"] is False
    assert response.data["history"][-1]["reason"] == payload["reason"]
    assert proposal.reservations.get().release_reason == state
    assert proposal.review_claims.get().released_at is not None
    assert SystemNotification.objects.filter(recipient=representative).count() == 1


@pytest.mark.django_db
def test_invalid_version_cannot_be_approved_but_manual_correction_can(api_client, discovered_case):
    _, base, _, _, _ = discovered_case
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    invalid_rules = {
        **original["rules"],
        "floor_area_sqm": {"kind": "css", "selector": ".deposit", "transform": "integer"},
    }
    edited = api_client.post(
        f"{base}/profile/edit/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": original["id"],
            "rules": invalid_rules,
        },
        format="json",
    ).data["profile_versions"][0]
    payload = {
        "reviewed_revision": 1,
        "reviewed_profile_version": edited["id"],
        "confirmed": True,
        "review_mode": "automatic",
    }
    assert api_client.post(f"{base}/profile/approve/", payload, format="json").status_code == 400
    payload["reviewed_profile_version"] = original["id"]
    assert api_client.post(f"{base}/profile/approve/", payload, format="json").status_code == 409
    corrected = api_client.post(
        f"{base}/profile/edit/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": edited["id"],
            "rules": original["rules"],
        },
        format="json",
    ).data["profile_versions"][0]
    payload["reviewed_profile_version"] = corrected["id"]
    approved = api_client.post(f"{base}/profile/approve/", payload, format="json")
    assert approved.status_code == 200
    assert [version["is_active"] for version in approved.data["profile_versions"]] == [
        True,
        False,
        False,
    ]
    assert (
        api_client.post(
            f"{base}/profile/edit/",
            {
                "reviewed_revision": 1,
                "reviewed_profile_version": corrected["id"],
                "rules": invalid_rules,
            },
            format="json",
        ).status_code
        == 409
    )


@pytest.mark.django_db
@pytest.mark.parametrize(
    "identity,status",
    [
        ("representative", 403),
        ("other_operator", 409),
        ("self_operator", 400),
        ("expired_claim", 409),
    ],
)
def test_profile_actions_require_independent_current_claim(
    api_client, discovered_case, identity, status
):
    from datetime import timedelta

    from django.contrib.auth.models import Permission
    from django.utils import timezone

    proposal, base, operator, representative, _ = discovered_case
    version = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    if identity == "self_operator":
        representative.user_permissions.add(
            Permission.objects.get(codename="review_source_proposal")
        )
    if identity in ("representative", "self_operator"):
        api_client.force_authenticate(representative)
    elif identity == "other_operator":
        api_client.force_authenticate(make_operator(email="another@example.com"))
    else:
        proposal.review_claims.update(expires_at=timezone.now() - timedelta(seconds=1))
        api_client.force_authenticate(operator)
    payload = {"reviewed_revision": 1, "reviewed_profile_version": version["id"]}
    assert (
        api_client.post(
            f"{base}/profile/edit/", {**payload, "rules": version["rules"]}, format="json"
        ).status_code
        == status
    )
    assert (
        api_client.post(
            f"{base}/profile/approve/",
            {**payload, "confirmed": True, "review_mode": "automatic"},
            format="json",
        ).status_code
        == status
    )


@pytest.mark.django_db
def test_expired_snapshots_are_removed_without_erasing_versions(api_client, discovered_case):
    from datetime import timedelta

    from django.utils import timezone

    from apps.source_proposals.models import SourceProfileSnapshots
    from apps.source_proposals.tasks import expire_source_reservations

    _, base, _, _, _ = discovered_case
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    SourceProfileSnapshots.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    expire_source_reservations()
    assert not SourceProfileSnapshots.objects.exists()
    response = api_client.post(
        f"{base}/profile/edit/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": original["id"],
            "rules": original["rules"],
        },
        format="json",
    )
    assert response.status_code == 409
    assert response.data["code"] == "profile_evidence_expired"
    assert (
        api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
        == original
    )


@pytest.mark.django_db
def test_profile_payload_and_decision_are_immutable_after_account_deletion(
    api_client, discovered_case
):
    from django.core.exceptions import ValidationError

    from apps.source_proposals.models import SourceProfileDecision, SourceProfileVersion

    proposal, base, operator, _, _ = discovered_case
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    edited = api_client.post(
        f"{base}/profile/edit/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": original["id"],
            "rules": original["rules"],
        },
        format="json",
    ).data["profile_versions"][0]
    assert (
        api_client.post(
            f"{base}/reject/",
            {
                "reviewed_revision": 1,
                "reviewed_profile_version": edited["id"],
                "reason": "اختیار تأیید نشد",
            },
            format="json",
        ).status_code
        == 200
    )
    for record in (
        SourceProfileVersion.objects.get(pk=edited["id"]),
        SourceProfileDecision.objects.get(),
    ):
        with pytest.raises(ValidationError):
            record.save()
        with pytest.raises(ValidationError):
            record.delete()
        with pytest.raises(ValidationError):
            type(record).objects.filter(pk=record.pk).delete()
        with pytest.raises(ValidationError):
            type(record).objects.filter(pk=record.pk).update(pk=record.pk)
    proposal.review_claims.all().delete()
    operator.delete()
    assert SourceProfileVersion.objects.get(pk=edited["id"]).created_by is None
    assert SourceProfileDecision.objects.get().event.actor is None


@pytest.mark.django_db
def test_unsafe_edit_is_rejected_without_creating_a_version(api_client, discovered_case):
    _, base, _, _, _ = discovered_case
    before = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"]
    response = api_client.post(
        f"{base}/profile/edit/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": before[0]["id"],
            "rules": {"floor_area_sqm": {"kind": "script", "code": "document.body"}},
        },
        format="json",
    )
    assert response.status_code == 400
    assert (
        api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"] == before
    )


@pytest.mark.django_db(transaction=True)
def test_concurrent_profile_edit_and_approval_cannot_approve_stale_rules(
    api_client, discovered_case
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    if connection.vendor != "postgresql":
        pytest.skip("Profile decision concurrency requires PostgreSQL.")
    proposal, base, operator, _, _ = discovered_case
    version = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    barrier = Barrier(2)

    def decide(action):
        close_old_connections()
        client = APIClient()
        client.force_authenticate(operator)
        payload = {"reviewed_revision": 1, "reviewed_profile_version": version["id"]}
        if action == "edit":
            payload["rules"] = version["rules"]
        else:
            payload.update(confirmed=True, review_mode="automatic")
        try:
            barrier.wait(timeout=10)
            return client.post(f"{base}/profile/{action}/", payload, format="json").status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(decide, ["edit", "approve"]))
    assert sorted(statuses) == [200, 409]
    proposal.refresh_from_db()
    assert proposal.state == ("pending" if statuses[0] == 200 else "approved")
