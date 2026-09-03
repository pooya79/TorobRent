from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import close_old_connections, connection
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import DisplayNameHistory, User
from apps.catalog.models import (
    Listing,
    ListingState,
    Neighborhood,
    Property,
    PropertyType,
    RentalTerms,
    Source,
)
from apps.communications.models import ListingInquiry, ListingInquiryMessage, SystemNotification
from apps.communications.services import lock_listing_inquiry_message_edits
from apps.submissions.models import Submission, SubmissionState, SubmitterRole


def make_listing(*, submitter: User, property_: Property | None = None) -> Listing:
    call_command("loaddata", "catalog_seed", verbosity=0)
    neighborhood = Neighborhood.objects.get(name_fa="سعادت‌آباد")
    property_ = property_ or Property.objects.create(
        city=neighborhood.district.city,
        district=neighborhood.district,
        neighborhood=neighborhood,
        property_type=PropertyType.APARTMENT,
        area_sqm=90,
        room_count=2,
    )
    now = timezone.now()
    listing = Listing.objects.create(
        property=property_,
        source=Source.objects.get(is_builtin=True),
        terms=RentalTerms.objects.create(
            deposit_rial=8_000_000_000,
            monthly_rent_rial=200_000_000,
        ),
        state=ListingState.PUBLISHED,
        direct_phone="09121234567",
        published_at=now,
        availability_confirmed_at=now,
        available_until=now + timedelta(days=30),
    )
    Submission.objects.create(
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
    return listing


def verified_user(email: str, display_name: str = "") -> User:
    return User.objects.create_user(
        email=email,
        password="password",
        email_verified_at=timezone.now(),
        display_name=display_name,
    )


@pytest.mark.django_db
def test_account_chooses_a_current_unverified_display_name_with_audit_history(
    api_client: APIClient,
):
    account = User.objects.create_user(
        email="renter@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    api_client.force_authenticate(account)

    first = api_client.put("/api/v1/users/me/display-name/", {"display_name": "رها"}, format="json")
    second = api_client.put(
        "/api/v1/users/me/display-name/", {"display_name": "رها احمدی"}, format="json"
    )

    assert first.status_code == second.status_code == 200
    assert second.data == {
        "display_name": "رها احمدی",
        "identity_verified": False,
    }
    account.refresh_from_db()
    assert account.display_name == "رها احمدی"
    assert list(
        DisplayNameHistory.objects.filter(account=account).values_list("display_name", flat=True)
    ) == ["رها", "رها احمدی"]


@pytest.mark.django_db
def test_property_detail_exposes_only_eligible_listing_contact_affordances(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک آگهی")
    listing = make_listing(submitter=submitter)

    public_detail = api_client.get(f"/api/v1/catalog/properties/{listing.property_id}/")
    api_client.force_authenticate(submitter)
    owner_detail = api_client.get(f"/api/v1/catalog/properties/{listing.property_id}/")

    assert public_detail.data["listings"][0]["can_message_submitter"] is True
    assert public_detail.data["listings"][0]["is_responsible_submitter"] is False
    assert "submitter" not in public_detail.data["listings"][0]
    assert owner_detail.data["listings"][0]["can_message_submitter"] is False
    assert owner_detail.data["listings"][0]["is_responsible_submitter"] is True


@pytest.mark.django_db
def test_verified_renter_needs_a_display_name_before_sending_first_inquiry(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com")
    listing = make_listing(submitter=submitter)
    api_client.force_authenticate(renter)

    response = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "آیا هنوز موجود است؟"},
        format="json",
    )

    assert response.status_code == 400
    assert response.data["errors"]["detail"][0]["code"] == "display_name_required"
    assert not ListingInquiry.objects.exists()


@pytest.mark.django_db
def test_unverified_account_cannot_start_or_open_listing_inquiries(api_client: APIClient):
    submitter = verified_user("submitter@example.com", "مالک")
    unverified = User.objects.create_user(
        email="unverified@example.com",
        password="password",
        display_name="مهمان",
    )
    listing = make_listing(submitter=submitter)
    api_client.force_authenticate(unverified)

    created = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "پیام"},
        format="json",
    )
    feed = api_client.get("/api/v1/messages/?kind=listing_inquiry")

    assert created.status_code == feed.status_code == 403
    assert not ListingInquiry.objects.exists()


@pytest.mark.django_db
def test_listing_inquiry_is_private_and_resolves_current_display_names(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    unrelated = verified_user("other@example.com", "دیگر")
    listing = make_listing(submitter=submitter)
    api_client.force_authenticate(renter)

    created = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "آیا هنوز موجود است؟"},
        format="json",
    )
    inquiry_id = created.data["id"]
    assert created.status_code == 201
    assert created.data["href"] == f"/messages/{inquiry_id}"
    assert ListingInquiry.objects.count() == ListingInquiryMessage.objects.count() == 1

    api_client.force_authenticate(unrelated)
    assert api_client.get(f"/api/v1/messages/{inquiry_id}/").status_code == 404

    renter.display_name = "رهای تازه"
    renter.save(update_fields=("display_name",))
    api_client.force_authenticate(submitter)
    feed = api_client.get("/api/v1/messages/?kind=listing_inquiry")
    detail = api_client.get(f"/api/v1/messages/{inquiry_id}/")

    assert [item["id"] for item in feed.data["results"]] == [str(inquiry_id)]
    assert detail.data["kind"] == "listing_inquiry"
    assert detail.data["counterpart"] == {
        "display_name": "رهای تازه",
        "role": "renter",
        "identity_verified": False,
    }
    assert detail.data["entries"][0]["body"] == "آیا هنوز موجود است؟"


@pytest.mark.django_db
def test_inquiry_detail_keeps_opening_listing_snapshot_beside_current_availability(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    listing = make_listing(submitter=submitter)
    opening_title = listing.property.title
    opening_source = listing.source.display_name
    api_client.force_authenticate(renter)
    created = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "شرایط آگهی چیست؟"},
        format="json",
    )

    listing.property.area_sqm = 125
    listing.property.save(update_fields=("area_sqm",))
    listing.terms.deposit_rial = 9_000_000_000
    listing.terms.monthly_rent_rial = 250_000_000
    listing.terms.save(update_fields=("deposit_rial", "monthly_rent_rial"))
    listing.state = ListingState.UNAVAILABLE
    listing.save(update_fields=("state",))
    detail = api_client.get(f"/api/v1/messages/{created.data['id']}/")

    assert detail.status_code == 200
    assert detail.data["listing_context"] == {
        "opening_snapshot": {
            "property_title": opening_title,
            "area_sqm": 90,
            "rental_terms": {
                "deposit_rial": 8_000_000_000,
                "monthly_rent_rial": 200_000_000,
                "currency": "IRR",
            },
            "source_display_name": opening_source,
        },
        "current_availability": {
            "is_active": False,
            "state": ListingState.UNAVAILABLE,
        },
    }
    assert detail.data["reply_allowed"] is False
    assert detail.data["reply_unavailable_reason"] == "listing_inactive"

    inquiry = ListingInquiry.objects.get(id=created.data["id"])
    inquiry.opening_property_title = "عنوان تغییرکرده"
    with pytest.raises(ValidationError, match="immutable"):
        inquiry.save()
    with pytest.raises(ValidationError, match="immutable"):
        ListingInquiry.objects.filter(id=inquiry.id).update(opening_area_sqm=1)


@pytest.mark.django_db
def test_inquiry_replies_update_latest_activity_and_participant_read_state(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    listing = make_listing(submitter=submitter)
    api_client.force_authenticate(renter)
    created = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "پیام نخست"},
        format="json",
    )
    inquiry_id = created.data["id"]

    api_client.force_authenticate(submitter)
    assert api_client.get("/api/v1/messages/unread-count/").data == {"count": 1}
    assert api_client.get(f"/api/v1/messages/{inquiry_id}/").status_code == 200
    assert api_client.get("/api/v1/messages/unread-count/").data == {"count": 0}
    reply = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry_id}/replies/",
        {"body": "بله، موجود است."},
        format="json",
    )
    assert reply.status_code == 201

    api_client.force_authenticate(renter)
    assert api_client.get("/api/v1/messages/unread-count/").data == {"count": 1}
    detail = api_client.get(f"/api/v1/messages/{inquiry_id}/")
    assert [entry["body"] for entry in detail.data["entries"]] == [
        "پیام نخست",
        "بله، موجود است.",
    ]
    assert detail.data["read"] is True
    assert not SystemNotification.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize(
    "inactive_state",
    [
        ListingState.DRAFT,
        ListingState.PENDING,
        ListingState.EXPIRED,
        ListingState.REJECTED,
        ListingState.UNAVAILABLE,
        ListingState.ARCHIVED,
    ],
)
def test_every_inactive_listing_state_preserves_history_and_exact_reactivation_restores_replies(
    api_client: APIClient,
    inactive_state: str,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    listing = make_listing(submitter=submitter)
    api_client.force_authenticate(renter)
    created = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "پیام نخست"},
        format="json",
    )
    reply_url = f"/api/v1/messages/listing-inquiries/{created.data['id']}/replies/"

    listing.state = inactive_state
    listing.save(update_fields=("state",))
    rejected = api_client.post(reply_url, {"body": "پیام هنگام توقف"}, format="json")
    readable = api_client.get(f"/api/v1/messages/{created.data['id']}/")

    assert rejected.status_code == 400
    assert rejected.data["errors"]["detail"][0]["code"] == "listing_inactive"
    assert [entry["body"] for entry in readable.data["entries"]] == ["پیام نخست"]

    listing.state = ListingState.PUBLISHED
    listing.available_until = timezone.now() + timedelta(days=30)
    listing.save(update_fields=("state", "available_until"))
    restored = api_client.post(reply_url, {"body": "پیام پس از فعال‌سازی"}, format="json")

    assert restored.status_code == 201
    assert ListingInquiry.objects.count() == 1


@pytest.mark.django_db
def test_expired_availability_and_inactive_source_make_inquiry_read_only(api_client: APIClient):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    listing = make_listing(submitter=submitter)
    api_client.force_authenticate(renter)
    created = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "پیام نخست"},
        format="json",
    )
    reply_url = f"/api/v1/messages/listing-inquiries/{created.data['id']}/replies/"

    listing.available_until = timezone.now()
    listing.save(update_fields=("available_until",))
    expired = api_client.post(reply_url, {"body": "پاسخ"}, format="json")
    listing.available_until = timezone.now() + timedelta(days=30)
    listing.save(update_fields=("available_until",))
    listing.source.is_active = False
    listing.source.save(update_fields=("is_active",))
    inactive_source = api_client.post(reply_url, {"body": "پاسخ"}, format="json")

    assert expired.status_code == inactive_source.status_code == 400
    assert ListingInquiryMessage.objects.count() == 1


@pytest.mark.django_db
def test_responsibility_transfer_freezes_old_history_and_routes_new_inquiries_to_new_submitter(
    api_client: APIClient,
):
    original_submitter = verified_user("original@example.com", "مالک نخست")
    new_submitter = verified_user("new@example.com", "مالک تازه")
    first_renter = verified_user("first-renter@example.com", "رها")
    second_renter = verified_user("second-renter@example.com", "سارا")
    listing = make_listing(submitter=original_submitter)
    api_client.force_authenticate(first_renter)
    old_inquiry = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "پیام پیش از انتقال"},
        format="json",
    )

    submission = listing.submission
    submission.submitter = new_submitter
    submission.save(update_fields=("submitter",))

    old_reply_url = f"/api/v1/messages/listing-inquiries/{old_inquiry.data['id']}/replies/"
    renter_reply = api_client.post(old_reply_url, {"body": "پاسخ پس از انتقال"}, format="json")
    old_detail = api_client.get(f"/api/v1/messages/{old_inquiry.data['id']}/")
    api_client.force_authenticate(original_submitter)
    former_submitter_reply = api_client.post(
        old_reply_url, {"body": "پاسخ مالک نخست"}, format="json"
    )
    api_client.force_authenticate(new_submitter)
    transferred_detail = api_client.get(f"/api/v1/messages/{old_inquiry.data['id']}/")
    api_client.force_authenticate(second_renter)
    new_inquiry = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "پیام پس از انتقال"},
        format="json",
    )

    assert renter_reply.status_code == former_submitter_reply.status_code == 400
    assert old_detail.data["reply_unavailable_reason"] == "responsibility_changed"
    assert old_detail.data["counterpart"]["display_name"] == "مالک نخست"
    assert transferred_detail.status_code == 404
    assert new_inquiry.status_code == 201
    assert ListingInquiry.objects.get(id=new_inquiry.data["id"]).submitter == new_submitter


@pytest.mark.django_db
def test_listing_inquiry_replies_have_a_separate_burst_throttle(api_client: APIClient):
    cache.clear()
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    listing = make_listing(submitter=submitter)
    api_client.force_authenticate(renter)
    created = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "پیام نخست"},
        format="json",
    )
    reply_url = f"/api/v1/messages/listing-inquiries/{created.data['id']}/replies/"

    for index in range(30):
        assert (
            api_client.post(reply_url, {"body": f"پاسخ {index}"}, format="json").status_code == 201
        )
    assert api_client.post(reply_url, {"body": "پاسخ اضافی"}, format="json").status_code == 429
    cache.clear()


@pytest.mark.django_db
@override_settings(LISTING_INQUIRY_COLD_HOURLY_LIMIT=1, LISTING_INQUIRY_COLD_DAILY_LIMIT=2)
def test_cold_contact_quota_counts_new_listings_but_not_existing_thread_replies(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    first_listing = make_listing(submitter=submitter)
    second_listing = make_listing(submitter=submitter, property_=first_listing.property)
    api_client.force_authenticate(renter)

    first = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(first_listing.id), "body": "پیام نخست"},
        format="json",
    )
    reply = api_client.post(
        f"/api/v1/messages/listing-inquiries/{first.data['id']}/replies/",
        {"body": "پیام دوم"},
        format="json",
    )
    limited = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(second_listing.id), "body": "آگهی دوم"},
        format="json",
    )

    assert first.status_code == reply.status_code == 201
    assert limited.status_code == 429
    assert ListingInquiry.objects.count() == 1


@pytest.mark.django_db
@override_settings(
    LISTING_INQUIRY_COLD_HOURLY_LIMIT=5,
    LISTING_INQUIRY_COLD_DAILY_LIMIT=20,
    LISTING_INQUIRY_REPEATED_CONTENT_DAILY_LIMIT=1,
)
def test_repeated_opening_content_tightens_only_new_inquiry_initiation(api_client: APIClient):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    first_listing = make_listing(submitter=submitter)
    second_listing = make_listing(submitter=submitter, property_=first_listing.property)
    api_client.force_authenticate(renter)

    first = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(first_listing.id), "body": " لطفا تماس بگیرید "},
        format="json",
    )
    reply = api_client.post(
        f"/api/v1/messages/listing-inquiries/{first.data['id']}/replies/",
        {"body": "لطفا تماس بگیرید"},
        format="json",
    )
    repeated = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(second_listing.id), "body": "لطفا   تماس بگیرید"},
        format="json",
    )

    assert first.status_code == reply.status_code == 201
    assert repeated.status_code == 429
    assert repeated.data["code"] == "repeated_content_limit"
    assert ListingInquiry.objects.count() == 1
    assert ListingInquiryMessage.objects.count() == 2


@pytest.mark.django_db
def test_existing_listing_inquiry_must_use_the_throttled_reply_endpoint(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    listing = make_listing(submitter=submitter)
    api_client.force_authenticate(renter)

    first = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "پیام نخست"},
        format="json",
    )
    repeated = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "پیام دوم"},
        format="json",
    )

    assert first.status_code == 201
    assert repeated.status_code == 409
    assert "همان گفت‌وگو" in repeated.data["detail"]
    assert ListingInquiryMessage.objects.count() == 1


@pytest.mark.django_db
def test_message_author_can_edit_through_the_exact_15_minute_boundary(api_client: APIClient):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    listing = make_listing(submitter=submitter)
    api_client.force_authenticate(renter)
    created = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "متن نخست"},
        format="json",
    )
    message = ListingInquiryMessage.objects.get()
    created_at = datetime(2026, 9, 3, 12, tzinfo=UTC)
    ListingInquiryMessage.objects.filter(id=message.id).update(created_at=created_at)
    edit_url = f"/api/v1/messages/listing-inquiries/{created.data['id']}/messages/{message.id}/"

    with patch(
        "apps.communications.services.timezone.now",
        return_value=created_at + timedelta(minutes=15),
    ):
        edited = api_client.patch(edit_url, {"body": "متن اصلاح‌شده"}, format="json")

    assert edited.status_code == 200
    assert edited.data["body"] == "متن اصلاح‌شده"
    assert edited.data["edited_at"] is not None
    detail = api_client.get(f"/api/v1/messages/{created.data['id']}/")
    assert detail.data["entries"][0]["edited_at"] is not None
    assert detail.data["entries"][0]["editable"] is False


@pytest.mark.django_db
def test_unauthorized_expired_and_locked_message_edits_preserve_stored_content(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    unrelated = verified_user("unrelated@example.com", "غریبه")
    listing = make_listing(submitter=submitter)
    api_client.force_authenticate(renter)
    created = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "متن اصلی"},
        format="json",
    )
    message = ListingInquiryMessage.objects.get()
    edit_url = f"/api/v1/messages/listing-inquiries/{created.data['id']}/messages/{message.id}/"

    api_client.force_authenticate(submitter)
    wrong_author = api_client.patch(edit_url, {"body": "تغییر مالک"}, format="json")
    api_client.force_authenticate(unrelated)
    unrelated_edit = api_client.patch(edit_url, {"body": "تغییر غریبه"}, format="json")
    api_client.force_authenticate(renter)
    ListingInquiryMessage.objects.filter(id=message.id).update(
        created_at=timezone.now() - timedelta(minutes=15, microseconds=1)
    )
    expired = api_client.patch(edit_url, {"body": "تغییر دیرهنگام"}, format="json")
    ListingInquiryMessage.objects.filter(id=message.id).update(created_at=timezone.now())
    lock_listing_inquiry_message_edits(message=message)
    locked = api_client.patch(edit_url, {"body": "تغییر محتوای گزارش‌شده"}, format="json")

    assert wrong_author.status_code == 400
    assert unrelated_edit.status_code == 404
    assert expired.status_code == locked.status_code == 409
    message.refresh_from_db()
    assert message.body == "متن اصلی"


@pytest.mark.django_db
def test_listing_inquiry_text_contract_accepts_unicode_phone_links_and_exact_limit(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    first_listing = make_listing(submitter=submitter)
    second_listing = make_listing(submitter=submitter, property_=first_listing.property)
    api_client.force_authenticate(renter)

    allowed = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {
            "listing_id": str(first_listing.id),
            "body": "شماره ۰۹۱۲۱۲۳۴۵۶۷ و https://example.com/خانه\n" + "ش" * 1955,
        },
        format="json",
    )
    oversized = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(second_listing.id), "body": "ش" * 2001},
        format="json",
    )
    message = ListingInquiryMessage.objects.get()
    oversized_reply = api_client.post(
        f"/api/v1/messages/listing-inquiries/{allowed.data['id']}/replies/",
        {"body": "ش" * 2001},
        format="json",
    )
    oversized_edit = api_client.patch(
        f"/api/v1/messages/listing-inquiries/{allowed.data['id']}/messages/{message.id}/",
        {"body": "ش" * 2001},
        format="json",
    )

    assert allowed.status_code == 201
    assert len(ListingInquiryMessage.objects.get().body) == 2000
    assert oversized.status_code == 400
    assert oversized_reply.status_code == oversized_edit.status_code == 400
    assert ListingInquiry.objects.count() == 1
    message.refresh_from_db()
    assert len(message.body) == 2000


@pytest.mark.django_db
@override_settings(LISTING_INQUIRY_COLD_HOURLY_LIMIT=5, LISTING_INQUIRY_COLD_DAILY_LIMIT=1)
def test_daily_cold_contact_quota_counts_inquiries_outside_the_hourly_window(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    first_listing = make_listing(submitter=submitter)
    second_listing = make_listing(submitter=submitter, property_=first_listing.property)
    api_client.force_authenticate(renter)

    first = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(first_listing.id), "body": "پیام نخست"},
        format="json",
    )
    ListingInquiry.objects.update(created_at=timezone.now() - timedelta(hours=2))
    limited = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(second_listing.id), "body": "آگهی دوم"},
        format="json",
    )

    assert first.status_code == 201
    assert limited.status_code == 429


@pytest.mark.django_db
def test_two_listings_for_one_property_create_distinct_inquiries(api_client: APIClient):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    first_listing = make_listing(submitter=submitter)
    second_listing = make_listing(submitter=submitter, property_=first_listing.property)
    api_client.force_authenticate(renter)

    for listing in (first_listing, second_listing):
        response = api_client.post(
            "/api/v1/messages/listing-inquiries/",
            {"listing_id": str(listing.id), "body": f"درباره {listing.id}"},
            format="json",
        )
        assert response.status_code == 201

    assert set(ListingInquiry.objects.values_list("listing_id", flat=True)) == {
        first_listing.id,
        second_listing.id,
    }


@pytest.mark.django_db(transaction=True)
def test_concurrent_first_send_api_calls_create_one_renter_listing_inquiry():
    if connection.vendor != "postgresql":
        pytest.skip("Listing Inquiry concurrency behavior is PostgreSQL-specific")
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    listing = make_listing(submitter=submitter)

    def send(index: int) -> tuple[int, str | None]:
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(User.objects.get(id=renter.id))
            response = client.post(
                "/api/v1/messages/listing-inquiries/",
                {"listing_id": str(listing.id), "body": f"پیام هم‌زمان {index}"},
                format="json",
            )
            return response.status_code, response.data.get("id")
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(send, range(2)))

    assert sorted(status_code for status_code, _inquiry_id in responses) == [201, 409]
    assert ListingInquiry.objects.count() == 1
    assert ListingInquiryMessage.objects.count() == 1
