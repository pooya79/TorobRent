from datetime import timedelta

import pytest
from django.contrib.auth.models import Group, Permission
from django.utils import timezone

from apps.accounts.models import User
from apps.communications.models import SystemNotification
from apps.contact.models import (
    IntakeKind,
    SupportClassification,
    SupportRequest,
    SupportRequestEvent,
    SupportRequestEventType,
    SupportRequestNote,
    SupportRequestStatus,
    SupportRequiredCapability,
)
from apps.contact.services import claim_support_request, triage_support_request


def verified_user(email: str = "requester@example.com") -> User:
    return User.objects.create_user(
        email=email,
        password="correct-horse-battery",
        email_verified_at=timezone.now(),
    )


def support_operator(email: str = "operator@example.com") -> User:
    operator = User.objects.create_user(
        email=email,
        password="password",
        is_staff=True,
        email_verified_at=timezone.now(),
    )
    operator.groups.add(Group.objects.get(name="Support Operator"))
    return operator


@pytest.mark.django_db
def test_verified_account_creates_a_separate_support_thread_from_account_identity(api_client):
    requester = verified_user()
    requester.first_name = "نگار"
    requester.last_name = "محمدی"
    requester.save(update_fields=("first_name", "last_name"))
    api_client.force_authenticate(requester)

    first = api_client.post(
        "/api/v1/messages/support-requests/",
        {
            "intake_kind": "general",
            "subject": "راهنمایی",
            "message": "برای جست‌وجو راهنمایی می‌خواهم.",
        },
        format="json",
    )
    second = api_client.post(
        "/api/v1/messages/support-requests/",
        {"intake_kind": "general", "subject": "موضوع دیگر", "message": "این درخواست جداگانه است."},
        format="json",
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.data["id"] != second.data["id"]
    created = SupportRequest.objects.get(id=first.data["id"])
    assert created.submitter == requester
    assert created.name == "نگار محمدی"
    assert created.email == "requester@example.com"
    assert first.data["href"] == f"/messages/{created.id}"

    initial = created.messages.get(is_initial=True)
    edited = api_client.patch(
        f"/api/v1/messages/support-requests/{created.id}/messages/{initial.id}/",
        {"body": "متن ویرایش‌شده درخواست نخست"},
        format="json",
    )
    created.refresh_from_db()
    assert edited.status_code == 200
    assert created.message == "متن ویرایش‌شده درخواست نخست"


@pytest.mark.django_db
@pytest.mark.parametrize("account_state", ("anonymous", "inactive", "unverified"))
def test_new_support_requests_require_an_active_verified_account(api_client, account_state: str):
    if account_state != "anonymous":
        account = User.objects.create_user(
            email=f"{account_state}@example.com",
            password="password",
            is_active=account_state != "inactive",
        )
        api_client.force_authenticate(account)

    response = api_client.post(
        "/api/v1/messages/support-requests/",
        {"intake_kind": "general", "subject": "راهنمایی", "message": "پیام معتبر برای پشتیبانی"},
        format="json",
    )

    assert response.status_code in (401, 403)
    assert not SupportRequest.objects.exists()


@pytest.mark.django_db
def test_public_contact_endpoint_no_longer_accepts_anonymous_requests(api_client):
    response = api_client.post(
        "/api/v1/contact/messages/",
        {
            "name": "مهمان",
            "email": "guest@example.com",
            "kind": "general",
            "message": "پیام مهمان قدیمی",
        },
        format="json",
    )

    assert response.status_code in (401, 403, 404, 405)
    assert not SupportRequest.objects.exists()


@pytest.mark.django_db
def test_requester_thread_filters_internal_support_operations(api_client):
    requester = verified_user()
    operator = support_operator()
    support_request = SupportRequest.objects.create(
        submitter=requester,
        name="درخواست‌کننده",
        email=requester.email,
        intake_kind=IntakeKind.GENERAL,
        subject="مشکل حساب",
        message="پیام نخست درخواست‌کننده",
        account_linked_at_intake=True,
    )
    claim_support_request(support_request=support_request, actor=operator)
    support_request.refresh_from_db()
    public_activity = support_request.public_updated_at
    triage_support_request(
        support_request=support_request,
        actor=operator,
        classification=None,
        priority=None,
        new_status=SupportRequestStatus.ESCALATED,
        escalation_destination="تیم تخصصی",
        required_capability=SupportRequiredCapability.GENERAL,
        reason="ارجاع داخلی",
    )
    support_request.refresh_from_db()
    assert support_request.public_updated_at == public_activity
    SupportRequestNote.objects.create(
        support_request=support_request, actor=operator, body="یادداشت کاملا داخلی"
    )
    SupportRequestEvent.objects.create(
        support_request=support_request,
        actor=operator,
        event_type=SupportRequestEventType.CLASSIFIED,
        prior_state=support_request.status,
        new_state=support_request.status,
        classification=SupportClassification.GUIDANCE,
        reason="دلیل دسته‌بندی داخلی",
    )
    api_client.force_authenticate(requester)

    response = api_client.get(f"/api/v1/messages/{support_request.id}/")

    assert response.status_code == 200
    assert response.data["kind"] == "support_request"
    assert response.data["public_status"] == "in_progress"
    assert "پیام نخست درخواست‌کننده" in [
        entry["body"] for entry in response.data["entries"] if "body" in entry
    ]
    rendered = str(response.data)
    assert "یادداشت کاملا داخلی" not in rendered
    assert "دلیل دسته‌بندی داخلی" not in rendered
    assert "ارجاع داخلی" not in rendered
    assert "classification" not in rendered
    assert "assignee" not in rendered


@pytest.mark.django_db
def test_direct_internal_escalation_maps_to_public_in_progress(api_client):
    requester = verified_user()
    operator = support_operator()
    support_request = SupportRequest.objects.create(
        submitter=requester,
        name="درخواست‌کننده",
        email=requester.email,
        intake_kind=IntakeKind.GENERAL,
        subject="نیازمند ارجاع",
        message="این درخواست مستقیم ارجاع می‌شود.",
        account_linked_at_intake=True,
    )
    triage_support_request(
        support_request=support_request,
        actor=operator,
        classification=None,
        priority=None,
        new_status=SupportRequestStatus.ESCALATED,
        escalation_destination="تیم تخصصی",
        required_capability=SupportRequiredCapability.GENERAL,
        reason="ارجاع داخلی مستقیم",
    )
    api_client.force_authenticate(requester)

    response = api_client.get(f"/api/v1/messages/{support_request.id}/")

    assert response.status_code == 200
    assert response.data["public_status"] == "in_progress"
    status_entries = [
        entry["status"] for entry in response.data["entries"] if entry["kind"] == "status"
    ]
    assert status_entries == ["received", "in_progress"]
    assert "ارجاع داخلی مستقیم" not in str(response.data)


@pytest.mark.django_db
def test_only_assigned_capable_operator_can_reply_and_reply_updates_feed_unread(api_client):
    requester = verified_user()
    assigned = support_operator()
    other = support_operator("other@example.com")
    support_request = SupportRequest.objects.create(
        submitter=requester,
        name="درخواست‌کننده",
        email=requester.email,
        intake_kind=IntakeKind.GENERAL,
        subject="مشکل حساب",
        message="پیام نخست درخواست‌کننده",
        account_linked_at_intake=True,
        requester_read_at=timezone.now(),
    )
    claim_support_request(support_request=support_request, actor=assigned)

    api_client.force_authenticate(other)
    forbidden = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/replies/",
        {"body": "پاسخ اپراتور دیگر"},
        format="json",
    )
    assert forbidden.status_code in (403, 409)

    api_client.force_authenticate(assigned)
    replied = api_client.post(
        f"/api/v1/operator/support-requests/{support_request.id}/replies/",
        {"body": "پاسخ روشن اپراتور"},
        format="json",
    )
    assert replied.status_code == 201
    assert replied.data["editable"] is True
    assert not SystemNotification.objects.exists()

    api_client.force_authenticate(requester)
    feed = api_client.get("/api/v1/messages/?kind=support_request")
    assert feed.data["results"][0]["id"] == str(support_request.id)
    assert feed.data["results"][0]["preview"] == "پاسخ روشن اپراتور"
    assert feed.data["results"][0]["read"] is False
    assert api_client.get("/api/v1/messages/unread-count/").data == {"count": 1}
    thread = api_client.get(f"/api/v1/messages/{support_request.id}/")
    assert [entry["body"] for entry in thread.data["entries"] if "body" in entry] == [
        "پیام نخست درخواست‌کننده",
        "پاسخ روشن اپراتور",
    ]


@pytest.mark.django_db
def test_requester_reply_reopens_recent_resolution_and_ordinary_messages_edit_for_15_minutes(
    api_client,
):
    requester = verified_user()
    support_request = SupportRequest.objects.create(
        submitter=requester,
        name="درخواست‌کننده",
        email=requester.email,
        intake_kind=IntakeKind.GENERAL,
        subject="مشکل حساب",
        message="پیام نخست درخواست‌کننده",
        account_linked_at_intake=True,
        status=SupportRequestStatus.RESOLVED,
        resolved_at=timezone.now() - timedelta(days=3),
    )
    api_client.force_authenticate(requester)

    replied = api_client.post(
        f"/api/v1/messages/support-requests/{support_request.id}/replies/",
        {"body": "مشکل هنوز حل نشده است"},
        format="json",
    )

    assert replied.status_code == 201
    support_request.refresh_from_db()
    assert support_request.status == SupportRequestStatus.OPEN
    operator = support_operator()
    api_client.force_authenticate(operator)
    queue = api_client.get("/api/v1/operator/support-requests/?status=open")
    assert str(support_request.id) in {item["id"] for item in queue.data["results"]}
    api_client.force_authenticate(requester)
    edited = api_client.patch(
        f"/api/v1/messages/support-requests/{support_request.id}/messages/{replied.data['id']}/",
        {"body": "مشکل هنوز به طور کامل حل نشده است"},
        format="json",
    )
    assert edited.status_code == 200
    assert edited.data["edited_at"] is not None

    support_request.messages.filter(id=replied.data["id"]).update(
        created_at=timezone.now() - timedelta(minutes=16)
    )
    expired = api_client.patch(
        f"/api/v1/messages/support-requests/{support_request.id}/messages/{replied.data['id']}/",
        {"body": "ویرایش دیرهنگام"},
        format="json",
    )
    assert expired.status_code == 409


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("resolved_ago", "reply_allowed", "reply_status"),
    [
        (timedelta(days=14) - timedelta(seconds=1), True, 201),
        (timedelta(days=14) + timedelta(seconds=1), False, 409),
    ],
)
def test_requester_reply_window_enforces_both_sides_of_the_14_day_boundary(
    api_client,
    resolved_ago: timedelta,
    reply_allowed: bool,
    reply_status: int,
):
    requester = verified_user()
    support_request = SupportRequest.objects.create(
        submitter=requester,
        name="درخواست‌کننده",
        email=requester.email,
        intake_kind=IntakeKind.GENERAL,
        subject="مرز زمانی",
        message="پیام نخست",
        account_linked_at_intake=True,
        status=SupportRequestStatus.RESOLVED,
        resolved_at=timezone.now() - resolved_ago,
    )
    api_client.force_authenticate(requester)

    detail = api_client.get(f"/api/v1/messages/{support_request.id}/")
    reply = api_client.post(
        f"/api/v1/messages/support-requests/{support_request.id}/replies/",
        {"body": "پیام در مرز زمانی"},
        format="json",
    )

    assert detail.status_code == 200
    assert detail.data["reply_allowed"] is reply_allowed
    assert reply.status_code == reply_status


@pytest.mark.django_db
def test_reopened_privacy_request_remains_isolated_to_privacy_operators(api_client):
    requester = verified_user()
    support_request = SupportRequest.objects.create(
        submitter=requester,
        name="درخواست‌کننده",
        email=requester.email,
        intake_kind=IntakeKind.ACCOUNT_DELETION,
        subject="حذف حساب",
        message="درخواست حذف حساب",
        account_linked_at_intake=True,
        classification=SupportClassification.ACCOUNT_DELETION,
        status=SupportRequestStatus.RESOLVED,
        resolved_at=timezone.now() - timedelta(days=2),
    )
    api_client.force_authenticate(requester)
    reopened = api_client.post(
        f"/api/v1/messages/support-requests/{support_request.id}/replies/",
        {"body": "درخواست من هنوز تکمیل نشده است."},
        format="json",
    )
    assert reopened.status_code == 201

    general_operator = support_operator()
    api_client.force_authenticate(general_operator)
    general_queue = api_client.get("/api/v1/operator/support-requests/")
    assert str(support_request.id) not in {item["id"] for item in general_queue.data["results"]}
    assert (
        api_client.get(f"/api/v1/operator/support-requests/{support_request.id}/").status_code
        == 404
    )
    assert (
        api_client.post(
            f"/api/v1/operator/support-requests/{support_request.id}/claim/"
        ).status_code
        == 404
    )

    privacy_operator = User.objects.create_user(
        email="privacy@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    privacy_operator.user_permissions.add(
        Permission.objects.get(codename="handle_privacy_support_requests")
    )
    api_client.force_authenticate(privacy_operator)
    privacy_queue = api_client.get("/api/v1/operator/support-requests/?status=open")
    assert str(support_request.id) in {item["id"] for item in privacy_queue.data["results"]}
    assert (
        api_client.post(
            f"/api/v1/operator/support-requests/{support_request.id}/claim/"
        ).status_code
        == 201
    )
    assert (
        api_client.post(
            f"/api/v1/operator/support-requests/{support_request.id}/replies/",
            {"body": "پیام اپراتور حریم خصوصی"},
            format="json",
        ).status_code
        == 201
    )


@pytest.mark.django_db
def test_legacy_anonymous_request_is_not_linked_by_matching_account_email(api_client):
    requester = verified_user("legacy@example.com")
    legacy = SupportRequest.objects.create(
        name="Legacy requester",
        email="legacy@example.com",
        intake_kind=IntakeKind.GENERAL,
        subject="درخواست قدیمی",
        message="این درخواست بدون حساب ثبت شده بود.",
    )
    api_client.force_authenticate(requester)

    feed = api_client.get("/api/v1/messages/?kind=support_request")
    detail = api_client.get(f"/api/v1/messages/{legacy.id}/")

    assert feed.status_code == 200
    assert str(legacy.id) not in {item["id"] for item in feed.data["results"]}
    assert detail.status_code == 404


@pytest.mark.django_db
def test_requester_cannot_reply_more_than_14_days_after_resolution(api_client):
    requester = verified_user()
    support_request = SupportRequest.objects.create(
        submitter=requester,
        name="درخواست‌کننده",
        email=requester.email,
        intake_kind=IntakeKind.GENERAL,
        subject="درخواست قدیمی",
        message="پیام نخست",
        account_linked_at_intake=True,
        status=SupportRequestStatus.RESOLVED,
        resolved_at=timezone.now() - timedelta(days=15),
    )
    api_client.force_authenticate(requester)

    response = api_client.post(
        f"/api/v1/messages/support-requests/{support_request.id}/replies/",
        {"body": "پاسخ خیلی دیر"},
        format="json",
    )

    assert response.status_code == 409
