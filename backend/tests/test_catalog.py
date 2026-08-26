import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import connection
from django.test import Client
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.admin import RentalTermsAdminForm
from apps.catalog.models import (
    PROPERTY_TYPES_BY_CATEGORY,
    City,
    District,
    FeatureState,
    Listing,
    ListingState,
    Neighborhood,
    Property,
    PropertyCategory,
    PropertyType,
    RentalTerms,
    Source,
)
from apps.catalog.services import (
    attach_listing,
    merge_properties,
    publish_listing,
    regroup_listing,
    split_listing,
)
from apps.catalog.taxonomy_codegen import render_property_taxonomy_module


def test_frontend_property_taxonomy_is_generated_from_the_catalog_mapping(tmp_path: Path):
    output = tmp_path / "property-taxonomy.ts"

    call_command("generate_property_taxonomy", output=output)

    generated = output.read_text(encoding="utf-8")
    assert generated == render_property_taxonomy_module()
    assert '"types": [\n      "apartment",\n      "house",\n      "villa"' in generated
    assert (
        '"types": [\n      "office",\n      "shop",\n      "warehouse",\n      "workshop"'
        in generated
    )


@pytest.mark.django_db
def test_public_catalog_query_count_is_bounded_for_representative_demo_fixture(
    api_client: APIClient,
):
    call_command("seed_demo", verbosity=0)

    with CaptureQueriesContext(connection) as search_queries:
        search_response = api_client.get(
            "/api/v1/catalog/properties/",
            {"property_type": "apartment", "ordering": "monthly_rent"},
        )

    property_id = search_response.data["results"][0]["id"]
    with CaptureQueriesContext(connection) as detail_queries:
        detail_response = api_client.get(f"/api/v1/catalog/properties/{property_id}/")

    assert search_response.status_code == 200
    assert detail_response.status_code == 200
    assert len(search_queries) <= 2
    assert len(detail_queries) <= 2


@pytest.mark.django_db
def test_catalog_uses_uuid_identity_and_preserves_unknown_feature_states():
    property_ = Property(property_type=PropertyType.APARTMENT, area_sqm=85, room_count=2)
    terms = RentalTerms(deposit_rial=5_000_000_000, monthly_rent_rial=200_000_000)

    assert isinstance(property_.id, uuid.UUID)
    assert isinstance(terms.id, uuid.UUID)
    assert property_.parking == FeatureState.UNKNOWN
    assert property_.elevator == FeatureState.UNKNOWN
    assert property_.storage == FeatureState.UNKNOWN
    assert property_.balcony == FeatureState.UNKNOWN
    assert property_.furnished == FeatureState.UNKNOWN
    assert set(PropertyType.values) == {
        "apartment",
        "house",
        "villa",
        "office",
        "shop",
        "warehouse",
        "workshop",
    }
    assert PROPERTY_TYPES_BY_CATEGORY == {
        PropertyCategory.RESIDENTIAL: (
            PropertyType.APARTMENT,
            PropertyType.HOUSE,
            PropertyType.VILLA,
        ),
        PropertyCategory.COMMERCIAL: (
            PropertyType.OFFICE,
            PropertyType.SHOP,
            PropertyType.WAREHOUSE,
            PropertyType.WORKSHOP,
        ),
    }


@pytest.mark.django_db
def test_rental_terms_store_irr_and_allow_only_one_zero_amount():
    deposit_only = RentalTerms(deposit_rial=7_500_000_000, monthly_rent_rial=0)
    rent_only = RentalTerms(deposit_rial=0, monthly_rent_rial=300_000_000)

    deposit_only.full_clean()
    rent_only.full_clean()
    assert deposit_only.currency == rent_only.currency == "IRR"

    with pytest.raises(ValidationError) as exc_info:
        RentalTerms(deposit_rial=0, monthly_rent_rial=0).full_clean()
    assert "هم‌زمان صفر" in exc_info.value.messages[0]


@pytest.mark.django_db
def test_reviewed_fixture_seeds_tehran_locations_and_direct_source():
    call_command("loaddata", "catalog_seed", verbosity=0)

    tehran = City.objects.get(name_fa="تهران")
    assert District.objects.filter(city=tehran).count() == 22
    assert Neighborhood.objects.filter(district__city=tehran).count() == 374
    assert tehran.provenance_url == (
        "https://data.tehran.ir/صفحه-اصلی/سرزمین-و-آب-و-هوا/تقسیمات-شهری/"
    )
    assert tehran.reviewed is True
    assert tehran.id == uuid.UUID("11111111-1111-4111-8111-111111111111")

    direct = Source.objects.get(is_builtin=True)
    assert direct.name == "ترب‌رنت"
    assert direct.domain == "torobrent.local"
    assert direct.is_active is True


@pytest.mark.django_db
def test_operator_can_publish_only_a_complete_residential_catalog_entry():
    call_command("loaddata", "catalog_seed", verbosity=0)
    source = Source.objects.get(is_builtin=True)
    incomplete_property = Property.objects.create(property_type=PropertyType.APARTMENT)
    terms = RentalTerms.objects.create(deposit_rial=5_000_000_000, monthly_rent_rial=250_000_000)
    listing = Listing.objects.create(
        source=source,
        property=incomplete_property,
        terms=terms,
        direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
    )

    with pytest.raises(ValidationError) as exc_info:
        publish_listing(listing)
    assert set(exc_info.value.message_dict) >= {
        "city",
        "district",
        "neighborhood",
        "area_sqm",
        "room_count",
    }

    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    property_ = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=110,
        room_count=2,
    )
    listing.property = property_
    before_publication = timezone.now()

    neighborhood.reviewed = False
    neighborhood.save(update_fields=["reviewed"])
    with pytest.raises(ValidationError, match="بازبینی"):
        publish_listing(listing)
    neighborhood.reviewed = True
    neighborhood.save(update_fields=["reviewed"])

    publish_listing(listing)
    listing.refresh_from_db()

    assert listing.state == ListingState.PUBLISHED
    assert listing.published_at is not None
    assert listing.availability_confirmed_at is not None
    assert listing.available_until is not None
    assert listing.available_until >= before_publication + timedelta(days=30)
    assert Listing.objects.active().filter(pk=listing.pk).exists()


@pytest.mark.django_db
def test_operator_enters_rental_terms_in_persian_toman_through_admin():
    form = RentalTermsAdminForm(
        data={
            "deposit_toman": "۵۰۰٬۰۰۰٬۰۰۰",
            "monthly_rent_toman": "۲۵,۰۰۰,۰۰۰",
        }
    )

    assert form.is_valid(), form.errors
    terms = form.save()
    assert terms.deposit_rial == 5_000_000_000
    assert terms.monthly_rent_rial == 250_000_000
    assert admin.site.is_registered(Property)
    assert admin.site.is_registered(Listing)
    assert admin.site.is_registered(Source)


@pytest.mark.django_db
def test_anonymous_renter_retrieves_property_only_through_an_active_listing(
    api_client: APIClient,
):
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    property_ = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=110,
        room_count=2,
        parking=FeatureState.PRESENT,
    )
    terms = RentalTerms.objects.create(
        deposit_rial=10_000_000_000,
        monthly_rent_rial=250_000_000,
    )
    listing = Listing.objects.create(
        property=property_,
        source=Source.objects.get(is_builtin=True),
        terms=terms,
        direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
        description="آپارتمان روشن و آرام",
    )
    publish_listing(listing)

    response = api_client.get(f"/api/v1/catalog/properties/{property_.id}/")

    assert response.status_code == 200
    assert response.data["id"] == str(property_.id)
    assert response.data["title"] == "آپارتمان در سعادت‌آباد"
    assert response.data["canonical_slug"] == "آپارتمان-در-سعادتآباد"
    assert response.data["location"] == {
        "city": "تهران",
        "district": "منطقه ۲",
        "district_number": 2,
        "neighborhood": "سعادت‌آباد",
    }
    assert response.data["features"]["parking"] == FeatureState.PRESENT
    assert response.data["features"]["elevator"] == FeatureState.UNKNOWN
    assert response.data["listings"][0]["rental_terms"] == {
        "deposit_rial": 10_000_000_000,
        "monthly_rent_rial": 250_000_000,
        "currency": "IRR",
        "deposit_toman": 1_000_000_000,
        "monthly_rent_toman": 25_000_000,
    }
    assert "direct_phone" not in response.data["listings"][0]

    listing.available_until = timezone.now() - timedelta(seconds=1)
    listing.save(update_fields=["available_until"])
    assert api_client.get(f"/api/v1/catalog/properties/{property_.id}/").status_code == 404


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("property_type", "property_type_label", "description"),
    [
        ("office", "دفتر اداری", "دفتر اداری مناسب شرکت"),
        ("shop", "مغازه", "مغازه مناسب خرده‌فروشی"),
        ("warehouse", "انبار", "انبار مناسب نگهداری کالا"),
        ("workshop", "کارگاه", "کارگاه مناسب تولید"),
    ],
)
def test_renter_can_find_and_open_each_published_commercial_type_without_a_room_count(
    api_client: APIClient,
    property_type: str,
    property_type_label: str,
    description: str,
):
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    commercial_property = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=property_type,
        area_sqm=95,
    )
    listing = Listing.objects.create(
        property=commercial_property,
        source=Source.objects.get(is_builtin=True),
        terms=RentalTerms.objects.create(
            deposit_rial=8_000_000_000,
            monthly_rent_rial=300_000_000,
        ),
        direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
        description=description,
    )

    publish_listing(listing)
    search = api_client.get("/api/v1/catalog/properties/", {"property_type": property_type})
    detail = api_client.get(f"/api/v1/catalog/properties/{commercial_property.id}/")

    assert search.status_code == 200
    assert search.data["count"] == 1
    assert search.data["results"][0] == {
        "id": str(commercial_property.id),
        "title": f"{property_type_label} در سعادت‌آباد",
        "canonical_slug": f"{property_type_label.replace(' ', '-')}-در-سعادتآباد",
        "location": {
            "city": "تهران",
            "district": "منطقه ۲",
            "district_number": 2,
            "neighborhood": "سعادت‌آباد",
        },
        "property_category": "commercial",
        "property_category_label": "تجاری",
        "property_type": property_type,
        "property_type_label": property_type_label,
        "area_sqm": 95,
        "construction_year": None,
        "listing_count": 1,
        "rental_terms": {
            "deposit_rial": 8_000_000_000,
            "monthly_rent_rial": 300_000_000,
            "currency": "IRR",
            "deposit_toman": 800_000_000,
            "monthly_rent_toman": 30_000_000,
        },
        "availability_confirmed_at": search.data["results"][0]["availability_confirmed_at"],
    }
    assert detail.status_code == 200
    assert detail.data["property_category"] == "commercial"
    assert detail.data["property_category_label"] == "تجاری"
    assert detail.data["property_type"] == property_type
    assert detail.data["property_type_label"] == property_type_label
    assert "room_count" not in search.data["results"][0]
    assert "room_count" not in detail.data


@pytest.mark.django_db
def test_public_catalog_rejects_an_unknown_property_type(api_client: APIClient):
    response = api_client.get("/api/v1/catalog/properties/", {"property_type": "shopping_center"})

    assert response.status_code == 400


@pytest.mark.django_db
def test_anonymous_renter_autocompletes_tehran_locations_with_tolerant_persian_input(
    api_client: APIClient,
):
    call_command("loaddata", "catalog_seed", verbosity=0)
    other_city = City.objects.create(
        name_fa="تهرانک",
        source_code="outside-tehran",
        source_year=1403,
        provenance_url="https://example.com/locations",
        imported_at=timezone.localdate(),
        reviewed=True,
    )

    response = api_client.get("/api/v1/catalog/locations/", {"q": "سعادت اباد"})

    assert response.status_code == 200
    assert response.data == [
        {
            "id": str(Neighborhood.objects.get(name_fa="سعادت‌آباد").id),
            "kind": "neighborhood",
            "name": "سعادت‌آباد",
            "label": "سعادت‌آباد، منطقه ۲، تهران",
        }
    ]

    city_response = api_client.get("/api/v1/catalog/locations/", {"q": "تهران"})
    district_response = api_client.get("/api/v1/catalog/locations/", {"q": "منطقه ۲"})
    assert city_response.data[0]["kind"] == "city"
    assert city_response.data[0]["name"] == "تهران"
    assert district_response.data[0]["kind"] == "district"
    assert district_response.data[0]["name"] == "منطقه ۲"
    assert all(item["id"] != str(other_city.id) for item in city_response.data)


@pytest.mark.django_db
def test_property_search_groups_active_listings_and_uses_the_freshest_terms(
    api_client: APIClient,
):
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    source = Source.objects.get(is_builtin=True)
    property_ = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=110,
        room_count=2,
        construction_year=1400,
    )
    now = timezone.now()
    older_terms = RentalTerms.objects.create(
        deposit_rial=8_000_000_000,
        monthly_rent_rial=300_000_000,
    )
    Listing.objects.create(
        property=property_,
        source=source,
        terms=older_terms,
        state=ListingState.PUBLISHED,
        direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
        availability_confirmed_at=now - timedelta(days=2),
        available_until=now + timedelta(days=20),
    )
    fresh_terms = RentalTerms.objects.create(
        deposit_rial=10_000_000_000,
        monthly_rent_rial=250_000_000,
    )
    Listing.objects.create(
        property=property_,
        source=source,
        terms=fresh_terms,
        state=ListingState.PUBLISHED,
        direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
        availability_confirmed_at=now - timedelta(hours=1),
        available_until=now + timedelta(days=29),
    )

    expired_property = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.HOUSE,
        area_sqm=160,
        room_count=3,
    )
    Listing.objects.create(
        property=expired_property,
        source=source,
        terms=RentalTerms.objects.create(
            deposit_rial=12_000_000_000,
            monthly_rent_rial=200_000_000,
        ),
        state=ListingState.PUBLISHED,
        direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
        availability_confirmed_at=now - timedelta(days=1),
        available_until=now - timedelta(seconds=1),
    )

    response = api_client.get("/api/v1/catalog/properties/", {"location": neighborhood.id})

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["next"] is None
    assert response.data["previous"] is None
    assert response.data["results"] == [
        {
            "id": str(property_.id),
            "title": "آپارتمان در سعادت‌آباد",
            "canonical_slug": "آپارتمان-در-سعادتآباد",
            "location": {
                "city": "تهران",
                "district": "منطقه ۲",
                "district_number": 2,
                "neighborhood": "سعادت‌آباد",
            },
            "property_category": "residential",
            "property_category_label": "مسکونی",
            "property_type": "apartment",
            "property_type_label": "آپارتمان",
            "area_sqm": 110,
            "room_count": 2,
            "construction_year": 1400,
            "listing_count": 2,
            "rental_terms": {
                "deposit_rial": 10_000_000_000,
                "monthly_rent_rial": 250_000_000,
                "currency": "IRR",
                "deposit_toman": 1_000_000_000,
                "monthly_rent_toman": 25_000_000,
            },
            "availability_confirmed_at": (
                fresh_terms.listing.availability_confirmed_at.isoformat().replace("+00:00", "Z")
            ),
        }
    ]


@pytest.mark.django_db
def test_property_search_excludes_every_non_active_listing_state(api_client: APIClient):
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="یوسف آباد- امیرآباد")
    active_source = Source.objects.get(is_builtin=True)
    inactive_source = Source.objects.create(
        name="inactive",
        domain="inactive.example",
        display_name="منبع غیرفعال",
        is_active=False,
        outbound_policy="external_link",
    )
    now = timezone.now()
    scenarios = [
        (ListingState.DRAFT, now + timedelta(days=1), active_source),
        (ListingState.PENDING, now + timedelta(days=1), active_source),
        (ListingState.REJECTED, now + timedelta(days=1), active_source),
        (ListingState.UNAVAILABLE, now + timedelta(days=1), active_source),
        (ListingState.ARCHIVED, now + timedelta(days=1), active_source),
        (ListingState.PUBLISHED, now - timedelta(seconds=1), active_source),
        (ListingState.PUBLISHED, now + timedelta(days=1), inactive_source),
    ]
    for index, (state, available_until, source) in enumerate(scenarios, start=1):
        property_ = Property.objects.create(
            city=neighborhood.district.city,
            district=neighborhood.district,
            neighborhood=neighborhood,
            property_type=PropertyType.APARTMENT,
            area_sqm=80 + index,
            room_count=1,
        )
        Listing.objects.create(
            property=property_,
            source=source,
            terms=RentalTerms.objects.create(
                deposit_rial=index * 1_000_000_000,
                monthly_rent_rial=100_000_000,
            ),
            state=state,
            external_url="https://inactive.example/listing",
            direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
            availability_confirmed_at=now,
            available_until=available_until,
        )

    response = api_client.get("/api/v1/catalog/properties/", {"location": "يوسف اباد"})

    assert response.status_code == 200
    assert response.data["count"] == 0
    assert response.data["results"] == []


@pytest.mark.django_db
def test_property_search_excludes_active_properties_outside_tehran(api_client: APIClient):
    call_command("loaddata", "catalog_seed", verbosity=0)
    location_fields = {
        "source_year": 1403,
        "provenance_url": "https://example.com/locations",
        "imported_at": timezone.localdate(),
        "reviewed": True,
    }
    city = City.objects.create(name_fa="کرج", source_code="karaj", **location_fields)
    district = District.objects.create(
        city=city,
        number=1,
        name_fa="منطقه ۱",
        source_code="karaj-1",
        **location_fields,
    )
    neighborhood = Neighborhood.objects.create(
        district=district,
        name_fa="جهانشهر",
        source_code="jahanshahr",
        **location_fields,
    )
    property_ = Property.objects.create(
        city=city,
        district=district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=90,
        room_count=2,
    )
    now = timezone.now()
    Listing.objects.create(
        property=property_,
        source=Source.objects.get(is_builtin=True),
        terms=RentalTerms.objects.create(
            deposit_rial=5_000_000_000,
            monthly_rent_rial=200_000_000,
        ),
        state=ListingState.PUBLISHED,
        direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
        availability_confirmed_at=now,
        available_until=now + timedelta(days=1),
    )

    response = api_client.get("/api/v1/catalog/properties/", {"location": str(neighborhood.id)})

    assert response.status_code == 200
    assert response.data["count"] == 0
    assert response.data["results"] == []


@pytest.mark.django_db
def test_property_search_orders_deterministically_and_limits_the_first_page_to_25(
    api_client: APIClient,
):
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="تهران‌پارس غربی")
    source = Source.objects.get(is_builtin=True)
    confirmed_at = timezone.now() - timedelta(hours=1)
    properties = []
    for index in range(26):
        property_ = Property.objects.create(
            city=neighborhood.district.city,
            district=neighborhood.district,
            neighborhood=neighborhood,
            property_type=PropertyType.APARTMENT,
            area_sqm=60 + index,
            room_count=1,
        )
        properties.append(property_)
        Listing.objects.create(
            property=property_,
            source=source,
            terms=RentalTerms.objects.create(
                deposit_rial=(index + 1) * 1_000_000_000,
                monthly_rent_rial=100_000_000,
            ),
            state=ListingState.PUBLISHED,
            direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
            availability_confirmed_at=confirmed_at,
            available_until=confirmed_at + timedelta(days=20),
        )

    response = api_client.get("/api/v1/catalog/properties/", {"page_size": 100})

    assert response.status_code == 200
    assert response.data["count"] == 26
    assert len(response.data["results"]) == 25
    assert "page=2" in response.data["next"]
    expected_ids = [str(property_.id) for property_ in sorted(properties, key=lambda item: item.id)]
    assert [result["id"] for result in response.data["results"]] == expected_ids[:25]

    second_page = api_client.get("/api/v1/catalog/properties/", {"page": 2})
    paginated_ids = [result["id"] for result in response.data["results"]]
    paginated_ids.extend(result["id"] for result in second_page.data["results"])
    assert paginated_ids == expected_ids


@pytest.mark.django_db
def test_property_search_requires_one_active_listing_to_match_all_rental_ranges(
    api_client: APIClient,
):
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    source = Source.objects.get(is_builtin=True)
    now = timezone.now()
    property_ = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=100,
        room_count=2,
    )
    for deposit_rial, monthly_rent_rial in (
        (5_000_000_000, 500_000_000),
        (10_000_000_000, 200_000_000),
    ):
        Listing.objects.create(
            property=property_,
            source=source,
            terms=RentalTerms.objects.create(
                deposit_rial=deposit_rial,
                monthly_rent_rial=monthly_rent_rial,
            ),
            state=ListingState.PUBLISHED,
            direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
            availability_confirmed_at=now,
            available_until=now + timedelta(days=1),
        )

    mismatched_pair = api_client.get(
        "/api/v1/catalog/properties/",
        {"deposit_max_toman": "۵۰۰٬۰۰۰٬۰۰۰", "monthly_rent_max_toman": "۲۰٬۰۰۰٬۰۰۰"},
    )
    boundary_pair = api_client.get(
        "/api/v1/catalog/properties/",
        {"deposit_min_toman": "۱,۰۰۰,۰۰۰,۰۰۰", "monthly_rent_max_toman": "20000000"},
    )

    assert mismatched_pair.status_code == 200
    assert mismatched_pair.data["count"] == 0
    assert boundary_pair.status_code == 200
    assert boundary_pair.data["count"] == 1
    assert boundary_pair.data["results"][0]["rental_terms"]["deposit_toman"] == 1_000_000_000
    assert boundary_pair.data["results"][0]["rental_terms"]["monthly_rent_toman"] == 20_000_000


@pytest.mark.django_db
def test_property_search_filters_normalized_facts_and_explicit_feature_states(
    api_client: APIClient,
):
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    source = Source.objects.get(is_builtin=True)
    now = timezone.now()
    for index, parking in enumerate(
        (FeatureState.PRESENT, FeatureState.ABSENT, FeatureState.UNKNOWN), start=1
    ):
        property_ = Property.objects.create(
            city=neighborhood.district.city,
            district=neighborhood.district,
            neighborhood=neighborhood,
            property_type=PropertyType.APARTMENT if index == 1 else PropertyType.HOUSE,
            area_sqm=89 + index,
            room_count=index,
            parking=parking,
        )
        Listing.objects.create(
            property=property_,
            source=source,
            terms=RentalTerms.objects.create(
                deposit_rial=5_000_000_000,
                monthly_rent_rial=200_000_000,
            ),
            state=ListingState.PUBLISHED,
            direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
            availability_confirmed_at=now,
            available_until=now + timedelta(days=1),
        )

    present = api_client.get(
        "/api/v1/catalog/properties/",
        {
            "area_min": "۹۰",
            "area_max": "90",
            "room_count": "۱",
            "property_type": "apartment",
            "parking": "present",
        },
    )
    absent = api_client.get("/api/v1/catalog/properties/", {"parking": "absent"})

    assert present.status_code == 200
    assert present.data["count"] == 1
    assert present.data["results"][0]["area_sqm"] == 90
    assert absent.status_code == 200
    assert absent.data["count"] == 1


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("ordering", "expected_areas"),
    [
        ("freshness", [80, 90, 100]),
        ("monthly_rent", [90, 100, 80]),
        ("deposit", [100, 80, 90]),
        ("area", [80, 90, 100]),
    ],
)
def test_property_search_sort_options_have_deterministic_ties(
    api_client: APIClient, ordering: str, expected_areas: list[int]
):
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    source = Source.objects.get(is_builtin=True)
    now = timezone.now()
    scenarios = [
        (80, 700_000_000, 30_000_000, now),
        (90, 900_000_000, 10_000_000, now - timedelta(hours=1)),
        (100, 500_000_000, 20_000_000, now - timedelta(hours=2)),
    ]
    for area, deposit_toman, monthly_rent_toman, confirmed_at in scenarios:
        property_ = Property.objects.create(
            city=neighborhood.district.city,
            district=neighborhood.district,
            neighborhood=neighborhood,
            property_type=PropertyType.APARTMENT,
            area_sqm=area,
            room_count=2,
        )
        Listing.objects.create(
            property=property_,
            source=source,
            terms=RentalTerms.objects.create(
                deposit_rial=deposit_toman * 10,
                monthly_rent_rial=monthly_rent_toman * 10,
            ),
            state=ListingState.PUBLISHED,
            direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
            availability_confirmed_at=confirmed_at,
            available_until=now + timedelta(days=1),
        )

    response = api_client.get("/api/v1/catalog/properties/", {"ordering": ordering})

    assert response.status_code == 200
    assert [item["area_sqm"] for item in response.data["results"]] == expected_areas


@pytest.mark.django_db
def test_operator_merges_duplicate_properties_without_losing_listing_identity_or_claims():
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    source = Source.objects.create(
        name="example-source",
        domain="source.example",
        display_name="منبع نمونه",
        outbound_policy="external_link",
    )
    target = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=110,
        room_count=2,
    )
    duplicate = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=108,
        room_count=2,
    )
    terms = RentalTerms.objects.create(
        deposit_rial=10_000_000_000,
        monthly_rent_rial=250_000_000,
    )
    confirmed_at = timezone.now() - timedelta(hours=2)
    listing = Listing.objects.create(
        property=duplicate,
        source=source,
        terms=terms,
        state=ListingState.PUBLISHED,
        description="توصیف اصلی منبع",
        source_reference="source-42",
        source_claims={"area_sqm": 108, "room_count": 2},
        external_url="https://source.example/listings/42",
        availability_confirmed_at=confirmed_at,
        available_until=timezone.now() + timedelta(days=5),
    )

    merge_properties(target=target, duplicate=duplicate)

    listing.refresh_from_db()
    duplicate.refresh_from_db()
    assert listing.id == terms.listing.id
    assert listing.property_id == target.id
    assert listing.terms_id == terms.id
    assert listing.description == "توصیف اصلی منبع"
    assert listing.source_reference == "source-42"
    assert listing.source_claims == {"area_sqm": 108, "room_count": 2}
    assert listing.external_url == "https://source.example/listings/42"
    assert listing.availability_confirmed_at == confirmed_at
    assert duplicate.merged_into_id == target.id
    assert duplicate.area_sqm == 108
    assert target.area_sqm == 110
    event = listing.grouping_events.get()
    assert event.action == "merge"
    assert event.from_property_id == duplicate.id
    assert event.to_property_id == target.id

    split_listing(listing=listing, separate_property=duplicate, reason="بازگردانی ادغام")

    listing.refresh_from_db()
    duplicate.refresh_from_db()
    assert listing.property_id == duplicate.id
    assert duplicate.merged_into_id is None
    assert duplicate.merged_at is None
    assert list(listing.grouping_events.values_list("action", flat=True)) == ["merge", "split"]


@pytest.mark.django_db
def test_operator_splits_an_incorrectly_grouped_listing_to_a_separate_property():
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    source = Source.objects.get(is_builtin=True)
    grouped_property = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=110,
        room_count=2,
    )
    separate_property = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=90,
        room_count=1,
    )
    listing = Listing.objects.create(
        property=grouped_property,
        source=source,
        terms=RentalTerms.objects.create(
            deposit_rial=5_000_000_000,
            monthly_rent_rial=300_000_000,
        ),
        source_claims={"area_sqm": 90, "room_count": 1},
        direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
    )
    listing_id = listing.id

    split_listing(listing=listing, separate_property=separate_property, reason="واحد متفاوت")

    listing.refresh_from_db()
    assert listing.id == listing_id
    assert listing.property_id == separate_property.id
    event = listing.grouping_events.get()
    assert event.action == "split"
    assert event.reason == "واحد متفاوت"
    assert event.from_property_id == grouped_property.id
    assert event.to_property_id == separate_property.id


@pytest.mark.django_db
def test_operator_attaches_a_listing_to_an_existing_property_group():
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    source = Source.objects.get(is_builtin=True)
    properties = [
        Property.objects.create(
            city=neighborhood.district.city,
            district=neighborhood.district,
            neighborhood=neighborhood,
            property_type=PropertyType.APARTMENT,
            area_sqm=100 + index,
            room_count=2,
        )
        for index in range(2)
    ]
    listings = [
        Listing.objects.create(
            property=property_,
            source=source,
            terms=RentalTerms.objects.create(
                deposit_rial=(index + 1) * 5_000_000_000,
                monthly_rent_rial=200_000_000,
            ),
            direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
        )
        for index, property_ in enumerate(properties)
    ]

    attach_listing(listing=listings[1], existing_property=properties[0])

    listings[1].refresh_from_db()
    assert listings[1].property_id == properties[0].id
    assert Listing.objects.filter(property=properties[0]).count() == 2
    assert listings[1].grouping_events.get().action == "attach"


@pytest.mark.django_db
def test_regroup_listing_chooses_attach_or_split_inside_the_catalog_workflow():
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    source = Source.objects.get(is_builtin=True)
    properties = [
        Property.objects.create(
            city=neighborhood.district.city,
            district=neighborhood.district,
            neighborhood=neighborhood,
            property_type=PropertyType.APARTMENT,
            area_sqm=100 + index,
            room_count=2,
        )
        for index in range(3)
    ]
    listings = [
        Listing.objects.create(
            property=property_,
            source=source,
            terms=RentalTerms.objects.create(
                deposit_rial=(index + 1) * 5_000_000_000,
                monthly_rent_rial=200_000_000,
            ),
            direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
        )
        for index, property_ in enumerate(properties[:2])
    ]

    regroup_listing(listing=listings[1], destination=properties[0])
    regroup_listing(listing=listings[1], destination=properties[2])

    listings[1].refresh_from_db()
    assert listings[1].property_id == properties[2].id
    assert list(listings[1].grouping_events.values_list("action", flat=True)) == [
        "attach",
        "split",
    ]


@pytest.mark.django_db
def test_operator_regroups_a_listing_through_the_admin_change_form():
    call_command("loaddata", "catalog_seed", verbosity=0)
    operator = User.objects.create_superuser(
        email="operator-grouping@example.com", password="operator-password"
    )
    client = Client()
    client.force_login(operator)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    source = Source.objects.get(is_builtin=True)
    original, destination = [
        Property.objects.create(
            city=neighborhood.district.city,
            district=neighborhood.district,
            neighborhood=neighborhood,
            property_type=PropertyType.APARTMENT,
            area_sqm=100 + index,
            room_count=2,
        )
        for index in range(2)
    ]
    Listing.objects.create(
        property=destination,
        source=source,
        terms=RentalTerms.objects.create(
            deposit_rial=7_000_000_000,
            monthly_rent_rial=200_000_000,
        ),
        direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
    )
    listing = Listing.objects.create(
        property=original,
        source=source,
        terms=RentalTerms.objects.create(
            deposit_rial=5_000_000_000,
            monthly_rent_rial=250_000_000,
        ),
        source_claims={"area_sqm": 101},
        direct_phone="۰۹۱۲۱۲۳۴۵۶۷",
    )

    response = client.post(
        f"/admin/catalog/listing/{listing.id}/change/",
        {
            "property": str(destination.id),
            "source": str(source.id),
            "terms": str(listing.terms_id),
            "state": ListingState.DRAFT,
            "description": "",
            "source_reference": "",
            "source_claims": '{"area_sqm": 101}',
            "provenance_note": "",
            "external_url": "",
            "direct_phone": "۰۹۱۲۱۲۳۴۵۶۷",
            "_save": "Save",
        },
    )

    assert response.status_code == 302
    listing.refresh_from_db()
    assert listing.property_id == destination.id
    assert listing.grouping_events.get().action == "attach"


@pytest.mark.django_db
def test_operator_merges_selected_properties_through_the_admin_action():
    call_command("loaddata", "catalog_seed", verbosity=0)
    operator = User.objects.create_superuser(
        email="operator-merge@example.com", password="operator-password"
    )
    client = Client()
    client.force_login(operator)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    target, duplicate = [
        Property.objects.create(
            city=neighborhood.district.city,
            district=neighborhood.district,
            neighborhood=neighborhood,
            property_type=PropertyType.APARTMENT,
            area_sqm=110,
            room_count=2,
        )
        for _ in range(2)
    ]

    response = client.post(
        "/admin/catalog/property/",
        {
            "action": "merge_into_target",
            "target_property": str(target.id),
            "_selected_action": [str(duplicate.id)],
            "index": "0",
        },
        follow=True,
    )

    assert response.status_code == 200
    duplicate.refresh_from_db()
    assert duplicate.merged_into_id == target.id
    assert "یک ملک تکراری ادغام شد" in response.content.decode()


@pytest.mark.django_db
def test_property_detail_compares_active_source_listings_and_exposes_disagreements_safely(
    api_client: APIClient,
):
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    property_ = Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=110,
        room_count=2,
        parking=FeatureState.PRESENT,
    )
    external_source = Source.objects.create(
        name="external-comparison",
        domain="comparison.example",
        display_name="منبع مقایسه",
        outbound_policy="external_link",
        allows_external_media=True,
    )
    disabled_source = Source.objects.create(
        name="disabled-comparison",
        domain="disabled-comparison.example",
        display_name="منبع بدون ادامه",
        outbound_policy="disabled",
    )
    inactive_source = Source.objects.create(
        name="inactive-comparison",
        domain="inactive-comparison.example",
        display_name="منبع غیرفعال",
        outbound_policy="external_link",
        is_active=False,
    )
    now = timezone.now()
    scenarios = [
        (
            external_source,
            {
                "area_sqm": 108,
                "room_count": 2,
                "parking": "absent",
                "elevator": "present",
            },
            "external-42",
            "https://comparison.example/listings/42",
        ),
        (
            disabled_source,
            {"area_sqm": 110, "room_count": 2, "parking": "present"},
            "disabled-10",
            "https://disabled-comparison.example/listings/10",
        ),
        (
            inactive_source,
            {"area_sqm": 130},
            "inactive-1",
            "https://inactive-comparison.example/listings/1",
        ),
    ]
    for index, (source, claims, reference, external_url) in enumerate(scenarios, start=1):
        Listing.objects.create(
            property=property_,
            source=source,
            terms=RentalTerms.objects.create(
                deposit_rial=index * 5_000_000_000,
                monthly_rent_rial=index * 100_000_000,
            ),
            state=ListingState.PUBLISHED,
            description=f"توضیح منبع {index}",
            source_reference=reference,
            source_claims=claims,
            external_url=external_url,
            external_media_url=f"https://{source.domain}/media/{reference}.jpg",
            availability_confirmed_at=now - timedelta(hours=index),
            available_until=now + timedelta(days=5),
        )

    response = api_client.get(f"/api/v1/catalog/properties/{property_.id}/")
    search_response = api_client.get("/api/v1/catalog/properties/")

    assert response.status_code == 200
    assert search_response.status_code == 200
    assert search_response.data["results"][0]["listing_count"] == 2
    assert search_response.data["results"][0]["rental_terms"] == {
        "deposit_rial": 5_000_000_000,
        "monthly_rent_rial": 100_000_000,
        "currency": "IRR",
        "deposit_toman": 500_000_000,
        "monthly_rent_toman": 10_000_000,
    }
    assert len(response.data["listings"]) == 2
    listings_by_source = {
        listing["source"]["name"]: listing for listing in response.data["listings"]
    }
    external = listings_by_source["external-comparison"]
    assert external["source_reference"] == "external-42"
    assert external["description"] == "توضیح منبع 1"
    assert external["rental_terms"]["deposit_rial"] == 5_000_000_000
    assert external["availability_confirmed_at"] == (
        (now - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    )
    assert external["source_claims"] == {
        "area_sqm": 108,
        "room_count": 2,
        "parking": "absent",
        "elevator": "present",
    }
    assert external["continuation_url"] == "https://comparison.example/listings/42"
    assert external["media_url"] == "https://comparison.example/media/external-42.jpg"
    assert external["disagreements"] == [
        {"field": "area_sqm", "normalized_value": 110, "source_value": 108},
        {"field": "parking", "normalized_value": "present", "source_value": "absent"},
        {"field": "elevator", "normalized_value": "unknown", "source_value": "present"},
    ]
    disabled = listings_by_source["disabled-comparison"]
    assert disabled["continuation_url"] is None
    assert disabled["media_url"] is None
    assert disabled["disagreements"] == []
    assert "inactive-comparison" not in listings_by_source
