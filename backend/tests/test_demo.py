import json
import subprocess
from datetime import UTC, datetime
from io import StringIO
from pathlib import Path

import pytest
from django.core.management import call_command
from django.db.models import Count, Q
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import (
    FeatureState,
    Listing,
    ListingState,
    Property,
    PropertyType,
    RentalTerms,
)
from apps.common.demo import DemoFixtureKind, demo_id
from apps.submissions.models import Submission, SubmissionEvent, SubmissionState


def login(email: str, password: str) -> APIClient:
    client = APIClient()
    session = client.get("/api/v1/auth/session/")
    client.credentials(HTTP_X_CSRFTOKEN=session.data["csrf_token"])
    response = client.post(
        "/api/v1/auth/login/", {"email": email, "password": password}, format="json"
    )
    assert response.status_code == 200
    return client


@pytest.mark.django_db
def test_seed_demo_creates_catalog_and_prepared_personas():
    output = StringIO()

    call_command("seed_demo", stdout=output)

    assert Property.objects.count() == 60
    assert Listing.objects.count() == 80
    assert (
        Property.objects.filter(
            approximate_latitude__isnull=False,
            approximate_longitude__isnull=False,
            location_radius_meters__isnull=False,
        )
        .exclude(location_precision="")
        .count()
        == 60
    )
    assert User.objects.get(email="submitter@torobrent.local").check_password("demo-submitter")
    operator = User.objects.get(email="operator@torobrent.local")
    assert operator.check_password("demo-operator")
    assert operator.is_staff is True
    assert "60 Properties, 80 Listings" in output.getvalue()


@pytest.mark.django_db
def test_seed_demo_catalog_exercises_review_scenarios():
    call_command("seed_demo", verbosity=0)

    assert set(Property.objects.values_list("property_type", flat=True)) == set(PropertyType.values)
    commercial_types = {
        PropertyType.OFFICE,
        PropertyType.SHOP,
        PropertyType.WAREHOUSE,
        PropertyType.WORKSHOP,
    }
    assert (
        set(
            Property.objects.filter(property_type__in=commercial_types).values_list(
                "property_type", flat=True
            )
        )
        == commercial_types
    )
    assert (
        set(
            Property.objects.filter(
                property_type__in=commercial_types, room_count__isnull=True
            ).values_list("property_type", flat=True)
        )
        == commercial_types
    )
    for field in ("parking", "elevator", "storage", "balcony", "furnished"):
        assert set(Property.objects.values_list(field, flat=True)) == set(FeatureState.values)
    assert RentalTerms.objects.filter(deposit_rial=0, monthly_rent_rial__gt=0).exists()
    assert RentalTerms.objects.filter(deposit_rial__gt=0, monthly_rent_rial=0).exists()
    assert Property.objects.annotate(total=Count("listings")).filter(total__gt=1).count() == 20
    assert Listing.objects.exclude(source_claims={}).exists()
    assert Listing.objects.filter(
        source__allows_external_media=True, external_media_url__gt=""
    ).exists()
    assert Listing.objects.filter(external_media_url="").exists()
    assert set(Listing.objects.values_list("state", flat=True)) == set(ListingState.values)
    assert (
        Property.objects
        .annotate(
            active_count=Count(
                "listings",
                filter=Q(
                    listings__state=ListingState.PUBLISHED,
                    listings__available_until__gt=datetime(2099, 1, 1, tzinfo=UTC),
                ),
            )
        )
        .filter(active_count__gt=0)
        .count()
        > 50
    )


@pytest.mark.django_db
def test_seed_demo_upgrades_existing_fixture_taxonomy():
    call_command("seed_demo", verbosity=0)
    shop_fixture = Property.objects.get(id=demo_id(DemoFixtureKind.PROPERTY, 5))
    shop_fixture.property_type = PropertyType.APARTMENT
    shop_fixture.room_count = 2
    shop_fixture.save(update_fields=("property_type", "room_count"))

    call_command("seed_demo", verbosity=0)

    shop_fixture.refresh_from_db()
    assert shop_fixture.property_type == PropertyType.SHOP
    assert shop_fixture.room_count is None


@pytest.mark.django_db
def test_seed_demo_prepares_submitter_workflows_and_is_idempotent():
    call_command("seed_demo", verbosity=0)
    changed = Submission.objects.get(state=SubmissionState.CHANGES_REQUESTED)
    changed.state = SubmissionState.DRAFT
    changed.save(update_fields=("state",))
    published = Submission.objects.filter(state=SubmissionState.PUBLISHED).first()
    assert published is not None and published.listing is not None
    published.listing.description = "Reviewer work that must survive restart"
    published.listing.save(update_fields=("description",))
    submitter = User.objects.get(email="submitter@torobrent.local")
    submitter.set_password("reviewer-password")
    submitter.save(update_fields=("password",))

    call_command("seed_demo", verbosity=0)

    changed.refresh_from_db()
    published.listing.refresh_from_db()
    submitter.refresh_from_db()
    assert changed.state == SubmissionState.DRAFT
    assert published.listing.description == "Reviewer work that must survive restart"
    assert submitter.check_password("reviewer-password")

    submissions = Submission.objects.filter(submitter=submitter)
    assert submissions.filter(
        state=SubmissionState.PUBLISHED, listing__state=ListingState.EXPIRED
    ).exists()
    assert submissions.filter(state=SubmissionState.PENDING).exists()
    assert Property.objects.count() == 60
    assert Listing.objects.count() == 80


@pytest.mark.django_db
def test_seed_demo_includes_review_history_and_reasons():
    call_command("seed_demo", verbosity=0)

    changes = Submission.objects.get(state=SubmissionState.CHANGES_REQUESTED)
    rejection = Submission.objects.get(state=SubmissionState.REJECTED)
    assert SubmissionEvent.objects.filter(
        submission=changes,
        new_state=SubmissionState.CHANGES_REQUESTED,
        reason__gt="",
    ).exists()
    assert SubmissionEvent.objects.filter(
        submission=rejection,
        new_state=SubmissionState.REJECTED,
        reason__gt="",
    ).exists()


@pytest.mark.django_db
def test_seed_demo_personas_can_access_their_prepared_queues():
    call_command("seed_demo", verbosity=0)

    submitter = login("submitter@torobrent.local", "demo-submitter")
    assert submitter.get("/api/v1/submissions/").status_code == 200

    operator = login("operator@torobrent.local", "demo-operator")
    response = operator.get("/api/v1/operator/submissions/?state=pending")
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert len(response.data["results"]) == 1


def test_demo_compose_and_make_targets_define_a_scoped_persistent_lifecycle():
    repository_root = Path(__file__).resolve().parents[2]
    compose_file = repository_root / "compose.demo.yaml"
    environment_file = repository_root / ".env.demo.example"

    rendered = subprocess.run(
        [
            "docker",
            "compose",
            "-p",
            "torobrent-demo",
            "--env-file",
            str(environment_file),
            "-f",
            str(compose_file),
            "config",
            "--format",
            "json",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    config = json.loads(rendered.stdout)

    assert config["name"] == "torobrent-demo"
    assert config["services"]["seed"]["command"] == [
        ".venv/bin/python",
        "manage.py",
        "seed_demo",
    ]
    assert "mailpit" in config["services"]
    for service in (
        "postgres",
        "redis",
        "mailpit",
        "backend",
        "worker",
        "beat",
        "frontend",
        "nginx",
    ):
        assert config["services"][service]["healthcheck"]
    assert "--log-config" in config["services"]["backend"]["command"]
    assert config["volumes"]["postgres-data"]["name"].startswith("torobrent-demo_")
    assert config["volumes"]["media-data"]["name"].startswith("torobrent-demo_")

    makefile = (repository_root / "Makefile").read_text()
    assert "demo-down:" in makefile
    assert "demo-reset:" in makefile
    assert "down --volumes --remove-orphans" in makefile
    assert "docker volume prune" not in makefile
    assert "Application: http://localhost:" in makefile
    assert "Admin:       http://localhost:" in makefile
    assert "Mailpit:     http://localhost:" in makefile
    assert "Liveness:    http://localhost:" in makefile
    assert "Readiness:   http://localhost:" in makefile


def test_demo_guide_and_smoke_command_cover_the_reviewer_journey():
    repository_root = Path(__file__).resolve().parents[2]
    guide = (repository_root / "docs/demo.md").read_text()
    smoke = (repository_root / "scripts/demo-smoke.sh").read_text()
    makefile = (repository_root / "Makefile").read_text()

    for heading in (
        "## Prerequisites",
        "## Start",
        "## URLs and personas",
        "## Complete walkthrough",
        "## Troubleshooting",
        "## Stop and restart",
        "## Reset",
        "## Clean uninstall",
    ):
        assert heading in guide
    for platform in ("Linux", "macOS", "Docker Desktop", "WSL2"):
        assert platform in guide
    assert "not live crawler inventory" in guide
    assert "test-demo:" in makefile
    for behavior in (
        "seed_demo",
        "restart-marker",
        "down --volumes",
        "check_password",
        "demo_persona_smoke.py",
    ):
        assert behavior in smoke
