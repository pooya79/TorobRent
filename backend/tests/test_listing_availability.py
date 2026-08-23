from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from django.core.management import call_command
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import (
    Listing,
    ListingState,
    Neighborhood,
    Property,
    PropertyType,
    RentalTerms,
    Source,
)
from apps.catalog.tasks import expire_due_listings
from apps.submissions.models import Submission, SubmissionState


def make_published_submission(*, submitter: User, available_until: datetime) -> Submission:
    source = Source.objects.create(
        name="torobrent-direct",
        domain="direct.torobrent.test",
        display_name="TorobRent",
        is_builtin=True,
    )
    property_ = Property.objects.create(property_type="apartment", area_sqm=85, room_count=2)
    terms = RentalTerms.objects.create(
        deposit_rial=5_000_000_000,
        monthly_rent_rial=250_000_000,
    )
    confirmed_at = available_until - timedelta(days=30)
    listing = Listing.objects.create(
        property=property_,
        source=source,
        terms=terms,
        state=ListingState.PUBLISHED,
        direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
        published_at=confirmed_at,
        availability_confirmed_at=confirmed_at,
        available_until=available_until,
    )
    return Submission.objects.create(
        submitter=submitter,
        role="owner",
        state=SubmissionState.PUBLISHED,
        listing=listing,
        source=source,
    )


@pytest.mark.django_db
def test_submitter_dashboard_reports_listing_expiring_during_final_seven_days(
    api_client: APIClient,
):
    now = timezone.make_aware(datetime(2026, 8, 23, 10, 30))
    submitter = User.objects.create_user(email="submitter@example.com", password="password")
    submission = make_published_submission(
        submitter=submitter,
        available_until=now + timedelta(days=7),
    )
    api_client.force_authenticate(submitter)

    with patch("apps.submissions.serializers.timezone.now", return_value=now):
        response = api_client.get("/api/v1/submissions/")

    assert response.status_code == 200
    assert response.data[0]["id"] == str(submission.id)
    assert response.data[0]["availability"] == {
        "state": "published",
        "confirmed_at": (now - timedelta(days=23)).isoformat().replace("+00:00", "Z"),
        "available_until": (now + timedelta(days=7)).isoformat().replace("+00:00", "Z"),
        "expiring_soon": True,
    }
    assert response.data[0]["available_actions"] == [
        "edit",
        "confirm_availability",
        "mark_unavailable",
        "archive",
    ]


@pytest.mark.django_db
def test_submitter_confirms_unchanged_availability_in_one_action(api_client: APIClient):
    now = timezone.make_aware(datetime(2026, 8, 23, 10, 30))
    submitter = User.objects.create_user(email="submitter@example.com", password="password")
    submission = make_published_submission(
        submitter=submitter,
        available_until=now + timedelta(hours=1),
    )
    listing = submission.listing
    unchanged = {
        "property_id": listing.property_id,
        "terms_id": listing.terms_id,
        "description": listing.description,
        "source_claims": listing.source_claims,
        "direct_phone": listing.direct_phone,
    }
    api_client.force_authenticate(submitter)

    with patch("apps.catalog.services.timezone.now", return_value=now):
        response = api_client.post(
            f"/api/v1/submissions/{submission.id}/confirm-availability/",
            {"description": "changed", "direct_phone": "۰۹۹۹۹۹۹۹۹۹۹"},
            format="json",
        )

    assert response.status_code == 200
    listing.refresh_from_db()
    assert listing.state == ListingState.PUBLISHED
    assert listing.availability_confirmed_at == now
    assert listing.available_until == now + timedelta(days=30)
    assert {
        "property_id": listing.property_id,
        "terms_id": listing.terms_id,
        "description": listing.description,
        "source_claims": listing.source_claims,
        "direct_phone": listing.direct_phone,
    } == unchanged


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("action", "expected_state"),
    [
        ("mark-unavailable", ListingState.UNAVAILABLE),
        ("archive", ListingState.ARCHIVED),
    ],
)
def test_submitter_can_end_listing_availability_early(
    api_client: APIClient,
    action: str,
    expected_state: str,
):
    submitter = User.objects.create_user(email="submitter@example.com", password="password")
    submission = make_published_submission(
        submitter=submitter,
        available_until=timezone.now() + timedelta(days=20),
    )
    api_client.force_authenticate(submitter)

    response = api_client.post(f"/api/v1/submissions/{submission.id}/{action}/")

    assert response.status_code == 200
    submission.listing.refresh_from_db()
    assert submission.listing.state == expected_state
    assert not Listing.objects.active().filter(pk=submission.listing_id).exists()


@pytest.mark.django_db
def test_submitter_cannot_change_another_submitters_listing(api_client: APIClient):
    owner = User.objects.create_user(email="owner@example.com", password="password")
    outsider = User.objects.create_user(email="outsider@example.com", password="password")
    submission = make_published_submission(
        submitter=owner,
        available_until=timezone.now() + timedelta(days=20),
    )
    api_client.force_authenticate(outsider)

    response = api_client.post(f"/api/v1/submissions/{submission.id}/archive/")

    assert response.status_code == 404
    submission.listing.refresh_from_db()
    assert submission.listing.state == ListingState.PUBLISHED


@pytest.mark.django_db
def test_expiry_maintenance_is_boundary_safe_and_idempotent():
    now = timezone.make_aware(datetime(2026, 8, 23, 10, 30))
    submitter = User.objects.create_user(email="submitter@example.com", password="password")
    due = make_published_submission(submitter=submitter, available_until=now).listing

    with patch("apps.catalog.services.timezone.now", return_value=now):
        first_count = expire_due_listings()
        second_count = expire_due_listings()

    due.refresh_from_db()
    assert first_count == 1
    assert second_count == 0
    assert due.state == ListingState.EXPIRED


@pytest.mark.django_db
def test_confirming_an_expired_listing_makes_its_property_eligible_again(
    api_client: APIClient,
):
    now = timezone.make_aware(datetime(2026, 8, 23, 10, 30))
    submitter = User.objects.create_user(email="submitter@example.com", password="password")
    submission = make_published_submission(
        submitter=submitter,
        available_until=now - timedelta(minutes=1),
    )
    submission.listing.state = ListingState.EXPIRED
    submission.listing.save(update_fields=("state",))
    api_client.force_authenticate(submitter)

    with patch("apps.catalog.services.timezone.now", return_value=now):
        response = api_client.post(f"/api/v1/submissions/{submission.id}/confirm-availability/")

    assert response.status_code == 200
    assert Listing.objects.active().filter(pk=submission.listing_id).exists()


@pytest.mark.django_db
def test_operator_filters_expiring_listings_and_marks_them_unavailable_in_admin():
    now = timezone.make_aware(datetime(2026, 8, 23, 10, 30))
    operator = User.objects.create_superuser(email="operator@example.com", password="password")
    submitter = User.objects.create_user(email="submitter@example.com", password="password")
    expiring = make_published_submission(
        submitter=submitter,
        available_until=now + timedelta(days=7),
    ).listing
    far_terms = RentalTerms.objects.create(
        deposit_rial=6_000_000_000,
        monthly_rent_rial=300_000_000,
    )
    far = Listing.objects.create(
        property=expiring.property,
        source=expiring.source,
        terms=far_terms,
        state=ListingState.PUBLISHED,
        direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
        availability_confirmed_at=now,
        available_until=now + timedelta(days=8),
    )
    client = Client()
    client.force_login(operator)

    with patch("apps.catalog.admin.timezone.now", return_value=now):
        filtered = client.get("/admin/catalog/listing/", {"availability_status": "expiring_soon"})

    assert filtered.status_code == 200
    assert str(expiring.id) in filtered.content.decode()
    assert str(far.id) not in filtered.content.decode()

    acted = client.post(
        "/admin/catalog/listing/",
        {
            "action": "mark_unavailable",
            "_selected_action": str(expiring.id),
            "index": "0",
        },
        follow=True,
    )
    assert acted.status_code == 200
    expiring.refresh_from_db()
    assert expiring.state == ListingState.UNAVAILABLE


@pytest.mark.django_db
def test_multi_listing_property_disappears_at_tehran_deadline_and_returns_after_confirmation(
    api_client: APIClient,
):
    call_command("loaddata", "catalog_seed", verbosity=0)
    now = datetime(2026, 8, 23, 14, 0, tzinfo=ZoneInfo("Asia/Tehran"))
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    property_ = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=85,
        room_count=2,
    )
    source = Source.objects.get(is_builtin=True)
    submitter = User.objects.create_user(email="submitter@example.com", password="password")
    listings = []
    for index, deadline in enumerate((now, now + timedelta(days=1)), start=1):
        listing = Listing.objects.create(
            property=property_,
            source=source,
            terms=RentalTerms.objects.create(
                deposit_rial=index * 5_000_000_000,
                monthly_rent_rial=index * 250_000_000,
            ),
            state=ListingState.PUBLISHED,
            direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
            published_at=now - timedelta(days=30),
            availability_confirmed_at=now - timedelta(days=30),
            available_until=deadline,
        )
        submission = Submission.objects.create(
            submitter=submitter,
            role="owner",
            state=SubmissionState.PUBLISHED,
            source=source,
            listing=listing,
        )
        listings.append((listing, submission))
    api_client.force_authenticate(submitter)

    with (
        timezone.override("Asia/Tehran"),
        patch("apps.catalog.models.timezone.now", return_value=now),
    ):
        initially_visible = api_client.get("/api/v1/catalog/properties/")
        archived = api_client.post(f"/api/v1/submissions/{listings[1][1].id}/archive/")
        hidden_search = api_client.get("/api/v1/catalog/properties/")
        hidden_detail = api_client.get(f"/api/v1/catalog/properties/{property_.id}/")
        confirmed = api_client.post(
            f"/api/v1/submissions/{listings[0][1].id}/confirm-availability/"
        )
        visible_again = api_client.get("/api/v1/catalog/properties/")
        detail_again = api_client.get(f"/api/v1/catalog/properties/{property_.id}/")

    assert initially_visible.data["results"][0]["listing_count"] == 1
    assert archived.status_code == 200
    assert hidden_search.data["results"] == []
    assert hidden_detail.status_code == 404
    assert confirmed.status_code == 200
    assert visible_again.data["results"][0]["id"] == str(property_.id)
    assert visible_again.data["results"][0]["listing_count"] == 1
    assert detail_again.status_code == 200
