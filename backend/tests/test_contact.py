import pytest
from django.contrib import admin
from django.contrib.auth.models import Permission
from django.core import mail
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.contact.models import IntakeKind, SupportRequest, SupportRequestStatus


def csrf_client(api_client: APIClient) -> APIClient:
    response = api_client.get("/api/v1/auth/session/")
    api_client.credentials(HTTP_X_CSRFTOKEN=response.data["csrf_token"])
    return api_client


def valid_message(**overrides: str) -> dict[str, str]:
    return {
        "name": "نگار محمدی",
        "email": "negar@example.com",
        "kind": IntakeKind.GENERAL,
        "message": "برای استفاده از بخش جست‌وجو راهنمایی می‌خواهم.",
        **overrides,
    }


@pytest.mark.django_db
def test_visitor_sends_persian_contact_message_without_email_notification(api_client: APIClient):
    response = csrf_client(api_client).post(
        "/api/v1/contact/messages/", valid_message(), format="json"
    )

    assert response.status_code == 201
    assert response.data == {"detail": "پیام شما ثبت شد و اپراتور آن را بررسی می‌کند."}
    message = SupportRequest.objects.get()
    assert message.name == "نگار محمدی"
    assert message.submitter is None
    assert message.status == SupportRequestStatus.OPEN
    assert mail.outbox == []


@pytest.mark.django_db
def test_authenticated_submitter_identifies_account_deletion_request(api_client: APIClient, user):
    api_client.force_login(user)

    response = csrf_client(api_client).post(
        "/api/v1/contact/messages/",
        valid_message(
            email=user.email,
            kind=IntakeKind.ACCOUNT_DELETION,
            message="می‌خواهم حساب و اطلاعات عمومی تماس من حذف شود.",
        ),
        format="json",
    )

    assert response.status_code == 201
    message = SupportRequest.objects.get()
    assert message.submitter == user
    assert message.intake_kind == IntakeKind.ACCOUNT_DELETION


@pytest.mark.django_db
def test_contact_message_validates_persian_input_and_honeypot(api_client: APIClient):
    client = csrf_client(api_client)

    short = client.post("/api/v1/contact/messages/", valid_message(message="کم"), format="json")
    spam = client.post(
        "/api/v1/contact/messages/",
        valid_message(website="https://spam.example"),
        format="json",
    )

    assert short.status_code == 400
    assert short.data["errors"]["message"][0]["message"] == ("متن پیام باید دست‌کم ۱۰ نویسه باشد.")
    assert spam.status_code == 400
    assert spam.data["errors"]["website"][0]["message"] == "ارسال پیام پذیرفته نشد."
    assert SupportRequest.objects.count() == 0


@pytest.mark.django_db
def test_contact_submission_is_csrf_protected_and_rate_limited(api_client: APIClient):
    missing_csrf = api_client.post("/api/v1/contact/messages/", valid_message(), format="json")
    assert missing_csrf.status_code == 403

    cache.clear()
    client = csrf_client(api_client)
    for index in range(5):
        response = client.post(
            "/api/v1/contact/messages/",
            valid_message(email=f"person{index}@example.com"),
            format="json",
        )
        assert response.status_code == 201

    throttled = client.post("/api/v1/contact/messages/", valid_message(), format="json")
    assert throttled.status_code == 429
    assert throttled.data["code"] == "throttled"


@pytest.mark.django_db
def test_contact_throttle_ignores_forged_forwarded_addresses(api_client: APIClient):
    cache.clear()
    client = csrf_client(api_client)

    for index in range(5):
        response = client.post(
            "/api/v1/contact/messages/",
            valid_message(email=f"person{index}@example.com"),
            format="json",
            HTTP_X_FORWARDED_FOR=f"198.51.100.{index}, 203.0.113.10",
            REMOTE_ADDR="172.18.0.2",
        )
        assert response.status_code == 201

    throttled = client.post(
        "/api/v1/contact/messages/",
        valid_message(),
        format="json",
        HTTP_X_FORWARDED_FOR="198.51.100.250, 203.0.113.10",
        REMOTE_ADDR="172.18.0.2",
    )
    assert throttled.status_code == 429


@pytest.mark.django_db
def test_contact_length_validation_messages_are_persian(api_client: APIClient):
    client = csrf_client(api_client)

    long_name = client.post(
        "/api/v1/contact/messages/", valid_message(name="ن" * 121), format="json"
    )
    long_message = client.post(
        "/api/v1/contact/messages/", valid_message(message="م" * 4001), format="json"
    )

    assert long_name.status_code == 400
    assert long_name.data["errors"]["name"][0]["message"] == ("نام نباید بیشتر از ۱۲۰ نویسه باشد.")
    assert long_message.status_code == 400
    assert long_message.data["errors"]["message"][0]["message"] == (
        "متن پیام نباید بیشتر از ۴۰۰۰ نویسه باشد."
    )


@pytest.mark.django_db
def test_operator_can_find_classify_and_resolve_contact_message(client, user):
    message_data = valid_message()
    message = SupportRequest.objects.create(intake_kind=message_data.pop("kind"), **message_data)
    user.is_staff = True
    user.user_permissions.add(
        Permission.objects.get(codename="view_supportrequest"),
        Permission.objects.get(codename="change_supportrequest"),
    )
    user.save(update_fields=["is_staff"])
    client.force_login(user)

    changelist = client.get("/admin/contact/supportrequest/", {"q": "نگار"})
    change = client.post(
        f"/admin/contact/supportrequest/{message.pk}/change/",
        {
            "intake_kind": IntakeKind.GENERAL,
            "classification": "guidance",
            "status": SupportRequestStatus.RESOLVED,
            "operator_note": "راهنما ارائه شد.",
            "_save": "ذخیره",
        },
    )

    assert changelist.status_code == 200
    assert "نگار محمدی" in changelist.content.decode()
    assert change.status_code == 302
    message.refresh_from_db()
    assert message.status == SupportRequestStatus.RESOLVED
    assert message.resolved_by == user
    assert message.resolved_at is not None
    assert message.operator_note == "راهنما ارائه شد."
    assert admin.site.is_registered(SupportRequest)


@pytest.mark.django_db
def test_non_operator_cannot_open_contact_admin(client, user):
    client.force_login(user)

    response = client.get("/admin/contact/supportrequest/")

    assert response.status_code == 302
