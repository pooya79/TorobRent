import pytest
from django.contrib import admin
from django.contrib.auth.models import Permission
from django.core import mail
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
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
    assert message.account_linked_at_intake is True
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
def test_routine_support_handling_is_retired_from_ordinary_django_admin(client, user):
    message_data = valid_message()
    message = SupportRequest.objects.create(intake_kind=message_data.pop("kind"), **message_data)
    user.is_staff = True
    user.email_verified_at = timezone.now()
    user.user_permissions.add(
        Permission.objects.get(codename="view_supportrequest"),
        Permission.objects.get(codename="change_supportrequest"),
        Permission.objects.get(codename="handle_general_support_requests"),
    )
    user.save(update_fields=["is_staff", "email_verified_at"])
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

    assert changelist.status_code == 403
    assert change.status_code == 403
    message.refresh_from_db()
    assert message.status == SupportRequestStatus.OPEN
    assert message.resolved_by is None
    assert message.resolved_at is None
    assert message.operator_note == ""
    assert admin.site.is_registered(SupportRequest)


@pytest.mark.django_db
def test_general_support_operator_cannot_use_django_admin_as_a_routine_queue(client, user):
    SupportRequest.objects.create(
        name="General requester",
        email="general@example.com",
        intake_kind=IntakeKind.GENERAL,
        classification="guidance",
        message="Visible general Support content.",
    )
    privacy = SupportRequest.objects.create(
        name="Privacy requester",
        email="privacy@example.com",
        intake_kind=IntakeKind.GENERAL,
        classification="privacy",
        message="Restricted privacy Support content.",
    )
    specialized = SupportRequest.objects.create(
        name="Specialized requester",
        email="specialized@example.com",
        intake_kind=IntakeKind.GENERAL,
        classification="guidance",
        status=SupportRequestStatus.ESCALATED,
        required_capability="handle_privacy_requests",
        message="General content whose handling requires a Privacy Operator.",
    )
    user.is_staff = True
    user.email_verified_at = timezone.now()
    user.user_permissions.add(
        Permission.objects.get(codename="view_supportrequest"),
        Permission.objects.get(codename="change_supportrequest"),
        Permission.objects.get(codename="handle_general_support_requests"),
    )
    user.save(update_fields=["is_staff", "email_verified_at"])
    client.force_login(user)

    changelist = client.get("/admin/contact/supportrequest/")
    protected_change = client.post(
        f"/admin/contact/supportrequest/{privacy.pk}/change/",
        {
            "status": SupportRequestStatus.RESOLVED,
            "operator_note": "Unauthorized finalization attempt.",
            "_save": "ذخیره",
        },
    )
    specialized_change = client.post(
        f"/admin/contact/supportrequest/{specialized.pk}/change/",
        {
            "status": SupportRequestStatus.RESOLVED,
            "operator_note": "Unauthorized specialized finalization attempt.",
            "_save": "ذخیره",
        },
    )

    assert changelist.status_code == 403
    assert protected_change.status_code != 200
    assert specialized_change.status_code != 200
    privacy.refresh_from_db()
    specialized.refresh_from_db()
    assert privacy.status == SupportRequestStatus.OPEN
    assert privacy.resolved_by is None
    assert specialized.status == SupportRequestStatus.ESCALATED
    assert specialized.resolved_by is None


@pytest.mark.django_db
def test_superuser_keeps_read_only_break_glass_and_personal_content_redaction(client):
    support_request = SupportRequest.objects.create(
        name="Requester to redact",
        email="redact@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="Personal content requiring privileged redaction.",
    )
    superuser = User.objects.create_superuser(email="break-glass@example.com", password="password")
    client.force_login(superuser)

    changelist = client.get("/admin/contact/supportrequest/")
    redacted = client.post(
        "/admin/contact/supportrequest/",
        {
            "action": "redact_selected_personal_content",
            "_selected_action": [support_request.id],
            "index": "0",
        },
    )

    assert changelist.status_code == 200
    assert redacted.status_code == 302
    support_request.refresh_from_db()
    assert support_request.personal_content_redacted_at is not None
    assert support_request.name == "Former requester"
    assert support_request.events.filter(
        event_type="personal_content_redacted", actor=superuser
    ).exists()


@pytest.mark.django_db
def test_non_operator_cannot_open_contact_admin(client, user):
    client.force_login(user)

    response = client.get("/admin/contact/supportrequest/")

    assert response.status_code == 302
