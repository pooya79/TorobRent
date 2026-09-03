import pytest
from django.conf import settings
from django.contrib import admin
from django.contrib.auth.models import Permission
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.contact.models import IntakeKind, SupportRequest, SupportRequestStatus


def valid_message(**overrides: str) -> dict[str, str]:
    return {
        "name": "نگار محمدی",
        "email": "negar@example.com",
        "kind": IntakeKind.GENERAL,
        "message": "برای استفاده از بخش جست‌وجو راهنمایی می‌خواهم.",
        **overrides,
    }


@pytest.mark.django_db
def test_legacy_contact_endpoint_rejects_new_anonymous_requests(api_client: APIClient):
    response = api_client.post("/api/v1/contact/messages/", valid_message(), format="json")

    assert response.status_code == 404
    assert not SupportRequest.objects.exists()


@pytest.mark.django_db
def test_contact_details_are_managed_and_absent_values_stay_absent(api_client: APIClient):
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(settings, "CONTACT_PHONE", "")
        monkeypatch.setattr(settings, "CONTACT_ADDRESS", "")
        monkeypatch.setattr(settings, "CONTACT_MAP_URL", "")
        absent = api_client.get("/api/v1/system/contact/")

        monkeypatch.setattr(settings, "CONTACT_PHONE", "۰۲۱۸۸۷۷۶۵۴۳")
        monkeypatch.setattr(settings, "CONTACT_ADDRESS", "تهران، میدان نمونه")
        monkeypatch.setattr(settings, "CONTACT_MAP_URL", "https://maps.example/place")
        configured = api_client.get("/api/v1/system/contact/")

    assert absent.status_code == 200
    assert absent.data == {"phone": None, "address": None, "map_url": None}
    assert configured.data == {
        "phone": "۰۲۱۸۸۷۷۶۵۴۳",
        "address": "تهران، میدان نمونه",
        "map_url": "https://maps.example/place",
    }

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(settings, "CONTACT_MAP_URL", "javascript:alert(document.domain)")
        unsafe = api_client.get("/api/v1/system/contact/")

    assert unsafe.status_code == 200
    assert unsafe.data["map_url"] is None


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
