from decimal import Decimal

import pytest
from django.contrib.auth.models import Permission
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import (
    City,
    Listing,
    ListingState,
    Neighborhood,
    OutboundPolicy,
    Property,
    PropertyType,
    RentalTerms,
    Source,
)


def make_operator(*, email: str, capability: str | None = "curate_catalog") -> User:
    operator = User.objects.create_user(
        email=email,
        password="password",
        email_verified_at=timezone.now(),
    )
    if capability:
        operator.user_permissions.add(Permission.objects.get(codename=capability))
    return operator


def make_current_property(
    *,
    source: Source,
    source_reference: str,
    area_sqm: int = 90,
    latitude: Decimal | None = Decimal("35.774100"),
    longitude: Decimal | None = Decimal("51.356200"),
) -> tuple[Property, Listing]:
    if not Neighborhood.objects.exists():
        call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    property_ = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=area_sqm,
        room_count=2,
        floor=3,
        total_floors=6,
        units_per_floor=2,
        parking="present",
        elevator="present",
        storage="unknown",
        latitude=latitude,
        longitude=longitude,
        operator_location_notes="پلاک با تماس منبع تطبیق داده شد",
        provenance_note="facts normalized during review",
    )
    terms = RentalTerms.objects.create(
        deposit_rial=5_000_000_000,
        monthly_rent_rial=300_000_000,
    )
    listing = Listing.objects.create(
        property=property_,
        source=source,
        terms=terms,
        state=ListingState.PUBLISHED,
        source_reference=source_reference,
        source_claims={"address": "restricted source address"},
        provenance_note="captured from the source page",
        external_url=f"https://{source.domain}/{source_reference}",
        available_until=timezone.now() + timezone.timedelta(days=14),
        availability_confirmed_at=timezone.now(),
    )
    return property_, listing


@pytest.mark.django_db
def test_catalog_curation_is_an_independent_operator_capability(api_client: APIClient):
    curator = make_operator(email="curator@example.com")
    reviewer = make_operator(email="reviewer@example.com", capability="review_submission")

    api_client.force_authenticate(curator)
    current_user = api_client.get("/api/v1/users/me/")
    allowed = api_client.get("/api/v1/operator/catalog-curation/properties/")

    api_client.force_authenticate(reviewer)
    denied = api_client.get("/api/v1/operator/catalog-curation/properties/")

    assert current_user.data["operator_capabilities"] == ["curate_catalog"]
    assert allowed.status_code == 200
    assert denied.status_code == 403


@pytest.mark.django_db
def test_curator_searches_current_properties_by_each_supported_identity(api_client: APIClient):
    curator = make_operator(email="curator@example.com")
    source = Source.objects.create(
        name="curation-source",
        domain="curation.example",
        display_name="منبع مقایسه",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    property_, listing = make_current_property(
        source=source,
        source_reference="REF-731",
    )
    merged, _ = make_current_property(source=source, source_reference="OLD-1")
    merged.merged_into = property_
    merged.merged_at = timezone.now()
    merged.save(update_fields=["merged_into", "merged_at"])
    api_client.force_authenticate(curator)

    queries = (
        str(property_.id),
        str(listing.id),
        "منبع مقایسه",
        "سعادت آباد",
        "REF-731",
    )
    for query in queries:
        response = api_client.get("/api/v1/operator/catalog-curation/properties/", {"q": query})
        assert response.status_code == 200
        assert response.data["count"] == 1
        assert [item["id"] for item in response.data["results"]] == [str(property_.id)]


@pytest.mark.django_db
def test_curator_compares_two_properties_with_explainable_versioned_evidence(
    api_client: APIClient,
):
    curator = make_operator(email="curator@example.com")
    source = Source.objects.create(
        name="curation-source",
        domain="curation.example",
        display_name="منبع مقایسه",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    left, left_listing = make_current_property(source=source, source_reference="LEFT-1")
    right, _ = make_current_property(
        source=source,
        source_reference="RIGHT-1",
        area_sqm=92,
        latitude=Decimal("35.774120"),
        longitude=Decimal("51.356180"),
    )
    api_client.force_authenticate(curator)

    response = api_client.get(
        "/api/v1/operator/catalog-curation/comparison/",
        {"property": [str(left.id), str(right.id)]},
    )

    assert response.status_code == 200
    assert response.data["scoring_version"] == "property-match-v1"
    assert response.data["score"] == 100
    assert response.data["band"] == "likely"
    assert response.data["is_calibrated_probability"] is False
    assert len(response.data["properties"]) == 2
    assert response.data["properties"][0]["exact_location"] == {
        "latitude": "35.774100",
        "longitude": "51.356200",
        "operator_notes": "پلاک با تماس منبع تطبیق داده شد",
    }
    assert response.data["properties"][0]["listings"][0] == {
        "id": str(left_listing.id),
        "source": {
            "id": str(source.id),
            "name": "منبع مقایسه",
            "domain": "curation.example",
        },
        "source_reference": "LEFT-1",
        "source_claims": {"address": "restricted source address"},
        "provenance_note": "captured from the source page",
    }
    assert all(
        set(signal)
        == {
            "key",
            "label",
            "compared_values",
            "classification",
            "contribution",
        }
        for signal in response.data["signals"]
    )
    assert {signal["classification"] for signal in response.data["signals"]} <= {
        "support",
        "contradiction",
        "neutral",
        "blocker",
    }


@pytest.mark.django_db
def test_distant_exact_locations_are_a_hard_blocker(api_client: APIClient):
    curator = make_operator(email="curator@example.com")
    source = Source.objects.create(
        name="curation-source",
        domain="curation.example",
        display_name="منبع مقایسه",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    left, _ = make_current_property(source=source, source_reference="LEFT-1")
    right, _ = make_current_property(
        source=source,
        source_reference="RIGHT-1",
        latitude=Decimal("35.790000"),
        longitude=Decimal("51.390000"),
    )
    api_client.force_authenticate(curator)

    response = api_client.get(
        "/api/v1/operator/catalog-curation/comparison/",
        {"property": [str(left.id), str(right.id)]},
    )

    assert response.status_code == 200
    assert response.data["score"] == 0
    assert response.data["band"] == "below_threshold"
    assert any(signal["classification"] == "blocker" for signal in response.data["signals"])


@pytest.mark.django_db
def test_different_cities_are_a_hard_blocker(api_client: APIClient):
    curator = make_operator(email="curator@example.com")
    source = Source.objects.create(
        name="curation-source",
        domain="curation.example",
        display_name="منبع مقایسه",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    left, _ = make_current_property(source=source, source_reference="LEFT-1")
    right, _ = make_current_property(source=source, source_reference="RIGHT-1")
    other_city = City.objects.create(
        name_fa="کرج",
        source_code="test-karaj",
        source_year=1405,
        provenance_url="https://example.com/karaj",
        imported_at=timezone.localdate(),
        reviewed=True,
    )
    right.city = other_city
    right.save(update_fields=["city"])
    api_client.force_authenticate(curator)

    response = api_client.get(
        "/api/v1/operator/catalog-curation/comparison/",
        {"property": [str(left.id), str(right.id)]},
    )

    assert response.status_code == 200
    assert response.data["score"] == 0
    city_signal = next(signal for signal in response.data["signals"] if signal["key"] == "city")
    assert city_signal["classification"] == "blocker"


@pytest.mark.django_db
def test_comparison_requires_exactly_two_different_current_properties(api_client: APIClient):
    curator = make_operator(email="curator@example.com")
    source = Source.objects.create(
        name="curation-source",
        domain="curation.example",
        display_name="منبع مقایسه",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    property_, _ = make_current_property(source=source, source_reference="LEFT-1")
    api_client.force_authenticate(curator)

    one = api_client.get(
        "/api/v1/operator/catalog-curation/comparison/",
        {"property": [str(property_.id)]},
    )
    same = api_client.get(
        "/api/v1/operator/catalog-curation/comparison/",
        {"property": [str(property_.id), str(property_.id)]},
    )

    assert one.status_code == 400
    assert same.status_code == 400


@pytest.mark.django_db
def test_restricted_identity_evidence_does_not_leak_through_public_property_detail(
    api_client: APIClient,
):
    source = Source.objects.create(
        name="curation-source",
        domain="curation.example",
        display_name="منبع مقایسه",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    property_, _ = make_current_property(source=source, source_reference="PRIVATE-1")

    response = api_client.get(f"/api/v1/catalog/properties/{property_.id}/")

    assert response.status_code == 200
    serialized = str(response.data)
    assert "35.774100" not in serialized
    assert "restricted source address" not in serialized
    assert "facts normalized during review" not in serialized
    assert "captured from the source page" not in serialized
