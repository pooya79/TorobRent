from pathlib import Path
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient


def test_liveness_is_public_and_has_request_id(api_client: APIClient):
    response = api_client.get("/api/v1/system/live/")
    assert response.status_code == 200
    assert response.data == {"status": "ok"}
    assert response["X-Request-ID"]


@pytest.mark.django_db
def test_readiness_succeeds(api_client: APIClient):
    response = api_client.get("/api/v1/system/ready/")
    assert response.status_code == 200


@pytest.mark.django_db
def test_readiness_hides_dependency_details(api_client: APIClient):
    with patch(
        "apps.system.views.connection.ensure_connection", side_effect=RuntimeError("secret")
    ):
        response = api_client.get("/api/v1/system/ready/")
    assert response.status_code == 503
    assert response.data == {"status": "unavailable"}


def test_invalid_request_id_is_replaced(api_client: APIClient):
    response = api_client.get("/api/v1/system/live/", HTTP_X_REQUEST_ID="not-a-uuid")
    assert response["X-Request-ID"] != "not-a-uuid"


def test_compose_uses_named_volumes_for_restart_safe_database_and_media():
    repository_root = Path(__file__).resolve().parents[2]
    for filename in ("compose.yaml", "compose.prod.yaml"):
        compose = (repository_root / filename).read_text()
        assert "postgres-data:/var/lib/postgresql" in compose
        assert compose.count("media-data:/app/backend/media") >= 2
        assert "\n  postgres-data:" in compose
        assert "\n  media-data:" in compose
