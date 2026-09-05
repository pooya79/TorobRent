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
