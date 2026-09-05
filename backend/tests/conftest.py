import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User


@pytest.fixture
def api_client() -> APIClient:
    return APIClient(enforce_csrf_checks=True)


@pytest.fixture
def user(db) -> User:
    return User.objects.create_user(email="person@example.com", password="correct-horse-battery")


@pytest.fixture
def discovered_case(api_client, monkeypatch, django_capture_on_commit_callbacks):
    from tests.test_source_extraction_contract import FixtureFetcher, listing_html
    from tests.test_source_proposal_review import make_operator, make_pending_proposal, make_user

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


@pytest.fixture(autouse=True)
def forbid_implicit_llm_requests(monkeypatch):
    """Exercise Discovery/retries/drift/extraction/tasks with an enabled, forbidden LLM boundary.

    Explicit repair tests replace this transport with their controlled provider response.
    Teardown also detects a forbidden call swallowed by a background error handler.
    """
    import http.client

    from django.conf import settings

    monkeypatch.setattr(settings, "SOURCE_PROFILE_REPAIR_API_KEY", "test-only-no-real-key")
    monkeypatch.setattr(settings, "SOURCE_PROFILE_REPAIR_MODEL", "test-only-no-real-model")
    original = http.client.HTTPSConnection
    calls = []

    def guarded_connection(host, *args, **kwargs):
        if host == "api.openai.com":
            calls.append(host)
            raise AssertionError("LLM access requires an explicit repair test")
        return original(host, *args, **kwargs)

    monkeypatch.setattr(http.client, "HTTPSConnection", guarded_connection)
    yield
    assert calls == [], "An automatic workflow invoked the LLM"


@pytest.fixture
def assigned_case(api_client, discovered_case, monkeypatch, request):
    monkeypatch.setattr(
        "apps.source_extraction.fetching.resolve_addresses", lambda *args: ["93.184.216.34"]
    )
    from django.core.management import call_command

    call_command("loaddata", "catalog_seed", verbosity=0)
    proposal, base, operator, representative, fetcher = discovered_case
    version = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    response = api_client.post(
        f"{base}/profile/approve/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": version["id"],
            "confirmed": True,
            "review_mode": getattr(request, "param", "approval_required"),
        },
        format="json",
    )
    assert response.status_code == 200
    api_client.force_authenticate(representative)
    return proposal, response.data["assignment"], operator, representative, fetcher
