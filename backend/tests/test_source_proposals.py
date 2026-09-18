import pytest
from django.db import IntegrityError, transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.source_proposals.models import SourceProposal, SourceProposalEvent


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


def website_details(**overrides):
    return {
        "website_name": "خانه‌یاب",
        "website_url": "https://khaneh.example/rentals",
        "relationship": "website_manager",
        "inventory_range": "51_200",
        "sitemap_url": "https://khaneh.example/sitemap.xml",
        "operator_note": "دسته اجاره از فروش جداست.",
        "authority_declared": True,
        **overrides,
    }


@pytest.mark.django_db
def test_complete_introduction_is_immediately_pending_and_readable(api_client):
    authenticate_submitter(api_client)
    created = api_client.post("/api/v1/source-proposals/", website_details(), format="json")
    assert created.status_code == 201
    assert created.data["state"] == "pending"
    assert created.data["available_actions"] == []
    assert created.data["pending_since"] is not None
    assert created.data["preview_confirmed"] is True
    assert "هیچ درخواستی" in created.data["preview"]["disclaimer"]
    assert api_client.get(f"/api/v1/source-proposals/{created.data['id']}/").data == created.data
    assert SourceProposal.objects.count() == 1
    assert list(SourceProposalEvent.objects.values_list("new_state", flat=True)) == ["pending"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "body",
    [
        {},
        {"start_new": True},
        {"website_name": "ناتمام"},
        website_details(authority_declared=False),
    ],
)
def test_incomplete_or_unconfirmed_introduction_creates_nothing(api_client, body):
    authenticate_submitter(api_client)
    response = api_client.post("/api/v1/source-proposals/", body, format="json")
    assert response.status_code == 400
    assert not SourceProposal.objects.exists()
    assert not SourceProposalEvent.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize("verified,submitter", [(False, True), (True, False)])
def test_introduction_requires_verified_submitter(api_client, verified, submitter):
    user = authenticate_submitter(api_client)
    user.is_submitter = submitter
    if not verified:
        user.phone_verified_at = None
    user.save()
    response = api_client.post("/api/v1/source-proposals/", website_details(), format="json")
    assert response.status_code == 403
    assert not SourceProposal.objects.exists()


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
def test_invalid_url_cannot_leave_a_draft(api_client, unsafe_url):
    authenticate_submitter(api_client)
    rejected = api_client.post(
        "/api/v1/source-proposals/", website_details(website_url=unsafe_url), format="json"
    )
    assert rejected.status_code == 400
    assert not SourceProposal.objects.exists()


@pytest.mark.django_db
@override_settings(DEBUG=True, SOURCE_FETCH_PRIVATE_HOSTS=["jsonld.demo.example.com"])
def test_browser_only_demo_url_returns_the_container_facing_url(api_client):
    authenticate_submitter(api_client)
    rejected = api_client.post(
        "/api/v1/source-proposals/",
        website_details(website_url="http://jsonld.localhost:8088/rentals/", sitemap_url=""),
        format="json",
    )
    assert rejected.status_code == 400
    assert "فقط برای پیش‌نمایش مرورگر" in rejected.data["detail"]
    assert "http://jsonld.demo.example.com/rentals/" in rejected.data["detail"]
    assert not SourceProposal.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize("state", ["draft", "pending", "changes_requested"])
def test_existing_current_website_blocks_another_introduction(api_client, state):
    user = authenticate_submitter(api_client)
    SourceProposal.objects.create(submitter=user, state=state)
    response = api_client.post("/api/v1/source-proposals/", website_details(), format="json")
    assert response.status_code == 409
    assert SourceProposal.objects.count() == 1


@pytest.mark.django_db
@pytest.mark.parametrize("state", ["draft", "changes_requested"])
def test_existing_editable_case_is_submitted_atomically(api_client, state):
    user = authenticate_submitter(api_client)
    proposal = SourceProposal.objects.create(submitter=user, state=state, **website_details())
    endpoint = f"/api/v1/source-proposals/{proposal.pk}/submit/"
    rejected = api_client.post(
        endpoint, website_details(website_url="http://localhost/"), format="json"
    )
    assert rejected.status_code == 400
    proposal.refresh_from_db()
    assert proposal.state == state
    assert proposal.revision == 1
    assert proposal.website_url == website_details()["website_url"]
    assert proposal.events.count() == 0
    submitted = api_client.post(
        endpoint, website_details(website_name="نام اصلاح‌شده"), format="json"
    )
    assert submitted.status_code == 200
    assert submitted.data["state"] == "pending"
    assert submitted.data["revision"] == (2 if state == "changes_requested" else 1)
    assert submitted.data["history"][-1]["prior_state"] == state
    assert submitted.data["history"][-1]["new_state"] == "pending"
    assert api_client.post(endpoint, website_details(), format="json").status_code == 403
    assert SourceProposal.objects.count() == 1


@pytest.mark.django_db
def test_legacy_draft_endpoints_cannot_save_or_create_drafts(api_client):
    user = authenticate_submitter(api_client)
    proposal = SourceProposal.objects.create(submitter=user)
    url = f"/api/v1/source-proposals/{proposal.pk}/"
    assert api_client.patch(url, website_details(), format="json").status_code == 405
    assert (
        api_client.patch(f"{url}draft/", {"website_name": "changed"}, format="json").status_code
        == 404
    )
    assert api_client.post(f"{url}preview/", {}, format="json").status_code == 404
    assert (
        api_client.post(f"{url}submit/", {"preview_confirmed": True}, format="json").status_code
        == 400
    )
    proposal.refresh_from_db()
    assert proposal.website_name == ""


@pytest.mark.django_db
def test_other_submitter_cannot_submit_or_discard_existing_case(api_client):
    owner = authenticate_submitter(api_client)
    proposal = SourceProposal.objects.create(submitter=owner)
    authenticate_submitter(api_client, email="other@example.com")
    url = f"/api/v1/source-proposals/{proposal.pk}/"
    assert api_client.post(f"{url}submit/", website_details(), format="json").status_code == 404
    assert api_client.delete(url).status_code == 404


@pytest.mark.django_db
def test_legacy_conflict_can_be_resolved_without_erasing_history(api_client):
    user = authenticate_submitter(api_client)
    first = SourceProposal.objects.create(submitter=user)
    second = SourceProposal.objects.create(submitter=user, state="changes_requested")
    assert all(
        item["current_website_conflict"]
        for item in api_client.get("/api/v1/source-proposals/").data
    )
    assert (
        api_client.post(
            f"/api/v1/source-proposals/{second.pk}/submit/", website_details(), format="json"
        ).status_code
        == 400
    )
    assert api_client.delete(f"/api/v1/source-proposals/{first.pk}/").status_code == 204
    assert api_client.get(f"/api/v1/source-proposals/{first.pk}/").data["discarded_at"]
    submitted = api_client.post(
        f"/api/v1/source-proposals/{second.pk}/submit/", website_details(), format="json"
    )
    assert submitted.status_code == 200
    assert not submitted.data["current_website_conflict"]
    assert api_client.delete(f"/api/v1/source-proposals/{second.pk}/").status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize("state", ["rejected", "revoked", "approved"])
def test_closed_cases_without_assignment_release_the_slot(api_client, state):
    user = authenticate_submitter(api_client)
    old = SourceProposal.objects.create(submitter=user, state=state)
    created = api_client.post("/api/v1/source-proposals/", website_details(), format="json")
    assert created.status_code == 201
    assert created.data["id"] != str(old.pk)
    assert not api_client.get(f"/api/v1/source-proposals/{old.pk}/").data["is_current"]


@pytest.mark.django_db
def test_cross_account_duplicate_is_accepted_and_privately_flagged(api_client):
    first = authenticate_submitter(api_client)
    assert (
        api_client.post("/api/v1/source-proposals/", website_details(), format="json").status_code
        == 201
    )
    authenticate_submitter(api_client, email="other-source@example.com")
    second = api_client.post("/api/v1/source-proposals/", website_details(), format="json")
    assert second.status_code == 201
    assert "needs_reconciliation" not in second.data
    assert str(first.pk) not in str(second.data)
    assert SourceProposal.objects.get(pk=second.data["id"]).needs_reconciliation


@pytest.mark.django_db
def test_database_enforces_one_open_proposal_per_account_domain(api_client):
    user = authenticate_submitter(api_client)
    SourceProposal.objects.create(submitter=user, state="pending", normalized_domain="example.com")
    with pytest.raises(IntegrityError), transaction.atomic():
        SourceProposal.objects.create(submitter=user, normalized_domain="example.com")


@pytest.mark.django_db(transaction=True)
def test_simultaneous_introductions_create_only_one_pending_website(api_client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    if connection.vendor != "postgresql":
        pytest.skip("Requires PostgreSQL row locks")
    user = authenticate_submitter(api_client)
    barrier = Barrier(2)

    def introduce():
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(User.objects.get(pk=user.pk))
            barrier.wait(timeout=10)
            return client.post(
                "/api/v1/source-proposals/", website_details(), format="json"
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: introduce(), range(2)))
    assert sorted(results) == [201, 409]
    assert SourceProposal.objects.count() == 1
    assert SourceProposal.objects.get().state == "pending"
