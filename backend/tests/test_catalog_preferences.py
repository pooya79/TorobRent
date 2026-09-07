import json
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.catalog.models import Listing, Neighborhood, Property, RentalTerms, Source


@pytest.fixture
def catalog(db):
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.first()
    source = Source.objects.get(is_builtin=True)
    now = timezone.now() - timedelta(hours=1)

    def create(*, area=80, elevator="unknown", deposit=1000, rent=100, property_=None):
        property_ = property_ or Property.objects.create(
            city=neighborhood.district.city,
            district=neighborhood.district,
            neighborhood=neighborhood,
            property_type="apartment",
            area_sqm=area,
            elevator=elevator,
            room_count=2,
        )
        listing = Listing.objects.create(
            property=property_,
            source=source,
            terms=RentalTerms.objects.create(
                deposit_rial=deposit * 10, monthly_rent_rial=rent * 10
            ),
            state="published",
            direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
            availability_confirmed_at=now,
            available_until=now + timedelta(days=20),
        )
        return property_, listing

    return create


@pytest.mark.django_db
def test_preferences_rank_all_eligible_properties_and_explain_unknowns(api_client, catalog):
    absent, _ = catalog(elevator="absent")
    present, _ = catalog(elevator="present")
    unknown, _ = catalog()
    response = api_client.get(
        "/api/v1/catalog/properties/",
        {
            "ordering": "preference_fit",
            "preferences": json.dumps({
                "elevator": {"priority": "very_important", "target": "present"}
            }),
        },
    )
    assert response.status_code == 200
    rows = response.data["results"]
    assert response.data["count"] == 3
    assert rows[0]["id"] == str(present.id)
    evidence = {row["id"]: row["preference_assessment"] for row in rows}
    assert evidence[str(present.id)]["satisfied"] == ["elevator"]
    assert evidence[str(absent.id)]["trade_offs"] == ["elevator"]
    assert evidence[str(unknown.id)]["unknown"] == ["elevator"]
    assert evidence[str(unknown.id)]["band"] is None


@pytest.mark.django_db
def test_ranking_selects_a_complete_budget_eligible_pair_and_keeps_listing_count(
    api_client, catalog
):
    property_, _ = catalog(deposit=1000, rent=100)
    _, selected = catalog(property_=property_, deposit=5000, rent=10)
    catalog(property_=property_, deposit=10000, rent=0)
    prefs = {
        "monthly_rent": {"priority": "very_important", "target": 10},
        "deposit": {"priority": "preferred", "target": 1000},
    }
    response = api_client.get(
        "/api/v1/catalog/properties/",
        {
            "ordering": "preference_fit",
            "preferences": json.dumps(prefs),
            "deposit_max_toman": 5000,
        },
    )
    assert response.status_code == 200
    row = response.data["results"][0]
    assert row["listing_count"] == 3
    assert row["rental_terms"]["deposit_toman"] == 5000
    assert row["rental_terms"]["monthly_rent_toman"] == 10
    assert row["preference_assessment"]["selected_listing_id"] == str(selected.id)
    assert row["preference_assessment"]["trade_offs"] == ["deposit"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "raw",
    [
        "broken",
        "[]",
        '{"elevator":{"priority":[],"target":"present"}}',
        '{"area":{"priority":"preferred"}}',
    ],
)
def test_malformed_preferences_are_ignored_without_breaking_search(api_client, catalog, raw):
    property_, _ = catalog()
    response = api_client.get(
        "/api/v1/catalog/properties/", {"ordering": "preference_fit", "preferences": raw}
    )
    assert response.status_code == 200
    assert response.data["results"][0]["id"] == str(property_.id)
    assert response.data["ignored_preferences"]


@pytest.mark.django_db
def test_ranking_precedes_pagination_and_canonical_order_ignores_preferences(api_client, catalog):
    properties = [catalog(area=50)[0] for _ in range(26)]
    preferred, _ = catalog(area=100)
    query = {
        "ordering": "preference_fit",
        "preferences": json.dumps({"area": {"priority": "preferred", "target": 100}}),
    }
    response = api_client.get("/api/v1/catalog/properties/", query)
    assert response.status_code == 200
    ids = [row["id"] for row in response.data["results"]]
    second = api_client.get("/api/v1/catalog/properties/", {**query, "page": 2})
    ids.extend(row["id"] for row in second.data["results"])
    assert ids == [
        str(preferred.id),
        *[str(row.id) for row in sorted(properties, key=lambda row: row.id)],
    ]
    canonical = api_client.get("/api/v1/catalog/properties/", {**query, "ordering": "area_asc"})
    assert canonical.data["results"][0]["area_sqm"] == 50
    assert "preference_assessment" not in canonical.data["results"][0]


@pytest.mark.django_db
def test_preferred_locations_accept_multiple_areas(api_client, catalog):
    property_, _ = catalog()
    response = api_client.get(
        "/api/v1/catalog/properties/",
        {
            "ordering": "preference_fit",
            "preferences": json.dumps({
                "district": {
                    "priority": "preferred",
                    "target": [str(property_.district_id), "00000000-0000-0000-0000-000000000000"],
                }
            }),
        },
    )
    assert response.status_code == 200
    assert response.data["results"][0]["preference_assessment"]["satisfied"] == ["district"]


@pytest.mark.django_db
def test_ranked_search_has_bounded_queries_and_identical_list_map_evidence(api_client):
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    call_command("seed_dev", verbosity=0)
    with CaptureQueriesContext(connection) as queries:
        response = api_client.get(
            "/api/v1/catalog/properties/",
            {
                "ordering": "preference_fit",
                "preferences": json.dumps({
                    "elevator": {"priority": "preferred", "target": "present"}
                }),
                "viewport_north": "35.84",
                "viewport_south": "35.58",
                "viewport_east": "51.64",
                "viewport_west": "51.13",
                "viewport_zoom": 12,
            },
        )
    assert response.status_code == 200
    assert len(queries) <= 6
    markers = {row["id"]: row for row in response.data["map"]["markers"]}
    assert markers
    for row in response.data["results"]:
        if row["id"] in markers:
            assert row["preference_assessment"] == markers[row["id"]]["preference_assessment"]
            assert row["rental_terms"] == markers[row["id"]]["rental_terms"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "identifier,target,satisfied",
    [
        ("area", 80, True),
        ("bedroom_count", 2, True),
        ("bedroom_count", 5, False),
        ("property_type", "apartment", True),
        ("property_type", "villa", False),
        ("freshness", 1, True),
        ("construction_year", 1400, None),
        ("parking", "present", None),
        ("storage", "absent", None),
        ("balcony", "present", None),
        ("furnished", "present", None),
    ],
)
def test_supported_preferences_return_controlled_evidence(
    api_client, catalog, identifier, target, satisfied
):
    catalog()
    response = api_client.get(
        "/api/v1/catalog/properties/",
        {
            "ordering": "preference_fit",
            "preferences": json.dumps({identifier: {"priority": "preferred", "target": target}}),
        },
    )
    assert response.status_code == 200
    assessment = response.data["results"][0]["preference_assessment"]
    field = "unknown" if satisfied is None else "satisfied" if satisfied else "trade_offs"
    assert assessment[field] == [identifier]
    assert assessment["version"] == "explicit-v1"


@pytest.mark.django_db
def test_expiry_between_eligibility_and_ranking_returns_recoverable_empty_search(
    api_client, catalog, monkeypatch
):
    catalog()
    now = timezone.now()
    calls = 0

    def advancing_clock():
        nonlocal calls
        calls += 1
        return now if calls <= 2 else now + timedelta(days=21)

    monkeypatch.setattr(timezone, "now", advancing_clock)
    response = api_client.get("/api/v1/catalog/properties/", {"ordering": "preference_fit"})
    assert response.status_code == 200
    assert response.data["count"] == 0
    assert response.data["results"] == []
    assert response.data["map"]["markers"] == []


@pytest.mark.django_db
def test_missing_availability_confirmation_is_unknown_evidence(api_client, catalog):
    _, listing = catalog()
    listing.availability_confirmed_at = None
    listing.save(update_fields=["availability_confirmed_at"])
    response = api_client.get(
        "/api/v1/catalog/properties/",
        {
            "ordering": "preference_fit",
            "preferences": json.dumps({"freshness": {"priority": "preferred", "target": 7}}),
        },
    )
    assert response.status_code == 200
    assert response.data["results"][0]["preference_assessment"]["unknown"] == ["freshness"]


@pytest.mark.django_db
def test_zoomed_out_map_exposes_high_fit_counts_for_cluster_badges(api_client, catalog):
    for state in ("present", "present", "absent"):
        property_, _ = catalog(elevator=state)
        property_.approximate_latitude = "35.750000"
        property_.approximate_longitude = "51.400000"
        property_.location_radius_meters = 50
        property_.location_precision = "approximate"
        property_.save()
    response = api_client.get(
        "/api/v1/catalog/properties/",
        {
            "ordering": "preference_fit",
            "preferences": json.dumps({"elevator": {"priority": "preferred", "target": "present"}}),
        },
    )
    assert response.status_code == 200
    cluster = response.data["map"]["clusters"][0]
    assert cluster["property_count"] == 3
    assert cluster["high_fit_count"] == 2
