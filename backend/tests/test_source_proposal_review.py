import pytest
from django.contrib.auth.models import Permission
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import Listing, Source
from apps.source_proposals.models import ExternalListingCandidate, SourceProposal


def make_user(*, email: str, submitter: bool = False) -> User:
    return User.objects.create_user(
        email=email,
        password="password",
        email_verified_at=timezone.now(),
        phone=f"09{User.objects.count() + 1:09d}",
        phone_verified_at=timezone.now(),
        is_submitter=submitter,
    )


def make_operator(*, email: str = "source-reviewer@example.com") -> User:
    operator = make_user(email=email)
    operator.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="source_proposals",
            codename="review_source_proposal",
        )
    )
    return operator


def make_pending_proposal(*, submitter: User, domain: str = "khaneh.example") -> SourceProposal:
    return SourceProposal.objects.create(
        submitter=submitter,
        state="pending",
        current_step="preview",
        website_name="خانه‌یاب",
        website_url=f"https://{domain}/rentals",
        normalized_domain=domain,
        relationship="website_manager",
        inventory_range="51_200",
        sitemap_url=f"https://{domain}/sitemap.xml",
        operator_note="دسته اجاره از فروش جداست.",
        authority_declared=True,
        preview={
            "simulated": True,
            "title": "پیش‌نمایش شبیه‌سازی‌شده",
            "disclaimer": "هیچ درخواست زنده‌ای ارسال نشده است.",
            "estimated_count": None,
            "inventory_range": "51_200",
            "examples": [],
        },
        preview_confirmed=True,
        needs_reconciliation=True,
        pending_since=timezone.now(),
    )


@pytest.mark.django_db
def test_source_proposal_queue_requires_its_capability_and_excludes_own_work(
    api_client: APIClient,
):
    representative = make_user(email="representative@example.com", submitter=True)
    pending = make_pending_proposal(submitter=representative)
    unpermitted = make_user(email="ordinary@example.com")
    api_client.force_authenticate(unpermitted)

    denied = api_client.get("/api/v1/operator/source-proposals/")

    operator = make_operator()
    own = make_pending_proposal(submitter=operator, domain="own.example")
    api_client.force_authenticate(operator)
    queue = api_client.get("/api/v1/operator/source-proposals/")

    assert denied.status_code == 403
    assert queue.status_code == 200
    assert [item["id"] for item in queue.data] == [str(pending.id)]
    assert str(own.id) not in str(queue.data)
    assert queue.data[0]["needs_reconciliation"] is False
    assert queue.data[0]["website_url"] == "https://khaneh.example/rentals"
    assert queue.data[0]["operator_note"] == "دسته اجاره از فروش جداست."
    assert "submitter" not in queue.data[0]


@pytest.mark.django_db
def test_source_proposal_queue_recomputes_private_duplicate_signal(api_client: APIClient):
    first_representative = make_user(email="first-representative@example.com", submitter=True)
    first = make_pending_proposal(submitter=first_representative)
    first.needs_reconciliation = False
    first.save(update_fields=("needs_reconciliation",))
    second_representative = make_user(email="second-representative@example.com", submitter=True)
    SourceProposal.objects.create(
        submitter=second_representative,
        state="draft",
        website_url="https://khaneh.example/other",
        normalized_domain="khaneh.example",
    )
    operator = make_operator()
    api_client.force_authenticate(operator)

    queue = api_client.get("/api/v1/operator/source-proposals/")

    assert queue.status_code == 200
    assert queue.data[0]["id"] == str(first.id)
    assert queue.data[0]["needs_reconciliation"] is True


@pytest.mark.django_db
def test_operator_claims_and_requests_changes_then_representative_resumes(
    api_client: APIClient,
):
    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    operator = make_operator()
    api_client.force_authenticate(operator)

    claimed = api_client.post(
        f"/api/v1/operator/source-proposals/{proposal.id}/claim/", {}, format="json"
    )
    missing_reason = api_client.post(
        f"/api/v1/operator/source-proposals/{proposal.id}/request-changes/",
        {"reason": "", "reviewed_revision": 1},
        format="json",
    )
    requested = api_client.post(
        f"/api/v1/operator/source-proposals/{proposal.id}/request-changes/",
        {"reason": "مدرک اختیار مدیریت وب‌سایت را توضیح دهید.", "reviewed_revision": 1},
        format="json",
    )

    assert claimed.status_code == 201
    assert claimed.data["operator_label"] == operator.email
    assert missing_reason.status_code == 400
    assert requested.status_code == 200
    assert requested.data["state"] == "changes_requested"

    api_client.force_authenticate(representative)
    dashboard = api_client.get("/api/v1/source-proposals/")
    resumed = api_client.patch(
        f"/api/v1/source-proposals/{proposal.id}/draft/",
        {"operator_note": "اختیار مدیریت طبق قرارداد نمایندگی است."},
        format="json",
    )

    assert dashboard.data[0]["revision"] == 1
    assert dashboard.data[0]["available_actions"] == ["edit"]
    assert dashboard.data[0]["history"][-1]["reason"] == (
        "مدرک اختیار مدیریت وب‌سایت را توضیح دهید."
    )
    assert resumed.status_code == 200
    assert resumed.data["state"] == "draft"
    assert resumed.data["revision"] == 2
    assert [event["new_state"] for event in resumed.data["history"]] == [
        "changes_requested",
        "draft",
    ]


@pytest.mark.django_db
def test_claim_and_revision_conflicts_prevent_concurrent_or_self_decisions(
    api_client: APIClient,
):
    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    first = make_operator(email="first-reviewer@example.com")
    second = make_operator(email="second-reviewer@example.com")
    claim_url = f"/api/v1/operator/source-proposals/{proposal.id}/claim/"
    reject_url = f"/api/v1/operator/source-proposals/{proposal.id}/reject/"

    api_client.force_authenticate(first)
    assert api_client.post(claim_url, {}, format="json").status_code == 201
    api_client.force_authenticate(second)
    competing_claim = api_client.post(claim_url, {}, format="json")
    api_client.force_authenticate(first)
    missing_reason = api_client.post(
        reject_url, {"reviewed_revision": 1, "reason": ""}, format="json"
    )
    rejected = api_client.post(
        reject_url,
        {"reviewed_revision": 1, "reason": "اختیار نمایندگی اثبات نشد."},
        format="json",
    )
    api_client.force_authenticate(second)
    stale = api_client.post(
        reject_url,
        {"reviewed_revision": 1, "reason": "تصمیم هم‌زمان"},
        format="json",
    )
    representative.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="source_proposals",
            codename="review_source_proposal",
        )
    )
    api_client.force_authenticate(representative)
    own_decision = api_client.post(claim_url, {}, format="json")

    assert competing_claim.status_code == 409
    assert competing_claim.data["code"] == "review_claim_conflict"
    assert missing_reason.status_code == 400
    assert rejected.status_code == 200
    assert rejected.data["state"] == "rejected"
    assert stale.status_code == 409
    assert stale.data["code"] == "review_decision_conflict"
    assert own_decision.status_code == 400


@pytest.mark.django_db
def test_approval_validates_source_without_publishing_a_listing(api_client: APIClient):
    call_command("loaddata", "catalog_seed", verbosity=0)
    representative = make_user(email="representative@example.com", submitter=True)
    domain = ".".join(["long-domain-segment"] * 7) + ".example"
    proposal = make_pending_proposal(submitter=representative, domain=domain)
    proposal.website_name = "و" * 200
    proposal.save(update_fields=("website_name",))
    operator = make_operator()
    api_client.force_authenticate(operator)
    api_client.post(f"/api/v1/operator/source-proposals/{proposal.id}/claim/", {}, format="json")
    approve_url = f"/api/v1/operator/source-proposals/{proposal.id}/approve/"

    unconfirmed = api_client.post(
        approve_url,
        {"reviewed_revision": 1, "confirmed": False},
        format="json",
    )
    approved = api_client.post(
        approve_url,
        {"reviewed_revision": 1, "confirmed": True},
        format="json",
    )

    assert unconfirmed.status_code == 400
    assert approved.status_code == 200
    assert approved.data["state"] == "approved"
    source = Source.objects.get(domain=domain)
    assert source.name == f"external-{proposal.id}"
    assert source.display_name == "و" * 120
    assert Listing.objects.count() == 0
    assert ExternalListingCandidate.objects.filter(source_proposal=proposal).count() == 2
    proposal.refresh_from_db()
    assert proposal.source is not None

    api_client.force_authenticate(representative)
    dashboard = api_client.get("/api/v1/source-proposals/")
    assert dashboard.data[0]["state"] == "approved"
    assert dashboard.data[0]["available_actions"] == []
    assert dashboard.data[0]["history"][-1]["new_state"] == "approved"
