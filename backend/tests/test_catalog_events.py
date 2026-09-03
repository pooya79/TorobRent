import uuid
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import (
    Listing,
    ListingState,
    Neighborhood,
    OutboundPolicy,
    ProductEvent,
    ProductEventType,
    Property,
    PropertyType,
    RentalTerms,
    Source,
)
from apps.communications.models import SystemNotification
from apps.submissions.models import Submission, SubmissionState, SubmitterRole


def create_property() -> Property:
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    return Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=110,
        room_count=2,
    )


def create_active_listing(
    *,
    property_: Property,
    source: Source,
    direct_phone: str = "۰۹۱۲۱۲۳۴۵۶۷",
    external_url: str = "",
) -> Listing:
    now = timezone.now()
    return Listing.objects.create(
        property=property_,
        source=source,
        terms=RentalTerms.objects.create(
            deposit_rial=10_000_000_000,
            monthly_rent_rial=250_000_000,
        ),
        state=ListingState.PUBLISHED,
        direct_phone=direct_phone,
        external_url=external_url,
        published_at=now,
        availability_confirmed_at=now,
        available_until=now + timedelta(days=30),
    )


def approve_listing_phone(*, listing: Listing, submitter: User) -> Submission:
    return Submission.objects.create(
        submitter=submitter,
        role=SubmitterRole.OWNER,
        state=SubmissionState.PUBLISHED,
        source=listing.source,
        listing=listing,
        contact_name="ثبت‌کننده",
        contact_phone=listing.direct_phone,
        authorization_declared=True,
        phone_publication_consent=True,
    )


@pytest.fixture
def catalog(db) -> tuple[Property, Source, User]:
    call_command("loaddata", "catalog_seed", verbosity=0)
    return (
        create_property(),
        Source.objects.get(is_builtin=True),
        User.objects.create_user(email="submitter@example.com", password="password-value"),
    )


def event_headers(token: uuid.UUID | None = None) -> dict[str, str]:
    return {"HTTP_X_TOROBRENT_EVENT_SESSION": str(token or uuid.uuid4())}


@pytest.mark.django_db
def test_renter_reveals_only_the_submitter_approved_phone_from_an_active_direct_listing(
    api_client: APIClient,
    catalog: tuple[Property, Source, User],
):
    property_, direct_source, submitter = catalog
    listing = create_active_listing(property_=property_, source=direct_source)
    approve_listing_phone(listing=listing, submitter=submitter)
    renter = User.objects.create_user(
        email="renter@example.com",
        password="password-value",
        email_verified_at=timezone.now(),
    )
    api_client.force_authenticate(renter)

    detail = api_client.get(f"/api/v1/catalog/properties/{property_.id}/")
    response = api_client.post(
        f"/api/v1/catalog/listings/{listing.id}/phone-reveal/",
        {},
        format="json",
        **event_headers(),
    )

    assert "direct_phone" not in detail.data["listings"][0]
    assert response.status_code == 200
    assert response.data == {"phone": "۰۹۱۲۱۲۳۴۵۶۷"}
    event = ProductEvent.objects.get()
    assert event.event_type == ProductEventType.PHONE_REVEAL
    assert event.property_id == property_.id
    assert event.listing_id == listing.id
    assert event.source_id == direct_source.id
    assert not SystemNotification.objects.exists()


@pytest.mark.django_db
def test_phone_reveal_requires_an_active_account_with_a_verified_identifier(
    api_client: APIClient,
    catalog: tuple[Property, Source, User],
):
    property_, direct_source, submitter = catalog
    listing = create_active_listing(property_=property_, source=direct_source)
    approve_listing_phone(listing=listing, submitter=submitter)
    reveal_url = f"/api/v1/catalog/listings/{listing.id}/phone-reveal/"

    anonymous = api_client.post(reveal_url, {}, format="json", **event_headers())
    unverified = User.objects.create_user(
        email="unverified@example.com",
        password="password-value",
    )
    api_client.force_authenticate(unverified)
    without_verified_identifier = api_client.post(reveal_url, {}, format="json", **event_headers())
    unverified.is_active = False
    unverified.email_verified_at = timezone.now()
    unverified.save(update_fields=("is_active", "email_verified_at"))
    api_client.force_authenticate(unverified)
    inactive = api_client.post(reveal_url, {}, format="json", **event_headers())

    assert anonymous.status_code == 401
    assert without_verified_identifier.status_code == inactive.status_code == 403
    assert not ProductEvent.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("change", "value"),
    [
        ("state", ListingState.DRAFT),
        ("state", ListingState.EXPIRED),
        ("state", ListingState.ARCHIVED),
        ("state", ListingState.UNAVAILABLE),
        ("available_until", timezone.now() - timedelta(seconds=1)),
    ],
)
def test_inactive_direct_listings_cannot_reveal_contact(
    api_client: APIClient,
    catalog: tuple[Property, Source, User],
    change: str,
    value: object,
):
    property_, direct_source, submitter = catalog
    listing = create_active_listing(property_=property_, source=direct_source)
    approve_listing_phone(listing=listing, submitter=submitter)
    setattr(listing, change, value)
    listing.save(update_fields=[change])
    renter = User.objects.create_user(
        email=f"renter-{uuid.uuid4()}@example.com",
        password="password-value",
        email_verified_at=timezone.now(),
    )
    api_client.force_authenticate(renter)

    response = api_client.post(
        f"/api/v1/catalog/listings/{listing.id}/phone-reveal/",
        {},
        format="json",
        **event_headers(),
    )

    assert response.status_code == 404
    assert ProductEvent.objects.count() == 0


@pytest.mark.django_db
def test_unapproved_or_non_direct_listing_cannot_reveal_contact(
    api_client: APIClient,
    catalog: tuple[Property, Source, User],
):
    property_, direct_source, _submitter = catalog
    unapproved = create_active_listing(property_=property_, source=direct_source)
    external_source = Source.objects.create(
        name="external",
        domain="external.example",
        display_name="منبع بیرونی",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    external = create_active_listing(
        property_=property_,
        source=external_source,
        direct_phone="",
        external_url="https://external.example/listing/1",
    )
    renter = User.objects.create_user(
        email="renter@example.com",
        password="password-value",
        email_verified_at=timezone.now(),
    )
    api_client.force_authenticate(renter)
    detail = api_client.get(f"/api/v1/catalog/properties/{property_.id}/")

    for listing in (unapproved, external):
        response = api_client.post(
            f"/api/v1/catalog/listings/{listing.id}/phone-reveal/",
            {},
            format="json",
            **event_headers(),
        )
        assert response.status_code == 404

    assert ProductEvent.objects.count() == 0
    contact_states = {
        item["id"]: (
            item["can_reveal_phone"],
            item["phone_reveal_unavailable_reason"],
        )
        for item in detail.data["listings"]
    }
    assert contact_states[str(unapproved.id)] == (False, "phone_unavailable")
    assert contact_states[str(external.id)] == (False, "external_listing")


@pytest.mark.django_db
def test_external_continuation_is_resolved_through_the_sources_active_outbound_policy(
    api_client: APIClient,
    catalog: tuple[Property, Source, User],
):
    property_, _direct_source, _submitter = catalog
    external_source = Source.objects.create(
        name="external",
        domain="external.example",
        display_name="منبع بیرونی",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    listing = create_active_listing(
        property_=property_,
        source=external_source,
        direct_phone="",
        external_url="https://external.example/listing/1",
    )

    response = api_client.post(
        f"/api/v1/catalog/listings/{listing.id}/continuation/",
        {},
        format="json",
        **event_headers(),
    )
    assert response.status_code == 200
    assert response.data == {"url": "https://external.example/listing/1"}

    external_source.outbound_policy = OutboundPolicy.DISABLED
    external_source.save(update_fields=["outbound_policy"])
    blocked = api_client.post(
        f"/api/v1/catalog/listings/{listing.id}/continuation/",
        {},
        format="json",
        **event_headers(),
    )
    assert blocked.status_code == 404
    assert (
        ProductEvent.objects.filter(event_type=ProductEventType.EXTERNAL_CONTINUATION).count() == 1
    )


@pytest.mark.django_db
def test_product_events_deduplicate_within_one_tab_without_persisting_identity_context(
    api_client: APIClient,
    catalog: tuple[Property, Source, User],
):
    property_, source, _submitter = catalog
    create_active_listing(property_=property_, source=source)
    create_active_listing(property_=property_, source=source)
    token = uuid.uuid4()
    url = f"/api/v1/catalog/properties/{property_.id}/view/"

    first = api_client.post(url, {}, format="json", **event_headers(token))
    duplicate = api_client.post(url, {}, format="json", **event_headers(token))
    another_tab = api_client.post(url, {}, format="json", **event_headers())

    assert first.status_code == duplicate.status_code == another_tab.status_code == 204
    assert ProductEvent.objects.filter(event_type=ProductEventType.PROPERTY_VIEW).count() == 2
    event_fields = {field.name for field in ProductEvent._meta.get_fields()}
    assert event_fields == {"id", "event_type", "property", "listing", "source", "created_at"}


@pytest.mark.django_db
def test_event_actions_require_an_ephemeral_session_token(
    api_client: APIClient,
    catalog: tuple[Property, Source, User],
):
    property_, source, _submitter = catalog
    create_active_listing(property_=property_, source=source)

    response = api_client.post(
        f"/api/v1/catalog/properties/{property_.id}/view/", {}, format="json"
    )

    assert response.status_code == 400
    assert ProductEvent.objects.count() == 0


@pytest.mark.django_db
def test_public_event_actions_do_not_depend_on_an_authenticated_session_csrf_state(
    api_client: APIClient,
    catalog: tuple[Property, Source, User],
):
    property_, source, submitter = catalog
    create_active_listing(property_=property_, source=source)
    api_client.force_login(submitter)

    response = api_client.post(
        f"/api/v1/catalog/properties/{property_.id}/view/",
        {},
        format="json",
        **event_headers(),
    )

    assert response.status_code == 204
    assert ProductEvent.objects.count() == 1


@pytest.mark.django_db
def test_event_rate_control_rejects_excess_unique_actions_from_one_tab(
    api_client: APIClient,
    catalog: tuple[Property, Source, User],
    monkeypatch: pytest.MonkeyPatch,
):
    property_, source, _submitter = catalog
    other_property = create_property()
    create_active_listing(property_=property_, source=source)
    create_active_listing(property_=other_property, source=source)
    monkeypatch.setattr("apps.catalog.services.EVENT_RATE_LIMIT", 1)
    token = uuid.uuid4()

    accepted = api_client.post(
        f"/api/v1/catalog/properties/{property_.id}/view/",
        {},
        format="json",
        **event_headers(token),
    )
    throttled = api_client.post(
        f"/api/v1/catalog/properties/{other_property.id}/view/",
        {},
        format="json",
        **event_headers(token),
    )

    assert accepted.status_code == 204
    assert throttled.status_code == 429
    assert ProductEvent.objects.count() == 1


@pytest.mark.django_db
def test_operator_sees_filtered_aggregate_event_counts_in_admin(
    client,
    catalog: tuple[Property, Source, User],
):
    property_, source, _submitter = catalog
    listing = create_active_listing(property_=property_, source=source)
    ProductEvent.objects.bulk_create([
        ProductEvent(event_type=ProductEventType.PROPERTY_VIEW, property=property_),
        ProductEvent(event_type=ProductEventType.PROPERTY_VIEW, property=property_),
        ProductEvent(
            event_type=ProductEventType.PHONE_REVEAL,
            property=property_,
            listing=listing,
            source=source,
        ),
    ])
    operator = User.objects.create_superuser(
        email="operator@example.com", password="password-value"
    )
    client.force_login(operator)

    response = client.get(
        reverse("admin:catalog_productevent_changelist"),
        {"event_type__exact": ProductEventType.PROPERTY_VIEW, "period": "7d"},
    )

    assert response.status_code == 200
    assert response.context["event_total"] == 2
    assert response.context["event_type_counts"] == [
        {"event_type": ProductEventType.PROPERTY_VIEW, "count": 2}
    ]
    assert response.context["property_counts"] == [{"property_id": property_.id, "count": 2}]
    assert response.context["listing_counts"] == []
    assert response.context["source_counts"] == []

    listing_response = client.get(
        reverse("admin:catalog_productevent_changelist"),
        {"event_type__exact": ProductEventType.PHONE_REVEAL, "period": "7d"},
    )
    assert listing_response.context["event_total"] == 1
    assert listing_response.context["listing_counts"] == [{"listing_id": listing.id, "count": 1}]
    assert listing_response.context["source_counts"] == [{"source_id": source.id, "count": 1}]


@pytest.mark.django_db
def test_operator_event_aggregates_default_to_a_bounded_seven_day_period(
    client,
    catalog: tuple[Property, Source, User],
):
    property_, _source, _submitter = catalog
    recent = ProductEvent.objects.create(
        event_type=ProductEventType.PROPERTY_VIEW,
        property=property_,
    )
    old = ProductEvent.objects.create(
        event_type=ProductEventType.PROPERTY_VIEW,
        property=property_,
    )
    ProductEvent.objects.filter(id=old.id).update(created_at=timezone.now() - timedelta(days=8))
    operator = User.objects.create_superuser(
        email="operator@example.com", password="password-value"
    )
    client.force_login(operator)

    response = client.get(reverse("admin:catalog_productevent_changelist"))

    assert response.status_code == 200
    assert response.context["event_total"] == 1
    assert response.context["cl"].queryset.get() == recent
