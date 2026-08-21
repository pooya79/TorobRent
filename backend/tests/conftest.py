import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User


@pytest.fixture
def api_client() -> APIClient:
    return APIClient(enforce_csrf_checks=True)


@pytest.fixture
def user(db) -> User:
    return User.objects.create_user(email="person@example.com", password="correct-horse-battery")
