from datetime import UTC, datetime
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db.models import Count, Q
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import (
    FeatureState,
    Listing,
    ListingImage,
    ListingState,
    Property,
    PropertyImage,
    PropertyType,
    RentalTerms,
)
from apps.common.development_seed import DevelopmentFixtureKind, development_fixture_id
from apps.communications.models import (
    ListingInquiry,
    ListingInquiryMessage,
    SystemNotification,
    SystemNotificationReadState,
)
from apps.contact.models import (
    SupportMessage,
    SupportRequest,
    SupportRequestStatus,
)
from apps.submissions.models import Submission, SubmissionEvent, SubmissionState


def login(email: str, password: str) -> APIClient:
    client = APIClient()
    session = client.get("/api/v1/auth/session/")
    client.credentials(HTTP_X_CSRFTOKEN=session.data["csrf_token"])
    response = client.post(
        "/api/v1/auth/login/", {"identifier": email, "password": password}, format="json"
    )
    assert response.status_code == 200
    return client


@pytest.mark.django_db
def test_seed_dev_creates_catalog_and_prepared_personas():
    output = StringIO()

    call_command("seed_dev", stdout=output)

    assert Property.objects.count() == 60
    assert Listing.objects.count() == 80
    assert (
        Property.objects
        .filter(
            approximate_latitude__isnull=False,
            approximate_longitude__isnull=False,
            location_radius_meters__isnull=False,
        )
        .exclude(location_precision="")
        .count()
        == 60
    )
    assert User.objects.get(email="submitter@torobrent.local").check_password("dev-submitter")
    operator = User.objects.get(email="operator@torobrent.local")
    assert operator.check_password("dev-operator")
    assert operator.is_staff is True
    assert "60 Properties, 80 Listings" in output.getvalue()


@pytest.mark.django_db
def test_seed_dev_catalog_exercises_review_scenarios():
    call_command("seed_dev", verbosity=0)

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
    image_counts = set(
        Listing.objects
        .annotate(total=Count("images"))
        .filter(total__gt=0)
        .values_list("total", flat=True)
    )
    assert image_counts == {1, 2, 3}
    assert (
        Listing.objects
        .filter(source__allows_external_media=False, images__isnull=False)
        .filter(source__is_builtin=False)
        .count()
        == 0
    )
    assert ListingImage.objects.annotate(total=Count("variants")).exclude(total=3).count() == 0
    assert Property.objects.filter(images__isnull=False).distinct().count() == 30
    assert PropertyImage.objects.filter(is_primary=True).count() == 30
    assert PropertyImage.objects.annotate(total=Count("variants")).exclude(total=3).count() == 0
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
    for listing in Listing.objects.select_related(
        "property__city", "property__district", "property__neighborhood", "source", "terms"
    ):
        listing.property.full_clean()
        listing.terms.full_clean()
        listing.full_clean()


@pytest.mark.django_db
def test_seed_dev_media_matches_public_catalog_contract():
    call_command("seed_dev", verbosity=0)
    property_ = Property.objects.get(id=development_fixture_id(DevelopmentFixtureKind.PROPERTY, 1))

    client = APIClient()
    search = client.get("/api/v1/catalog/properties/")
    assert search.status_code == 200
    assert any(result["primary_image"] is not None for result in search.data["results"])

    detail = client.get(f"/api/v1/catalog/properties/{property_.id}/")
    assert detail.status_code == 200
    listing = detail.data["listings"][0]
    assert len(listing["images"]) == 3
    variants = listing["images"][0]["variants"]
    assert {variant["kind"] for variant in variants} == {"small", "medium", "large"}
    assert client.get(variants[0]["url"]).status_code == 200
    assert len(listing["price_history"]) >= 3
    assert len({point["deposit_toman"] for point in listing["price_history"]}) >= 2
    assert len({point["monthly_rent_toman"] for point in listing["price_history"]}) >= 2


@pytest.mark.django_db
def test_seed_dev_upgrades_existing_fixture_taxonomy():
    call_command("seed_dev", verbosity=0)
    shop_fixture = Property.objects.get(
        id=development_fixture_id(DevelopmentFixtureKind.PROPERTY, 5)
    )
    shop_fixture.property_type = PropertyType.APARTMENT
    shop_fixture.room_count = 2
    shop_fixture.save(update_fields=("property_type", "room_count"))

    call_command("seed_dev", verbosity=0)

    shop_fixture.refresh_from_db()
    assert shop_fixture.property_type == PropertyType.SHOP
    assert shop_fixture.room_count is None


@pytest.mark.django_db
def test_seed_dev_prepares_submitter_workflows_and_is_idempotent():
    call_command("seed_dev", verbosity=0)
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

    call_command("seed_dev", verbosity=0)

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
def test_seed_dev_includes_review_history_and_reasons():
    call_command("seed_dev", verbosity=0)

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
def test_seed_dev_prepares_message_center_scenarios_and_role_specific_accounts():
    call_command("seed_dev", verbosity=0)

    renter = User.objects.get(email="renter@torobrent.local")
    assert renter.check_password("dev-renter")
    assert renter.display_name
    reviewer = User.objects.get(email="reviewer@torobrent.local")
    assert reviewer.check_password("dev-reviewer")
    assert reviewer.groups.filter(name="Submission Reviewer").exists()
    support_operator = User.objects.get(email="support@torobrent.local")
    assert support_operator.check_password("dev-support")
    assert support_operator.groups.filter(name="Support Operator").exists()

    inquiries = ListingInquiry.objects.filter(
        id__in=[
            development_fixture_id(DevelopmentFixtureKind.LISTING_INQUIRY, index)
            for index in (1, 2)
        ]
    )
    assert inquiries.count() == 2
    assert ListingInquiryMessage.objects.filter(inquiry__in=inquiries).count() == 5
    assert inquiries.filter(listing__state=ListingState.EXPIRED).exists()
    assert inquiries.filter(renter_read_at__isnull=True).exists()
    assert inquiries.filter(submitter_read_at__isnull=True).exists()

    notifications = SystemNotification.objects.filter(recipient__email="submitter@torobrent.local")
    assert notifications.count() == 4
    assert SystemNotificationReadState.objects.filter(notification__in=notifications).count() == 1

    support_requests = SupportRequest.objects.filter(
        id__in=[
            development_fixture_id(DevelopmentFixtureKind.SUPPORT_REQUEST, index)
            for index in range(1, 5)
        ]
    )
    assert set(support_requests.values_list("status", flat=True)) == set(
        SupportRequestStatus.values
    )
    assert SupportMessage.objects.filter(support_request__in=support_requests).count() == 6


@pytest.mark.django_db
def test_seed_dev_does_not_replace_edited_fixture_messages():
    call_command("seed_dev", verbosity=0)
    message = ListingInquiryMessage.objects.get(
        id=development_fixture_id(DevelopmentFixtureKind.LISTING_INQUIRY_MESSAGE, 11)
    )
    message.body = "متن ویرایش شده توسعه دهنده"
    message.save(update_fields=("body",))

    call_command("seed_dev", verbosity=0)

    message.refresh_from_db()
    assert message.body == "متن ویرایش شده توسعه دهنده"
    assert ListingInquiryMessage.objects.count() == 5


@pytest.mark.django_db
def test_seed_dev_personas_can_access_their_prepared_queues():
    call_command("seed_dev", verbosity=0)

    submitter = login("submitter@torobrent.local", "dev-submitter")
    assert submitter.get("/api/v1/submissions/").status_code == 200
    message_center = submitter.get("/api/v1/messages/")
    assert message_center.status_code == 200
    assert message_center.data["count"] == 10
    assert submitter.get("/api/v1/messages/unread-count/").data["count"] > 0

    renter = login("renter@torobrent.local", "dev-renter")
    renter_messages = renter.get("/api/v1/messages/")
    assert renter_messages.status_code == 200
    assert renter_messages.data["count"] == 1

    operator = login("operator@torobrent.local", "dev-operator")
    response = operator.get("/api/v1/operator/submissions/?state=pending")
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert len(response.data["results"]) == 1

    reviewer = login("reviewer@torobrent.local", "dev-reviewer")
    assert reviewer.get("/api/v1/operator/submissions/?state=pending").status_code == 200

    support_operator = login("support@torobrent.local", "dev-support")
    support_queue = support_operator.get("/api/v1/operator/support-requests/")
    assert support_queue.status_code == 200
    assert support_queue.data["count"] == 3


@pytest.mark.django_db
def test_seed_dev_rejects_non_development_settings(settings):
    settings.SETTINGS_MODULE = "config.settings.production"

    with pytest.raises(CommandError, match="development or test settings"):
        call_command("seed_dev", verbosity=0)
