from importlib import import_module
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from asgiref.sync import async_to_sync
from django.apps import apps as django_apps
from django.conf import settings
from django.contrib import admin
from django.contrib.auth.models import Permission
from django.core.files.storage import FileSystemStorage, default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.catalog.models import (
    City,
    District,
    Listing,
    ListingImage,
    ListingImageVariant,
    ListingState,
    Neighborhood,
    OutboundPolicy,
    Property,
    RentalTerms,
    Source,
)
from apps.submissions.models import (
    MediaAsset,
    Submission,
    SubmissionImage,
    SubmissionImageStatus,
    SubmissionImageVariant,
)
from apps.submissions.tasks import cleanup_abandoned_submission_images


def image_upload(
    *,
    name: str = "home.jpg",
    image_format: str = "JPEG",
    size: tuple[int, int] = (1600, 1200),
    exif: Image.Exif | None = None,
) -> SimpleUploadedFile:
    content = BytesIO()
    save_options = {"exif": exif} if exif is not None else {}
    Image.new("RGB", size, "#a25f3a").save(content, format=image_format, **save_options)
    return SimpleUploadedFile(name, content.getvalue(), content_type="application/octet-stream")


def create_draft(api_client: APIClient, submitter: User) -> str:
    submitter.is_submitter = True
    submitter.save(update_fields=("is_submitter",))
    api_client.force_authenticate(submitter)
    response = api_client.post("/api/v1/submissions/", {"role": "owner"}, format="json")
    assert response.status_code == 201
    return str(response.data["id"])


async def collect_stream(stream: Any) -> bytes:
    return b"".join([chunk async for chunk in stream])


@pytest.mark.django_db
def test_verified_submitter_can_create_an_owner_draft(api_client: APIClient):
    submitter = User.objects.create_user(
        email="owner@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
        is_submitter=True,
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
def test_verified_renter_cannot_create_a_submission(api_client: APIClient):
    renter = User.objects.create_user(
        email="renter@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
        is_submitter=False,
    )
    api_client.force_authenticate(renter)

    response = api_client.post(
        "/api/v1/submissions/",
        {"role": "owner"},
        format="json",
    )

    assert response.status_code == 403
    assert response.data["code"] == "permission_denied"


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("property_type", "property_type_label"),
    [
        ("office", "دفتر اداری"),
        ("shop", "مغازه"),
        ("warehouse", "انبار"),
        ("workshop", "کارگاه"),
    ],
)
def test_submission_accepts_commercial_types_without_rooms_and_preserves_residential_rule(
    api_client: APIClient, property_type: str, property_type_label: str
):
    submitter = User.objects.create_user(
        email="office-owner@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)
    detail_url = f"/api/v1/submissions/{submission_id}/"

    commercial = api_client.patch(
        detail_url,
        {
            "completed_step": "property_facts",
            "property_facts": {
                "property_type": property_type,
                "area_sqm": 95,
                "room_count": None,
            },
        },
        format="json",
    )
    apartment = api_client.patch(
        detail_url,
        {
            "completed_step": "property_facts",
            "property_facts": {"property_type": "apartment", "area_sqm": 95},
        },
        format="json",
    )

    assert commercial.status_code == 200, commercial.data
    assert commercial.data["property_facts"] == {
        "property_category": "commercial",
        "property_category_label": "تجاری",
        "property_type": property_type,
        "property_type_label": property_type_label,
        "area_sqm": 95,
        "room_count": None,
        "construction_year": None,
        "floor": None,
        "total_floors": None,
        "units_per_floor": None,
    }
    assert apartment.status_code == 400
    assert "property_facts.room_count" in apartment.data["errors"]


@pytest.mark.django_db
def test_submission_rejects_an_unknown_property_type(api_client: APIClient):
    submitter = User.objects.create_user(
        email="unknown-type-owner@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)

    response = api_client.patch(
        f"/api/v1/submissions/{submission_id}/",
        {
            "completed_step": "property_facts",
            "property_facts": {
                "property_type": "shopping_center",
                "area_sqm": 95,
            },
        },
        format="json",
    )

    assert response.status_code == 400
    assert "property_facts.property_type" in response.data["errors"]


@pytest.mark.django_db
def test_submitter_can_save_and_resume_the_complete_draft_flow(
    api_client: APIClient, django_capture_on_commit_callbacks
):
    submitter = User.objects.create_user(
        email="agent@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
        is_submitter=True,
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
        if payload["completed_step"] == "features_description":
            with django_capture_on_commit_callbacks(execute=True):
                uploaded = api_client.post(
                    f"{detail_url}images/",
                    {"file": image_upload(size=(40, 30))},
                    format="multipart",
                )
            assert uploaded.status_code == 201
            media_step = api_client.patch(
                detail_url,
                {"completed_step": "images"},
                format="json",
            )
            assert media_step.status_code == 200

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
    assert resumed.data["media_complete"] is True

    edited_location = api_client.patch(detail_url, steps[0], format="json")
    assert edited_location.status_code == 200
    assert edited_location.data["current_step"] == "review"


@pytest.mark.django_db
def test_unverified_or_different_submitter_cannot_mutate_a_draft(api_client: APIClient):
    unverified = User.objects.create_user(
        email="unverified@example.com",
        password="correct-horse-battery",
        is_submitter=True,
    )
    api_client.force_authenticate(unverified)
    denied = api_client.post("/api/v1/submissions/", {"role": "owner"}, format="json")
    assert denied.status_code == 403

    owner = User.objects.create_user(
        email="draft-owner@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
        is_submitter=True,
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
def test_exact_location_is_visible_only_to_responsible_submitter_and_review_operator(
    api_client: APIClient,
):
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    submitter = User.objects.create_user(
        email="located-owner@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
        is_submitter=True,
    )
    submission_id = create_draft(api_client, submitter)
    detail_url = f"/api/v1/submissions/{submission_id}/"

    saved = api_client.patch(
        detail_url,
        {
            "completed_step": "location",
            "location": {
                "neighborhood_id": str(neighborhood.id),
                "address": "بلوار دریا، کوچه سرو",
                "exact_location": {"latitude": 35.770001, "longitude": 51.379999},
            },
        },
        format="json",
    )

    assert saved.status_code == 200, saved.data
    assert saved.data["location"]["exact_location"] == {
        "latitude": "35.770001",
        "longitude": "51.379999",
    }

    unrelated = User.objects.create_user(
        email="unrelated@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
        is_submitter=True,
    )
    api_client.force_authenticate(unrelated)
    assert api_client.get(detail_url).status_code == 404
    assert api_client.get(f"/api/v1/operator/submissions/{submission_id}/").status_code == 403

    generic_staff = User.objects.create_user(
        email="generic-staff@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
        is_staff=True,
    )
    api_client.force_authenticate(generic_staff)
    assert api_client.get(detail_url).status_code == 404
    assert api_client.get(f"/api/v1/operator/submissions/{submission_id}/").status_code == 403

    api_client.force_authenticate(user=None)
    assert api_client.get(detail_url).status_code == 401
    assert api_client.get(f"/api/v1/operator/submissions/{submission_id}/").status_code == 401

    reviewer = User.objects.create_user(
        email="location-reviewer@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    reviewer.user_permissions.add(
        Permission.objects.get(content_type__app_label="submissions", codename="review_submission")
    )
    api_client.force_authenticate(reviewer)
    reviewed = api_client.get(f"/api/v1/operator/submissions/{submission_id}/")
    assert reviewed.status_code == 200
    assert reviewed.data["location"]["exact_location"] == {
        "latitude": "35.770001",
        "longitude": "51.379999",
    }


@pytest.mark.django_db
def test_invalid_rental_terms_preserve_the_last_valid_toman_values(api_client: APIClient):
    submitter = User.objects.create_user(
        email="terms@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
        is_submitter=True,
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


@pytest.mark.django_db(transaction=True)
def test_submitter_uploads_an_image_and_receives_processed_responsive_variants(
    api_client: APIClient,
):
    submitter = User.objects.create_user(
        email="media@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)

    response = api_client.post(
        f"/api/v1/submissions/{submission_id}/images/",
        {"file": image_upload()},
        format="multipart",
    )

    assert response.status_code == 201
    assert response.data["status"] == "ready"
    assert response.data["is_primary"] is True
    assert [(item["kind"], item["width"]) for item in response.data["variants"]] == [
        ("small", 480),
        ("medium", 960),
        ("large", 1440),
    ]
    detail = api_client.get(f"/api/v1/submissions/{submission_id}/")
    assert detail.data["images"] == [response.data]


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("upload", "expected_message"),
    [
        (
            SimpleUploadedFile("spoofed.jpg", b"not an image", content_type="image/jpeg"),
            "فایل بارگذاری‌شده یک تصویر معتبر نیست.",
        ),
        (
            image_upload(size=(100, 100)),
            "هر تصویر باید حداکثر 0 مگابایت باشد.",
        ),
    ],
)
def test_spoofed_and_oversized_image_uploads_are_rejected_by_content(
    api_client: APIClient,
    upload: SimpleUploadedFile,
    expected_message: str,
    monkeypatch: pytest.MonkeyPatch,
):
    submitter = User.objects.create_user(
        email=f"invalid-{upload.name}@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)
    if upload.name == "home.jpg":
        monkeypatch.setattr(settings, "SUBMISSION_IMAGE_MAX_BYTES", 100)

    response = api_client.post(
        f"/api/v1/submissions/{submission_id}/images/",
        {"file": upload},
        format="multipart",
    )

    assert response.status_code == 400
    assert response.data["detail"] == expected_message
    assert api_client.get(f"/api/v1/submissions/{submission_id}/").data["images"] == []


@pytest.mark.django_db(transaction=True)
def test_image_processing_corrects_orientation_and_removes_metadata(api_client: APIClient):
    submitter = User.objects.create_user(
        email="orientation@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)
    exif = Image.Exif()
    exif[274] = 6
    exif[315] = "Private photographer metadata"

    uploaded = api_client.post(
        f"/api/v1/submissions/{submission_id}/images/",
        {"file": image_upload(size=(1200, 1600), exif=exif)},
        format="multipart",
    )
    medium_url = next(
        variant["url"] for variant in uploaded.data["variants"] if variant["kind"] == "medium"
    )
    content = api_client.get(medium_url)
    processed = Image.open(BytesIO(async_to_sync(collect_stream)(content.streaming_content)))

    assert content.status_code == 200
    assert content.headers["Cache-Control"] == "private, max-age=300"
    assert processed.size == (960, 720)
    assert not processed.getexif()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("image_format", ["PNG", "WEBP"])
def test_png_and_webp_are_accepted_by_content_not_filename(
    api_client: APIClient, image_format: str
):
    submitter = User.objects.create_user(
        email=f"{image_format.lower()}@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)

    response = api_client.post(
        f"/api/v1/submissions/{submission_id}/images/",
        {"file": image_upload(name="upload.dat", image_format=image_format, size=(100, 80))},
        format="multipart",
    )

    assert response.status_code == 201
    assert response.data["status"] == "ready"


@pytest.mark.django_db(transaction=True)
def test_unexpected_processing_errors_become_visible_failures(
    api_client: APIClient,
    monkeypatch: pytest.MonkeyPatch,
):
    submitter = User.objects.create_user(
        email="processing-error@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)

    def fail_render(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("unexpected renderer failure")

    monkeypatch.setattr("apps.submissions.services._render_variant", fail_render)
    response = api_client.post(
        f"/api/v1/submissions/{submission_id}/images/",
        {"file": image_upload(size=(100, 80))},
        format="multipart",
    )

    assert response.status_code == 201
    assert response.data["status"] == "failed"
    assert response.data["failure_reason"]
    assert (
        api_client.patch(
            f"/api/v1/submissions/{submission_id}/",
            {"completed_step": "images"},
            format="json",
        ).status_code
        == 400
    )


@pytest.mark.django_db(transaction=True)
def test_media_step_requires_one_to_twelve_ready_images(api_client: APIClient):
    submitter = User.objects.create_user(
        email="limits@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)
    detail_url = f"/api/v1/submissions/{submission_id}/"

    empty = api_client.patch(detail_url, {"completed_step": "images"}, format="json")
    assert empty.status_code == 400

    for index in range(12):
        uploaded = api_client.post(
            f"{detail_url}images/",
            {"file": image_upload(name=f"home-{index}.jpg", size=(20, 20))},
            format="multipart",
        )
        assert uploaded.status_code == 201

    too_many = api_client.post(
        f"{detail_url}images/",
        {"file": image_upload(name="thirteenth.jpg", size=(20, 20))},
        format="multipart",
    )
    assert too_many.status_code == 400

    completed = api_client.patch(detail_url, {"completed_step": "images"}, format="json")
    assert completed.status_code == 200
    assert completed.data["media_complete"] is True
    assert completed.data["current_step"] == "contact"


@pytest.mark.django_db(transaction=True)
def test_submitter_reorders_selects_primary_and_removes_only_their_image(
    api_client: APIClient,
):
    submitter = User.objects.create_user(
        email="ordering@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)
    images_url = f"/api/v1/submissions/{submission_id}/images/"
    first = api_client.post(
        images_url,
        {"file": image_upload(name="first.jpg", size=(50, 40))},
        format="multipart",
    ).data
    second = api_client.post(
        images_url,
        {"file": image_upload(name="second.jpg", size=(60, 40))},
        format="multipart",
    ).data

    reordered = api_client.patch(
        images_url,
        {"image_ids": [second["id"], first["id"]], "primary_image_id": second["id"]},
        format="json",
    )

    assert reordered.status_code == 200
    assert [(item["id"], item["position"], item["is_primary"]) for item in reordered.data] == [
        (second["id"], 0, True),
        (first["id"], 1, False),
    ]
    first_variant_names = list(
        SubmissionImage.objects.get(id=first["id"]).variants.values_list("asset__file", flat=True)
    )

    removed = api_client.delete(f"{images_url}{first['id']}/")

    assert removed.status_code == 204
    remaining = api_client.get(f"/api/v1/submissions/{submission_id}/").data["images"]
    assert [(item["id"], item["position"], item["is_primary"]) for item in remaining] == [
        (second["id"], 0, True)
    ]
    assert all(not default_storage.exists(name) for name in first_variant_names)
    assert api_client.get(second["variants"][0]["url"]).status_code == 200


@pytest.mark.django_db(transaction=True)
def test_removing_media_preserves_a_file_referenced_by_another_draft(api_client: APIClient):
    first_submitter = User.objects.create_user(
        email="first-reference@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    first_submission_id = create_draft(api_client, first_submitter)
    uploaded = api_client.post(
        f"/api/v1/submissions/{first_submission_id}/images/",
        {"file": image_upload(size=(80, 60))},
        format="multipart",
    ).data
    original_variant = SubmissionImage.objects.get(id=uploaded["id"]).variants.first()
    assert original_variant is not None
    shared_name = original_variant.asset.file.name

    second_submitter = User.objects.create_user(
        email="second-reference@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    second_submission = Submission.objects.create(submitter=second_submitter, role="owner")
    second_image = SubmissionImage.objects.create(
        submission=second_submission,
        status=SubmissionImageStatus.READY,
        position=0,
        is_primary=True,
    )
    SubmissionImageVariant.objects.create(
        image=second_image,
        kind=original_variant.kind,
        file=original_variant.file.name,
        width=original_variant.width,
        height=original_variant.height,
        byte_size=original_variant.byte_size,
        asset=original_variant.asset,
    )

    removed = api_client.delete(
        f"/api/v1/submissions/{first_submission_id}/images/{uploaded['id']}/"
    )

    assert removed.status_code == 204
    assert default_storage.exists(shared_name)


@pytest.mark.django_db(transaction=True)
def test_listing_in_published_state_retains_files_after_draft_media_is_removed(
    api_client: APIClient,
):
    from apps.submissions.services import retain_submission_media_for_listing

    submitter = User.objects.create_user(
        email="published-reference@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)
    uploaded = api_client.post(
        f"/api/v1/submissions/{submission_id}/images/",
        {"file": image_upload(size=(80, 60))},
        format="multipart",
    ).data
    api_client.patch(
        f"/api/v1/submissions/{submission_id}/",
        {"completed_step": "images"},
        format="json",
    )
    source = Source.objects.create(
        name="torobrent-direct",
        domain="direct.torobrent.test",
        display_name="TorobRent",
        outbound_policy=OutboundPolicy.DISABLED,
    )
    listing = Listing.objects.create(
        property=Property.objects.create(),
        source=source,
        terms=RentalTerms.objects.create(deposit_rial=1, monthly_rent_rial=0),
        state=ListingState.PUBLISHED,
    )

    retained = retain_submission_media_for_listing(
        submission=Submission.objects.get(id=submission_id),
        listing=listing,
    )
    retained_names = [
        variant.asset.file.name
        for image in retained
        for variant in image.variants.select_related("asset")
    ]
    removed = api_client.delete(f"/api/v1/submissions/{submission_id}/images/{uploaded['id']}/")

    assert len(retained_names) == 3
    assert removed.status_code == 204
    assert all(default_storage.exists(name) for name in retained_names)

    listing.delete()

    assert all(not default_storage.exists(name) for name in retained_names)


@pytest.mark.django_db(transaction=True)
def test_listing_images_enforce_unique_positions_and_primary_selection():
    source = Source.objects.create(
        name="position-check",
        domain="position-check.torobrent.test",
        display_name="Position check",
        outbound_policy=OutboundPolicy.DISABLED,
    )
    listing = Listing.objects.create(
        property=Property.objects.create(),
        source=source,
        terms=RentalTerms.objects.create(deposit_rial=1, monthly_rent_rial=0),
        state=ListingState.PUBLISHED,
    )
    listing_image = ListingImage.objects.create(listing=listing, position=0, is_primary=True)

    with pytest.raises(IntegrityError), transaction.atomic():
        ListingImage.objects.create(listing=listing, position=0)

    with pytest.raises(IntegrityError), transaction.atomic():
        ListingImage.objects.create(listing=listing, position=1, is_primary=True)

    asset = MediaAsset.objects.create(
        file="constraint-check.webp",
        width=480,
        height=360,
        byte_size=100,
    )
    ListingImageVariant.objects.create(image=listing_image, kind="small", asset=asset)

    with pytest.raises(IntegrityError), transaction.atomic():
        ListingImageVariant.objects.create(image=listing_image, kind="small", asset=asset)

    with pytest.raises(IntegrityError), transaction.atomic():
        MediaAsset.objects.create(
            file=asset.file.name,
            width=480,
            height=360,
            byte_size=100,
        )


@pytest.mark.django_db(transaction=True)
def test_media_asset_backfill_deduplicates_legacy_shared_files():
    first_submitter = User.objects.create_user(
        email="legacy-first@example.com",
        password="correct-horse-battery",
    )
    second_submitter = User.objects.create_user(
        email="legacy-second@example.com",
        password="correct-horse-battery",
    )
    shared_file = "submission-media/legacy/shared.webp"
    variants = []
    for submitter in (first_submitter, second_submitter):
        submission = Submission.objects.create(submitter=submitter, role="owner")
        image = SubmissionImage.objects.create(
            submission=submission,
            status=SubmissionImageStatus.READY,
            position=0,
            is_primary=True,
        )
        variants.append(
            SubmissionImageVariant.objects.create(
                image=image,
                kind="small",
                file=shared_file,
                width=480,
                height=360,
                byte_size=100,
                asset=None,
            )
        )
    migration = import_module("apps.submissions.migrations.0003_share_processed_media_assets")

    migration.create_assets_for_submission_variants(django_apps, None)

    asset_ids = {SubmissionImageVariant.objects.get(id=variant.id).asset_id for variant in variants}
    assert len(asset_ids) == 1
    assert MediaAsset.objects.filter(file=shared_file).count() == 1


@pytest.mark.django_db(transaction=True)
def test_unapproved_image_content_is_limited_to_its_submitter_and_submission_reviewers(
    api_client: APIClient,
):
    submitter = User.objects.create_user(
        email="private-media@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)
    uploaded = api_client.post(
        f"/api/v1/submissions/{submission_id}/images/",
        {"file": image_upload(size=(40, 30))},
        format="multipart",
    ).data
    content_url = uploaded["variants"][0]["url"]
    assert api_client.get(content_url).status_code == 200

    other = User.objects.create_user(
        email="other-media@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    api_client.force_authenticate(other)
    assert api_client.get(content_url).status_code == 404

    generic_staff = User.objects.create_user(
        email="staff-media@example.com",
        password="correct-horse-battery",
        is_staff=True,
    )
    api_client.force_authenticate(generic_staff)
    assert api_client.get(content_url).status_code == 404

    reviewer = User.objects.create_user(
        email="reviewer-media@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    reviewer.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="submissions",
            codename="review_submission",
        )
    )
    api_client.force_authenticate(reviewer)
    assert api_client.get(content_url).status_code == 200

    api_client.force_authenticate(user=None)
    assert api_client.get(content_url).status_code == 401


@pytest.mark.django_db(transaction=True)
def test_submitter_replaces_and_retries_a_failed_upload(api_client: APIClient):
    submitter = User.objects.create_user(
        email="retry@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)
    images_url = f"/api/v1/submissions/{submission_id}/images/"
    truncated = image_upload(size=(100, 80))
    truncated_content = truncated.read()[:-2]
    failed = api_client.post(
        images_url,
        {"file": SimpleUploadedFile("truncated.jpg", truncated_content)},
        format="multipart",
    )
    old_source = SubmissionImage.objects.get(id=failed.data["id"]).source.name

    retried = api_client.post(
        f"{images_url}{failed.data['id']}/retry/",
        {"file": image_upload(name="replacement.webp", image_format="WEBP", size=(100, 80))},
        format="multipart",
    )

    assert failed.status_code == 201
    assert failed.data["status"] == "failed"
    assert retried.status_code == 200
    assert retried.data["status"] == "ready"
    assert retried.data["failure_reason"] == ""
    assert not default_storage.exists(old_source)


@pytest.mark.django_db(transaction=True)
def test_abandoned_temporary_upload_cleanup_is_idempotent_and_preserves_ready_media(
    api_client: APIClient,
):
    submitter = User.objects.create_user(
        email="cleanup@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)
    images_url = f"/api/v1/submissions/{submission_id}/images/"
    truncated = image_upload(size=(100, 80)).read()[:-2]
    failed = api_client.post(
        images_url,
        {"file": SimpleUploadedFile("abandoned.jpg", truncated)},
        format="multipart",
    ).data
    ready = api_client.post(
        images_url,
        {"file": image_upload(name="retained.jpg", size=(100, 80))},
        format="multipart",
    ).data
    old_time = timezone.now() - timezone.timedelta(hours=25)
    SubmissionImage.objects.filter(id__in=(failed["id"], ready["id"])).update(updated_at=old_time)
    failed_source = SubmissionImage.objects.get(id=failed["id"]).source.name

    first_run = cleanup_abandoned_submission_images()
    second_run = cleanup_abandoned_submission_images()

    assert first_run == 1
    assert second_run == 0
    assert not SubmissionImage.objects.filter(id=failed["id"]).exists()
    assert not default_storage.exists(failed_source)
    assert SubmissionImage.objects.filter(id=ready["id"], status="ready").exists()
    assert api_client.get(ready["variants"][0]["url"]).status_code == 200


@pytest.mark.django_db(transaction=True)
def test_operator_inspects_and_removes_inappropriate_draft_media(api_client: APIClient):
    assert admin.site.is_registered(Submission)
    assert admin.site.is_registered(SubmissionImage)
    submitter = User.objects.create_user(
        email="operator-inspection@example.com",
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )
    submission_id = create_draft(api_client, submitter)
    uploaded = api_client.post(
        f"/api/v1/submissions/{submission_id}/images/",
        {"file": image_upload(size=(100, 80))},
        format="multipart",
    ).data
    variant_names = list(
        SubmissionImage.objects.get(id=uploaded["id"]).variants.values_list(
            "asset__file", flat=True
        )
    )
    operator = User.objects.create_superuser(
        email="media-operator@example.com",
        password="operator-password",
    )
    api_client.force_authenticate(user=None)
    api_client.force_login(operator)

    change = api_client.get(f"/admin/submissions/submission/{submission_id}/change/")
    removed = api_client.post(
        f"/admin/submissions/submissionimage/{uploaded['id']}/delete/",
        {"post": "yes"},
        HTTP_X_CSRFTOKEN=api_client.cookies["csrftoken"].value,
    )

    assert change.status_code == 200
    assert uploaded["variants"][1]["url"].encode() in change.content
    assert removed.status_code == 302
    assert not SubmissionImage.objects.filter(id=uploaded["id"]).exists()
    assert all(not default_storage.exists(name) for name in variant_names)


@pytest.mark.django_db(transaction=True)
def test_processed_media_survives_a_new_local_storage_instance(
    api_client: APIClient,
    tmp_path: Path,
):
    storages = {
        "default": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
            "OPTIONS": {"location": str(tmp_path)},
        },
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
    with override_settings(MEDIA_ROOT=tmp_path, STORAGES=storages):
        submitter = User.objects.create_user(
            email="restart-storage@example.com",
            password="correct-horse-battery",
            email_verified_at=timezone.now(),
        )
        submission_id = create_draft(api_client, submitter)
        uploaded = api_client.post(
            f"/api/v1/submissions/{submission_id}/images/",
            {"file": image_upload(size=(100, 80))},
            format="multipart",
        ).data
        variant_name = (
            SubmissionImage.objects
            .get(id=uploaded["id"])
            .variants.select_related("asset")
            .get(kind="medium")
            .asset.file.name
        )

        restarted_storage = FileSystemStorage(location=tmp_path)

        assert restarted_storage.exists(variant_name)
        with restarted_storage.open(variant_name, "rb") as stored:
            assert Image.open(stored).format == "WEBP"
