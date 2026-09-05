import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.source_proposals.models import (
    SourceProposal,
    SourceProposalEvent,
    SourceProposalState,
)


def authenticate_submitter(api_client: APIClient, *, email: str = "source@example.com") -> User:
    submitter = User.objects.create_user(
        email=email,
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
        phone="09123456789" if email == "source@example.com" else "09123456780",
        phone_verified_at=timezone.now(),
        is_submitter=True,
    )
    api_client.force_authenticate(submitter)
    return submitter


@pytest.mark.django_db
def test_verified_submitter_creates_then_resumes_one_source_proposal_draft(
    api_client: APIClient,
):
    authenticate_submitter(api_client)

    created = api_client.post("/api/v1/source-proposals/", {}, format="json")
    resumed = api_client.post("/api/v1/source-proposals/", {}, format="json")

    assert created.status_code == 201
    assert resumed.status_code == 200
    assert resumed.data == created.data
    assert created.data["state"] == "draft"
    assert created.data["current_step"] == "details"
    assert created.data["available_actions"] == ["edit", "delete"]


@pytest.mark.django_db
def test_submitter_can_delete_only_a_source_proposal_draft(
    api_client: APIClient,
):
    authenticate_submitter(api_client)
    removable = api_client.post("/api/v1/source-proposals/", {}, format="json")
    proposal = SourceProposal.objects.get(id=removable.data["id"])
    SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=proposal.submitter,
        revision=1,
        prior_state=SourceProposalState.CHANGES_REQUESTED,
        new_state=SourceProposalState.DRAFT,
        reason="نسخه جدید برای ویرایش ایجاد شد.",
    )

    listed = api_client.get("/api/v1/source-proposals/")

    removed = api_client.delete(f"/api/v1/source-proposals/{removable.data['id']}/")

    assert "delete" in listed.data[0]["available_actions"]
    assert removed.status_code == 204
    assert api_client.get(f"/api/v1/source-proposals/{removable.data['id']}/").status_code == 404

    protected = api_client.post("/api/v1/source-proposals/", {}, format="json")
    SourceProposal.objects.filter(id=protected.data["id"]).update(state=SourceProposalState.PENDING)

    rejected = api_client.delete(f"/api/v1/source-proposals/{protected.data['id']}/")

    assert rejected.status_code == 403
    assert api_client.get(f"/api/v1/source-proposals/{protected.data['id']}/").status_code == 200


@pytest.mark.django_db
def test_source_representative_saves_details_and_resumes_them(api_client: APIClient):
    authenticate_submitter(api_client)
    created = api_client.post("/api/v1/source-proposals/", {}, format="json")

    saved = api_client.patch(
        f"/api/v1/source-proposals/{created.data['id']}/",
        {
            "website_name": "خانه‌یاب",
            "website_url": "https://WWW.Khaneh.example/rentals?city=tehran",
            "relationship": "website_manager",
            "inventory_range": "51_200",
            "sitemap_url": "https://www.khaneh.example/sitemap.xml",
            "operator_note": "دسته اجاره از فروش جداست.",
            "authority_declared": True,
        },
        format="json",
    )
    resumed = api_client.get(f"/api/v1/source-proposals/{created.data['id']}/")

    assert saved.status_code == 200
    assert resumed.data == saved.data
    assert saved.data["current_step"] == "preview"
    assert saved.data["website_name"] == "خانه‌یاب"
    assert saved.data["inventory_range"] == "51_200"
    assert (
        SourceProposal.objects.get(id=created.data["id"]).normalized_domain == "www.khaneh.example"
    )


@pytest.mark.django_db
def test_partial_draft_fields_autosave_before_preview(api_client: APIClient):
    authenticate_submitter(api_client)
    created = api_client.post("/api/v1/source-proposals/", {}, format="json")

    saved = api_client.patch(
        f"/api/v1/source-proposals/{created.data['id']}/draft/",
        {"website_name": "خانه‌یاب"},
        format="json",
    )
    resumed = api_client.post("/api/v1/source-proposals/", {}, format="json")

    assert saved.status_code == 200
    assert saved.data["current_step"] == "details"
    assert resumed.data["website_name"] == "خانه‌یاب"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "unsafe_url",
    [
        "file:///etc/passwd",
        "http://localhost/catalog",
        "http://127.0.0.1/catalog",
        "https://person:secret@example.com/catalog",
    ],
)
def test_unsafe_website_url_is_rejected_without_losing_saved_details(
    api_client: APIClient, unsafe_url: str
):
    authenticate_submitter(api_client)
    created = api_client.post("/api/v1/source-proposals/", {}, format="json")
    url = f"/api/v1/source-proposals/{created.data['id']}/"
    valid_details = {
        "website_name": "خانه‌یاب",
        "website_url": "https://khaneh.example/rentals",
        "relationship": "website_owner",
        "inventory_range": "unknown",
        "sitemap_url": "",
        "operator_note": "یادداشت حفظ شود.",
        "authority_declared": True,
    }
    assert api_client.patch(url, valid_details, format="json").status_code == 200

    rejected = api_client.patch(url, {**valid_details, "website_url": unsafe_url}, format="json")
    resumed = api_client.get(url)

    assert rejected.status_code == 400
    assert resumed.data["website_url"] == valid_details["website_url"]
    assert resumed.data["operator_note"] == "یادداشت حفظ شود."


@pytest.mark.django_db
def test_no_fetch_summary_is_deterministic_explicit_and_survives_reload(api_client: APIClient):
    authenticate_submitter(api_client)
    created = api_client.post("/api/v1/source-proposals/", {}, format="json")
    proposal_url = f"/api/v1/source-proposals/{created.data['id']}/"
    details = {
        "website_name": "خانه‌یاب",
        "website_url": "https://khaneh.example/rentals",
        "relationship": "authorized_representative",
        "inventory_range": "11_50",
        "sitemap_url": "",
        "operator_note": "",
        "authority_declared": True,
    }
    assert api_client.patch(proposal_url, details, format="json").status_code == 200

    first = api_client.post(f"{proposal_url}preview/", {}, format="json")
    second = api_client.post(f"{proposal_url}preview/", {}, format="json")
    resumed = api_client.post("/api/v1/source-proposals/", {}, format="json")

    assert first.status_code == 200
    assert second.data["preview"] == first.data["preview"]
    assert resumed.data["preview"] == first.data["preview"]
    assert "simulated" not in first.data["preview"]
    assert "هیچ درخواستی" in first.data["preview"]["disclaimer"]
    assert "estimated_count" not in first.data["preview"]
    assert "examples" not in first.data["preview"]


@pytest.mark.django_db
def test_preview_confirmation_is_required_before_pending_review(api_client: APIClient):
    authenticate_submitter(api_client)
    created = api_client.post("/api/v1/source-proposals/", {}, format="json")
    proposal_url = f"/api/v1/source-proposals/{created.data['id']}/"
    details = {
        "website_name": "خانه‌یاب",
        "website_url": "https://khaneh.example/rentals",
        "relationship": "website_owner",
        "inventory_range": "1_10",
        "sitemap_url": "",
        "operator_note": "",
        "authority_declared": True,
    }
    api_client.patch(proposal_url, details, format="json")

    before_preview = api_client.post(
        f"{proposal_url}submit/", {"preview_confirmed": True}, format="json"
    )
    api_client.post(f"{proposal_url}preview/", {}, format="json")
    unconfirmed = api_client.post(
        f"{proposal_url}submit/", {"preview_confirmed": False}, format="json"
    )
    submitted = api_client.post(
        f"{proposal_url}submit/", {"preview_confirmed": True}, format="json"
    )
    resumed = api_client.post("/api/v1/source-proposals/", {}, format="json")

    assert before_preview.status_code == 400
    assert unconfirmed.status_code == 400
    assert submitted.status_code == 200
    assert submitted.data["state"] == "pending"
    assert submitted.data["preview_confirmed"] is True
    assert submitted.data["pending_since"] is not None
    assert submitted.data["available_actions"] == []
    assert resumed.data["id"] == created.data["id"]
    assert resumed.data["state"] == "pending"


def complete_details(api_client: APIClient, proposal_id: str, website_url: str):
    return api_client.patch(
        f"/api/v1/source-proposals/{proposal_id}/",
        {
            "website_name": "خانه‌یاب",
            "website_url": website_url,
            "relationship": "website_owner",
            "inventory_range": "1_10",
            "sitemap_url": "",
            "operator_note": "",
            "authority_declared": True,
        },
        format="json",
    )


def submit_proposal(api_client: APIClient, proposal_id: str) -> None:
    proposal_url = f"/api/v1/source-proposals/{proposal_id}/"
    api_client.post(f"{proposal_url}preview/", {}, format="json")
    response = api_client.post(f"{proposal_url}submit/", {"preview_confirmed": True}, format="json")
    assert response.status_code == 200


@pytest.mark.django_db
def test_account_cannot_hold_two_open_proposals_for_one_normalized_domain(
    api_client: APIClient,
):
    authenticate_submitter(api_client)
    first = api_client.post("/api/v1/source-proposals/", {}, format="json")
    first_details = complete_details(api_client, first.data["id"], "https://www.example.com/a")
    assert first_details.status_code == 200
    submit_proposal(api_client, first.data["id"])
    second = api_client.post("/api/v1/source-proposals/", {"start_new": True}, format="json")

    duplicate = complete_details(api_client, second.data["id"], "http://WWW.EXAMPLE.com/b")

    assert duplicate.status_code == 400
    assert SourceProposal.objects.get(id=second.data["id"]).normalized_domain == ""


@pytest.mark.django_db
def test_migrated_database_enforces_one_open_proposal_per_account_domain(
    api_client: APIClient,
):
    submitter = authenticate_submitter(api_client)
    SourceProposal.objects.create(
        submitter=submitter,
        state="pending",
        normalized_domain="example.com",
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        SourceProposal.objects.create(
            submitter=submitter,
            normalized_domain="example.com",
        )


@pytest.mark.django_db
def test_cross_account_duplicate_is_accepted_and_privately_flagged(api_client: APIClient):
    first_submitter = authenticate_submitter(api_client)
    first = api_client.post("/api/v1/source-proposals/", {}, format="json")
    complete_details(api_client, first.data["id"], "https://www.example.com/a")
    submit_proposal(api_client, first.data["id"])

    second_submitter = User.objects.create_user(
        email="other-source@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
        phone="09123456780",
        phone_verified_at=timezone.now(),
        is_submitter=True,
    )
    api_client.force_authenticate(second_submitter)
    second = api_client.post("/api/v1/source-proposals/", {}, format="json")
    accepted = complete_details(api_client, second.data["id"], "http://www.example.com/b")

    assert accepted.status_code == 200
    assert "needs_reconciliation" not in accepted.data
    assert str(first_submitter.id) not in str(accepted.data)
    assert SourceProposal.objects.get(id=second.data["id"]).needs_reconciliation is True
