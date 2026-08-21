import uuid
from datetime import timedelta

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.catalog.admin import RentalTermsAdminForm
from apps.catalog.models import (
    City,
    District,
    FeatureState,
    Listing,
    ListingState,
    Neighborhood,
    Property,
    PropertyType,
    RentalTerms,
    Source,
)
from apps.catalog.services import publish_listing


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
    assert set(PropertyType.values) == {"apartment", "house", "villa"}


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
