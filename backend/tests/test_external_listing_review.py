from datetime import timedelta

import pytest
from django.contrib.auth.models import Permission
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import (
    Listing,
    ListingState,
    OutboundPolicy,
    Property,
    RentalTerms,
    Source,
)
from apps.catalog.services import (
    attach_listing,
    confirm_listing_availability,
    expire_listings,
    mark_listing_unavailable,
)
from apps.source_proposals.models import SourceProposal
from apps.source_proposals.services import generate_simulated_external_listing_candidates


def make_representative() -> User:
    return User.objects.create_user(
        email="representative@example.com",
        password="password",
        email_verified_at=timezone.now(),
        phone="09120000001",
        phone_verified_at=timezone.now(),
        is_submitter=True,
    )


def make_operator(email: str) -> User:
    operator = User.objects.create_user(
        email=email,
        password="password",
        email_verified_at=timezone.now(),
        phone=f"09{User.objects.count() + 1:09d}",
        phone_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="source_proposals",
            codename="review_source_proposal",
        )
    )
    return operator


@pytest.mark.django_db
def test_only_approved_source_proposal_generates_deterministic_simulated_candidates():
    call_command("loaddata", "catalog_seed", verbosity=0)
    proposal = SourceProposal.objects.create(
        submitter=make_representative(),
        state="pending",
        website_name="خانه‌یاب",
        website_url="https://khaneh.example/rentals",
        normalized_domain="khaneh.example",
        source=Source.objects.create(
            name="external-khaneh",
            domain="khaneh.example",
            display_name="خانه‌یاب",
            outbound_policy=OutboundPolicy.EXTERNAL_LINK,
        ),
    )

    with pytest.raises(ValidationError):
        generate_simulated_external_listing_candidates(proposal=proposal)

    proposal.state = "approved"
    proposal.save(update_fields=("state",))
    first = generate_simulated_external_listing_candidates(proposal=proposal)
    second = generate_simulated_external_listing_candidates(proposal=proposal)

    assert [candidate.id for candidate in second] == [candidate.id for candidate in first]
    assert len(first) == 2
    assert all(candidate.simulated for candidate in first)
    assert all(candidate.state == "pending" for candidate in first)
    assert all(candidate.source_id == proposal.source_id for candidate in first)
    assert [candidate.external_url for candidate in first] == [
        "https://khaneh.example/demo-listings/residential-1",
        "https://khaneh.example/demo-listings/commercial-2",
    ]


@pytest.mark.django_db
def test_each_candidate_has_independent_protected_review_and_external_publication(api_client):
    call_command("loaddata", "catalog_seed", verbosity=0)
    representative = make_representative()
    source = Source.objects.create(
        name="external-khaneh",
        domain="khaneh.example",
        display_name="خانه‌یاب",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    proposal = SourceProposal.objects.create(
        submitter=representative,
        state="approved",
        website_name="خانه‌یاب",
        website_url="https://khaneh.example/rentals",
        normalized_domain="khaneh.example",
        source=source,
    )
    first, second = generate_simulated_external_listing_candidates(proposal=proposal)
    first_operator = make_operator("first-operator@example.com")
    second_operator = make_operator("second-operator@example.com")
    representative.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="source_proposals",
            codename="review_source_proposal",
        )
    )
    queue_url = "/api/v1/operator/external-listing-candidates/"

    api_client.force_authenticate(representative)
    assert api_client.get(queue_url).status_code == 200
    assert api_client.get(queue_url).data == []
    assert api_client.post(f"{queue_url}{first.id}/claim/", {}, format="json").status_code == 400

    api_client.force_authenticate(first_operator)
    queue = api_client.get(queue_url)
    assert queue.status_code == 200
    assert [item["id"] for item in queue.data] == [str(first.id), str(second.id)]
    assert queue.data[0]["simulated"] is True
    assert queue.data[0]["source"]["domain"] == "khaneh.example"
    assert queue.data[0]["external_url"] == first.external_url
    assert queue.data[0]["media"] == []
    assert api_client.post(f"{queue_url}{first.id}/claim/", {}, format="json").status_code == 201

    api_client.force_authenticate(second_operator)
    conflict = api_client.post(f"{queue_url}{first.id}/claim/", {}, format="json")
    assert conflict.status_code == 409
    assert conflict.data["code"] == "review_claim_conflict"

    api_client.force_authenticate(first_operator)
    changed = api_client.post(
        f"{queue_url}{first.id}/request-changes/",
        {"reviewed_revision": 1, "reason": "جزئیات این مورد نیازمند اصلاح است."},
        format="json",
    )
    assert changed.status_code == 200
    assert changed.data["state"] == "changes_requested"
    second.refresh_from_db()
    assert second.state == "pending"
    assert Listing.objects.count() == 0
    assert api_client.get("/api/v1/catalog/properties/").data["count"] == 0

    api_client.force_authenticate(second_operator)
    assert api_client.post(f"{queue_url}{second.id}/claim/", {}, format="json").status_code == 201
    published = api_client.post(
        f"{queue_url}{second.id}/approve/",
        {"reviewed_revision": 1, "confirmed": True},
        format="json",
    )
    assert published.status_code == 200
    assert published.data["state"] == "published"
    listing = Listing.objects.get()
    assert listing.source == source
    assert listing.external_url == second.external_url
    assert listing.direct_phone == ""
    assert listing.images.count() == 0
    assert api_client.get("/api/v1/catalog/properties/").data["count"] == 1
    continuation = api_client.post(
        f"/api/v1/catalog/listings/{listing.id}/continuation/",
        {},
        format="json",
        HTTP_X_TOROBRENT_EVENT_SESSION="11111111-1111-4111-8111-111111111111",
    )
    assert continuation.status_code == 200
    assert continuation.data["url"] == second.external_url
    assert (
        api_client.post(
            f"/api/v1/catalog/listings/{listing.id}/phone-reveal/",
            {},
            format="json",
            HTTP_X_TOROBRENT_EVENT_SESSION="11111111-1111-4111-8111-111111111111",
        ).status_code
        == 404
    )

    source.is_active = False
    source.save(update_fields=("is_active",))
    assert api_client.get("/api/v1/catalog/properties/").data["count"] == 0

    source.is_active = True
    source.save(update_fields=("is_active",))
    assert listing.published_at is not None
    assert listing.available_until is not None
    assert listing.available_until - listing.published_at == timedelta(days=30)
    listing.available_until = timezone.now() - timedelta(seconds=1)
    listing.save(update_fields=("available_until",))
    assert expire_listings() == 1
    listing.refresh_from_db()
    assert listing.state == ListingState.EXPIRED
    assert api_client.get("/api/v1/catalog/properties/").data["count"] == 0

    confirm_listing_availability(listing)
    listing.refresh_from_db()
    assert listing.state == ListingState.PUBLISHED
    destination = Property.objects.create(
        city=listing.property.city,
        district=listing.property.district,
        neighborhood=listing.property.neighborhood,
        property_type=listing.property.property_type,
        area_sqm=listing.property.area_sqm,
        room_count=listing.property.room_count,
    )
    Listing.objects.create(
        property=destination,
        source=source,
        terms=RentalTerms.objects.create(
            deposit_rial=1_000_000_000,
            monthly_rent_rial=100_000_000,
        ),
        state=ListingState.EXPIRED,
        external_url="https://khaneh.example/demo-listings/group-anchor",
        published_at=timezone.now() - timedelta(days=31),
        availability_confirmed_at=timezone.now() - timedelta(days=31),
        available_until=timezone.now() - timedelta(days=1),
    )
    attach_listing(
        listing=listing,
        existing_property=destination,
        reason="Deterministic grouping proof.",
    )
    listing.refresh_from_db()
    assert listing.property == destination
    assert listing.grouping_events.get().action == "attach"
    grouped = api_client.get("/api/v1/catalog/properties/")
    assert grouped.data["count"] == 1
    assert grouped.data["results"][0]["id"] == str(destination.id)

    mark_listing_unavailable(listing)
    assert api_client.get("/api/v1/catalog/properties/").data["count"] == 0
    unavailable_continuation = api_client.post(
        f"/api/v1/catalog/listings/{listing.id}/continuation/",
        {},
        format="json",
        HTTP_X_TOROBRENT_EVENT_SESSION="22222222-2222-4222-8222-222222222222",
    )
    assert unavailable_continuation.status_code == 404
