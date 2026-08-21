import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_user_manager_normalizes_email_and_hashes_password():
    user = get_user_model().objects.create_user("PERSON@EXAMPLE.COM", "secret-password")
    assert user.email == "person@example.com"
    assert user.check_password("secret-password")
    assert user.username is None


@pytest.mark.django_db
def test_session_issues_csrf_token(api_client: APIClient):
    response = api_client.get("/api/v1/auth/session/")
    assert response.status_code == 200
    assert response.data["authenticated"] is False
    assert response.data["csrf_token"]
    assert "csrftoken" in response.cookies
    assert response["Cache-Control"] == "max-age=0, no-cache, no-store, must-revalidate, private"


@pytest.mark.django_db
def test_current_user_requires_authentication(api_client: APIClient):
    response = api_client.get("/api/v1/users/me/")
    assert response.status_code == 401
    assert response.data["code"] == "not_authenticated"
    assert response.data["request_id"] == response["X-Request-ID"]


@pytest.mark.django_db
def test_current_user_returns_authenticated_user(api_client: APIClient, user):
    api_client.force_authenticate(user=user)
    response = api_client.get("/api/v1/users/me/")
    assert response.status_code == 200
    assert response.data["email"] == "person@example.com"


@pytest.mark.django_db
def test_session_reports_authenticated_session(api_client: APIClient, user):
    api_client.force_login(user)
    response = api_client.get("/api/v1/auth/session/")
    assert response.status_code == 200
    assert response.data["authenticated"] is True
