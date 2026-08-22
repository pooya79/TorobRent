import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import City, District, Neighborhood


@pytest.mark.django_db
def test_verified_submitter_can_create_an_owner_draft(api_client: APIClient):
    submitter = User.objects.create_user(
        email="owner@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    api_client.force_authenticate(submitter)

    response = api_client.post(
        "/api/v1/submissions/",
        {"role": "owner"},
        format="json",
    )

    assert response.status_code == 201
    assert response.data["role"] == "owner"
    assert response.data["state"] == "draft"
    assert response.data["current_step"] == "location"
    assert response.data["media_complete"] is False


@pytest.mark.django_db
def test_submitter_can_save_and_resume_every_non_media_step(api_client: APIClient):
    submitter = User.objects.create_user(
        email="agent@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    city = City.objects.create(
        name_fa="تهران",
        source_code="test-city",
        source_year=1403,
        provenance_url="https://example.com/city",
        imported_at=timezone.localdate(),
        reviewed=True,
    )
    district = District.objects.create(
        city=city,
        number=2,
        name_fa="منطقه ۲",
        source_code="test-district",
        source_year=1403,
        provenance_url="https://example.com/district",
        imported_at=timezone.localdate(),
        reviewed=True,
    )
    neighborhood = Neighborhood.objects.create(
        district=district,
        name_fa="سعادت‌آباد",
        source_code="test-neighborhood",
        source_year=1403,
        provenance_url="https://example.com/neighborhood",
        imported_at=timezone.localdate(),
        reviewed=True,
    )
    api_client.force_authenticate(submitter)
    created = api_client.post("/api/v1/submissions/", {"role": "agent"}, format="json")
    detail_url = f"/api/v1/submissions/{created.data['id']}/"

    steps = [
        {
            "completed_step": "location",
            "location": {
                "city_id": str(city.id),
                "district_id": str(district.id),
                "neighborhood_id": str(neighborhood.id),
                "address": "بلوار دریا، کوچه سرو",
            },
        },
        {
            "completed_step": "property_facts",
            "property_facts": {
                "property_type": "apartment",
                "area_sqm": "۱۱۰",
                "room_count": "۲",
                "construction_year": "۱۴۰۰",
                "floor": "۳",
                "total_floors": "۶",
                "units_per_floor": "۲",
            },
        },
        {
            "completed_step": "rental_terms",
            "rental_terms": {
                "deposit_toman": "۱٬۰۰۰٬۰۰۰٬۰۰۰",
                "monthly_rent_toman": "۲۵٬۰۰۰٬۰۰۰",
                "is_negotiable": True,
                "is_convertible": False,
            },
        },
        {
            "completed_step": "features_description",
            "features": {
                "parking": "present",
                "elevator": "absent",
                "storage": "unknown",
                "balcony": "present",
                "furnished": "unknown",
            },
            "description": "نورگیر و آرام",
        },
        {
            "completed_step": "contact",
            "contact": {
                "name": "سارا احمدی",
                "phone": "۰۹۱۲۱۲۳۴۵۶۷",
                "authorization_declared": True,
                "phone_publication_consent": False,
            },
        },
        {
            "completed_step": "review",
            "review": {"accuracy_confirmed": True},
        },
    ]
    for payload in steps:
        response = api_client.patch(detail_url, payload, format="json")
        assert response.status_code == 200, response.data

    resumed = api_client.get(detail_url)

    assert resumed.status_code == 200
    assert resumed.data["current_step"] == "review"
    assert resumed.data["location"]["neighborhood"] == "سعادت‌آباد"
    assert resumed.data["property_facts"]["area_sqm"] == 110
    assert resumed.data["rental_terms"] == {
        "deposit_rial": 10_000_000_000,
        "monthly_rent_rial": 250_000_000,
        "currency": "IRR",
        "deposit_toman": 1_000_000_000,
        "monthly_rent_toman": 25_000_000,
        "is_negotiable": True,
        "is_convertible": False,
    }
    assert resumed.data["features"] == {
        "parking": "present",
        "elevator": "absent",
        "storage": "unknown",
        "balcony": "present",
        "furnished": "unknown",
    }
    assert resumed.data["contact"]["phone_publication_consent"] is False
    assert resumed.data["review"] == {"accuracy_confirmed": True}
    assert resumed.data["state"] == "draft"
    assert resumed.data["media_complete"] is False

    edited_location = api_client.patch(detail_url, steps[0], format="json")
    assert edited_location.status_code == 200
    assert edited_location.data["current_step"] == "review"


@pytest.mark.django_db
def test_unverified_or_different_submitter_cannot_mutate_a_draft(api_client: APIClient):
    unverified = User.objects.create_user(
        email="unverified@example.com", password="correct-horse-battery"
    )
    api_client.force_authenticate(unverified)
    denied = api_client.post("/api/v1/submissions/", {"role": "owner"}, format="json")
    assert denied.status_code == 403

    owner = User.objects.create_user(
        email="draft-owner@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    api_client.force_authenticate(owner)
    created = api_client.post("/api/v1/submissions/", {"role": "owner"}, format="json")

    other_submitter = User.objects.create_user(
        email="other@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    api_client.force_authenticate(other_submitter)
    detail_url = f"/api/v1/submissions/{created.data['id']}/"
    assert api_client.get(detail_url).status_code == 404
    assert (
        api_client.patch(
            detail_url,
            {
                "completed_step": "rental_terms",
                "rental_terms": {
                    "deposit_toman": 1,
                    "monthly_rent_toman": 0,
                    "is_negotiable": False,
                    "is_convertible": False,
                },
            },
            format="json",
        ).status_code
        == 404
    )


@pytest.mark.django_db
def test_invalid_rental_terms_preserve_the_last_valid_toman_values(api_client: APIClient):
    submitter = User.objects.create_user(
        email="terms@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    api_client.force_authenticate(submitter)
    created = api_client.post("/api/v1/submissions/", {"role": "owner"}, format="json")
    detail_url = f"/api/v1/submissions/{created.data['id']}/"
    valid_terms = {
        "completed_step": "rental_terms",
        "rental_terms": {
            "deposit_toman": "۵۰۰٬۰۰۰٬۰۰۰",
            "monthly_rent_toman": "۰",
            "is_negotiable": False,
            "is_convertible": True,
        },
    }
    assert api_client.patch(detail_url, valid_terms, format="json").status_code == 200

    invalid = api_client.patch(
        detail_url,
        {
            **valid_terms,
            "rental_terms": {
                **valid_terms["rental_terms"],
                "deposit_toman": "۰",
            },
        },
        format="json",
    )

    assert invalid.status_code == 400
    assert invalid.data["detail"] == "ودیعه و اجاره ماهانه نمی‌توانند هم‌زمان صفر باشند."
    assert invalid.data["errors"]["rental_terms.non_field_errors"][0]["message"] == (
        "ودیعه و اجاره ماهانه نمی‌توانند هم‌زمان صفر باشند."
    )
    resumed = api_client.get(detail_url)
    assert resumed.data["rental_terms"]["deposit_toman"] == 500_000_000
    assert resumed.data["rental_terms"]["monthly_rent_toman"] == 0

    unsafe_rial = api_client.patch(
        detail_url,
        {
            **valid_terms,
            "rental_terms": {
                **valid_terms["rental_terms"],
                "deposit_toman": 900_719_925_474_100,
            },
        },
        format="json",
    )
    assert unsafe_rial.status_code == 400
    assert unsafe_rial.data["errors"]["rental_terms.deposit_toman"][0]["message"] == (
        "مبلغ واردشده بیش از حد مجاز است."
    )
