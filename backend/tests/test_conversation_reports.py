import pytest
from django.contrib.auth.models import Group, Permission
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.communications.models import (
    ConversationModerationEvent,
    ConversationReport,
    ConversationReportEvidenceHold,
    InquiryInitiationSuspension,
    ListingInquiry,
    ListingInquiryMessage,
    ModeratedPairRestriction,
)
from apps.communications.services import lock_listing_inquiry_message_edits
from tests.test_listing_inquiries import make_listing, verified_user


def start_inquiry(api_client: APIClient, *, renter: User, submitter: User):
    listing = make_listing(submitter=submitter)
    api_client.force_authenticate(renter)
    created = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(listing.id), "body": "پیام گزارش‌شده"},
        format="json",
    )
    assert created.status_code == 201
    return listing, created.data["id"], ListingInquiryMessage.objects.get()


@pytest.mark.django_db
def test_participant_reports_a_message_and_freezes_report_evidence(api_client: APIClient):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    _listing, inquiry_id, message = start_inquiry(api_client, renter=renter, submitter=submitter)
    api_client.force_authenticate(submitter)
    replied = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry_id}/replies/",
        {"body": "پاسخ پیرامونی"},
        format="json",
    )
    assert replied.status_code == 201
    surrounding_message = ListingInquiryMessage.objects.exclude(id=message.id).get()
    api_client.force_authenticate(renter)

    reported = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry_id}/reports/",
        {"message_id": str(message.id), "explanation": "این پیام توهین‌آمیز است."},
        format="json",
    )
    edited = api_client.patch(
        f"/api/v1/messages/listing-inquiries/{inquiry_id}/messages/{message.id}/",
        {"body": "متن تغییرکرده"},
        format="json",
    )

    assert reported.status_code == 201
    assert reported.data == {
        "id": ConversationReport.objects.get().id,
        "status": "pending",
        "target": "message",
        "created_at": reported.data["created_at"],
    }
    report = ConversationReport.objects.get()
    assert report.reporter == renter
    assert report.target_message == message
    assert report.explanation == "این پیام توهین‌آمیز است."
    assert report.evidence == {
        "inquiry_id": str(inquiry_id),
        "target_message_id": str(message.id),
        "participants": {
            "renter_id": str(renter.id),
            "submitter_id": str(submitter.id),
        },
        "messages": [
            {
                "id": str(message.id),
                "author_id": str(renter.id),
                "author_display_name": "رها",
                "body": "پیام گزارش‌شده",
                "created_at": message.created_at.isoformat().replace("+00:00", "Z"),
                "edited_at": None,
            },
            {
                "id": str(surrounding_message.id),
                "author_id": str(submitter.id),
                "author_display_name": "مالک",
                "body": "پاسخ پیرامونی",
                "created_at": surrounding_message.created_at.isoformat().replace("+00:00", "Z"),
                "edited_at": None,
            },
        ],
    }
    assert edited.status_code == 409
    assert edited.data["code"] == "listing_inquiry_message_edit_locked"
    message.refresh_from_db()
    assert message.body == "پیام گزارش‌شده"
    assert message.edit_locked_at is None
    assert message.conversation_report_evidence_holds.filter(report=report).exists()
    surrounding_message.refresh_from_db()
    assert surrounding_message.edit_locked_at is None
    assert surrounding_message.conversation_report_evidence_holds.filter(report=report).exists()


@pytest.mark.django_db
def test_message_report_freezes_only_a_bounded_surrounding_window(api_client: APIClient):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    _listing, inquiry_id, opening_message = start_inquiry(
        api_client, renter=renter, submitter=submitter
    )
    inquiry = ListingInquiry.objects.get(id=inquiry_id)
    messages = [opening_message]
    for index in range(1, 8):
        messages.append(
            ListingInquiryMessage.objects.create(
                inquiry=inquiry,
                author=submitter if index % 2 else renter,
                body=f"پیام {index}",
            )
        )
    target = messages[4]
    api_client.force_authenticate(renter)

    response = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry_id}/reports/",
        {"message_id": str(target.id)},
        format="json",
    )

    assert response.status_code == 201
    report = ConversationReport.objects.get(id=response.data["id"])
    expected_ids = [str(message.id) for message in messages[2:7]]
    assert [item["id"] for item in report.evidence["messages"]] == expected_ids
    assert set(
        ConversationReportEvidenceHold.objects.filter(report=report).values_list(
            "message_id", flat=True
        )
    ) == {message.id for message in messages[2:7]}
    assert not ConversationReportEvidenceHold.objects.filter(
        report=report,
        message=messages[0],
    ).exists()


@pytest.mark.django_db
def test_report_creation_enforces_participation_verification_and_target_membership(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    unrelated = verified_user("unrelated@example.com", "غریبه")
    unverified = User.objects.create_user(
        email="unverified@example.com",
        password="password",
        display_name="تأییدنشده",
    )
    _listing, inquiry_id, message = start_inquiry(api_client, renter=renter, submitter=submitter)
    report_url = f"/api/v1/messages/listing-inquiries/{inquiry_id}/reports/"

    api_client.force_authenticate(user=None)
    anonymous = api_client.post(report_url, {}, format="json")
    api_client.force_authenticate(unverified)
    unverified_response = api_client.post(report_url, {}, format="json")
    api_client.force_authenticate(unrelated)
    unrelated_response = api_client.post(report_url, {}, format="json")
    api_client.force_authenticate(submitter)
    invalid_target = api_client.post(
        report_url,
        {"message_id": "10000000-0000-4000-8000-000000000102"},
        format="json",
    )
    whole_inquiry = api_client.post(report_url, {}, format="json")

    assert anonymous.status_code in (401, 403)
    assert unverified_response.status_code == 403
    assert unrelated_response.status_code == 404
    assert invalid_target.status_code == 400
    assert invalid_target.data["errors"]["detail"][0]["code"] == (
        "conversation_report_target_invalid"
    )
    assert whole_inquiry.status_code == 201
    assert whole_inquiry.data["target"] == "inquiry"
    report = ConversationReport.objects.get(id=whole_inquiry.data["id"])
    assert report.reporter == submitter
    assert report.target_message is None
    assert report.evidence["target_message_id"] is None
    assert report.evidence["messages"][0]["id"] == str(message.id)


@pytest.mark.django_db
def test_only_conversation_moderators_can_open_report_evidence_and_access_is_audited(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    _listing, inquiry_id, message = start_inquiry(api_client, renter=renter, submitter=submitter)
    created = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry_id}/reports/",
        {"message_id": str(message.id)},
        format="json",
    )
    report = ConversationReport.objects.get(id=created.data["id"])

    support_operator = verified_user("support@example.com", "پشتیبان")
    support_operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    api_client.force_authenticate(support_operator)
    support_queue = api_client.get("/api/v1/operator/conversation-reports/")
    support_detail = api_client.get(f"/api/v1/operator/conversation-reports/{report.id}/")

    moderator = verified_user("moderator@example.com", "ناظر")
    moderator.groups.add(Group.objects.get(name="Conversation Moderator"))
    api_client.force_authenticate(moderator)
    queue = api_client.get("/api/v1/operator/conversation-reports/")
    detail = api_client.get(f"/api/v1/operator/conversation-reports/{report.id}/")
    second_inspection = api_client.get(f"/api/v1/operator/conversation-reports/{report.id}/")
    private_inquiry = api_client.get(f"/api/v1/messages/{inquiry_id}/")

    assert support_queue.status_code == support_detail.status_code == 403
    assert queue.status_code == 200
    assert queue.data["count"] == 1
    assert queue.data["results"] == [
        {
            "id": str(report.id),
            "status": "pending",
            "target": "message",
            "created_at": report.created_at.isoformat().replace("+00:00", "Z"),
        }
    ]
    assert detail.status_code == second_inspection.status_code == 200
    assert detail.data["id"] == str(report.id)
    assert detail.data["evidence"] == report.evidence
    assert detail.data["explanation"] == ""
    assert detail.data["reporter"]["display_name"] == "رها"
    assert [event["event_type"] for event in second_inspection.data["audit_history"]] == [
        "inspected",
        "inspected",
    ]
    assert private_inquiry.status_code == 404
    assert list(
        ConversationModerationEvent.objects.filter(report=report).values_list(
            "event_type", "actor_id"
        )
    ) == [("inspected", moderator.id), ("inspected", moderator.id)]
    event = ConversationModerationEvent.objects.filter(report=report).first()
    assert event is not None
    event.internal_note = "بازنویسی خاموش"
    with pytest.raises(ValidationError):
        event.save()
    with pytest.raises(ValidationError):
        event.delete()
    with pytest.raises(ValidationError):
        ConversationModerationEvent.objects.filter(report=report).update(
            internal_note="بازنویسی گروهی"
        )
    with pytest.raises(ValidationError):
        ConversationModerationEvent.objects.filter(report=report).delete()


@pytest.mark.django_db
def test_upheld_report_applies_audited_pair_and_initiation_restrictions(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    other_submitter = verified_user("other-submitter@example.com", "مالک دیگر")
    renter = verified_user("renter@example.com", "رها")
    listing, inquiry_id, _message = start_inquiry(api_client, renter=renter, submitter=submitter)
    other_listing = make_listing(
        submitter=other_submitter,
        property_=listing.property,
    )
    created = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry_id}/reports/",
        {"explanation": "کل گفت‌وگو را بررسی کنید."},
        format="json",
    )
    report = ConversationReport.objects.get(id=created.data["id"])

    moderator = verified_user("moderator@example.com", "ناظر")
    moderator.groups.add(Group.objects.get(name="Conversation Moderator"))
    api_client.force_authenticate(moderator)
    decision = api_client.post(
        f"/api/v1/operator/conversation-reports/{report.id}/decision/",
        {
            "decision": "upheld",
            "internal_note": "الگوی آزار تأیید شد.",
            "restrict_pair": True,
            "suspend_account_id": str(renter.id),
        },
        format="json",
    )

    api_client.force_authenticate(renter)
    blocked_reply = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry_id}/replies/",
        {"body": "پیام پس از تصمیم"},
        format="json",
    )
    blocked_phone = api_client.post(
        f"/api/v1/catalog/listings/{listing.id}/phone-reveal/",
        {},
        format="json",
        HTTP_X_TOROBRENT_EVENT_SESSION="10000000-0000-4000-8000-000000000102",
    )
    suspended_initiation = api_client.post(
        "/api/v1/messages/listing-inquiries/",
        {"listing_id": str(other_listing.id), "body": "گفت‌وگوی تازه"},
        format="json",
    )
    existing_history = api_client.get(f"/api/v1/messages/{inquiry_id}/")

    assert decision.status_code == 200
    assert decision.data == {
        "id": str(report.id),
        "status": "upheld",
        "pair_restricted": True,
        "suspended_account_id": str(renter.id),
        "decided_at": decision.data["decided_at"],
    }
    assert blocked_reply.status_code == 400
    assert blocked_reply.data["errors"]["detail"][0]["code"] == "account_blocked"
    assert blocked_phone.status_code == 403
    assert suspended_initiation.status_code == 400
    assert suspended_initiation.data["errors"]["detail"][0]["code"] == (
        "inquiry_initiation_suspended"
    )
    assert existing_history.status_code == 200
    assert existing_history.data["entries"][0]["body"] == "پیام گزارش‌شده"
    assert ModeratedPairRestriction.objects.filter(report=report).exists()
    assert InquiryInitiationSuspension.objects.filter(report=report, account=renter).exists()
    assert list(
        ConversationModerationEvent.objects.filter(report=report).values_list(
            "event_type", flat=True
        )
    ) == ["upheld", "pair_restricted", "initiation_suspended"]
    report.refresh_from_db()
    assert report.status == "upheld"
    assert report.decided_by == moderator
    assert report.internal_note == "الگوی آزار تأیید شد."


@pytest.mark.django_db
def test_dismissed_report_cannot_apply_restrictions_or_be_decided_twice(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    _listing, inquiry_id, message = start_inquiry(api_client, renter=renter, submitter=submitter)
    created = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry_id}/reports/", {}, format="json"
    )
    report = ConversationReport.objects.get(id=created.data["id"])
    moderator = verified_user("moderator@example.com", "ناظر")
    moderator.groups.add(Group.objects.get(name="Conversation Moderator"))
    api_client.force_authenticate(moderator)
    decision_url = f"/api/v1/operator/conversation-reports/{report.id}/decision/"

    invalid = api_client.post(
        decision_url,
        {"decision": "dismissed", "restrict_pair": True},
        format="json",
    )
    dismissed = api_client.post(
        decision_url,
        {"decision": "dismissed", "internal_note": "شواهد کافی نیست."},
        format="json",
    )
    repeated = api_client.post(
        decision_url,
        {"decision": "upheld"},
        format="json",
    )
    api_client.force_authenticate(renter)
    edit_after_dismissal = api_client.patch(
        f"/api/v1/messages/listing-inquiries/{inquiry_id}/messages/{message.id}/",
        {"body": "اصلاح پس از رد گزارش"},
        format="json",
    )

    assert invalid.status_code == 400
    assert dismissed.status_code == 200
    assert dismissed.data["status"] == "dismissed"
    assert dismissed.data["pair_restricted"] is False
    assert dismissed.data["suspended_account_id"] is None
    assert repeated.status_code == 400
    assert edit_after_dismissal.status_code == 200
    assert edit_after_dismissal.data["body"] == "اصلاح پس از رد گزارش"
    assert not ModeratedPairRestriction.objects.exists()
    assert not InquiryInitiationSuspension.objects.exists()
    assert list(
        ConversationModerationEvent.objects.filter(report=report).values_list(
            "event_type", flat=True
        )
    ) == ["dismissed", "evidence_released"]


@pytest.mark.django_db
def test_dismissal_releases_only_report_owned_holds_and_redacts_private_evidence(
    api_client: APIClient,
):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    _listing, inquiry_id, message = start_inquiry(api_client, renter=renter, submitter=submitter)
    lock_listing_inquiry_message_edits(message=message)
    created = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry_id}/reports/",
        {"message_id": str(message.id)},
        format="json",
    )
    report = ConversationReport.objects.get(id=created.data["id"])
    moderator = verified_user("moderator@example.com", "ناظر")
    moderator.groups.add(Group.objects.get(name="Conversation Moderator"))
    api_client.force_authenticate(moderator)

    dismissed = api_client.post(
        f"/api/v1/operator/conversation-reports/{report.id}/decision/",
        {"decision": "dismissed"},
        format="json",
    )

    assert dismissed.status_code == 200
    report.refresh_from_db()
    message.refresh_from_db()
    assert report.inquiry is None
    assert report.target_message is None
    assert report.reporter is None
    assert report.evidence is None
    assert report.evidence_retention_status == "released"
    assert report.evidence_released_at is not None
    assert report.reporter_display_name_snapshot == ""
    assert message.edit_locked_at is not None
    assert not ConversationReportEvidenceHold.objects.filter(report=report).exists()
    ListingInquiry.objects.get(id=inquiry_id).delete()
    detail = api_client.get(f"/api/v1/operator/conversation-reports/{report.id}/")
    assert detail.status_code == 200
    assert detail.data["evidence"] is None
    assert detail.data["target"] == "message"
    assert detail.data["reporter"] == {"display_name": "حذف‌شده"}


@pytest.mark.django_db
def test_required_evidence_hold_can_be_released_with_a_durable_audit(api_client: APIClient):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    _listing, inquiry_id, message = start_inquiry(api_client, renter=renter, submitter=submitter)
    created = api_client.post(
        f"/api/v1/messages/listing-inquiries/{inquiry_id}/reports/",
        {"message_id": str(message.id)},
        format="json",
    )
    report = ConversationReport.objects.get(id=created.data["id"])
    moderator = verified_user("moderator@example.com", "ناظر")
    moderator.groups.add(Group.objects.get(name="Conversation Moderator"))
    api_client.force_authenticate(moderator)
    decision_url = f"/api/v1/operator/conversation-reports/{report.id}/decision/"
    release_url = f"/api/v1/operator/conversation-reports/{report.id}/evidence-release/"

    upheld = api_client.post(decision_url, {"decision": "upheld"}, format="json")
    report.refresh_from_db()
    frozen_evidence = report.evidence

    assert upheld.status_code == 200
    assert report.evidence_retention_status == "required"
    assert frozen_evidence is not None
    assert ConversationReportEvidenceHold.objects.filter(report=report).exists()
    released = api_client.post(
        release_url,
        {"internal_note": "دوره نگهداری لازم پایان یافت."},
        format="json",
    )
    assert released.status_code == 200
    report.refresh_from_db()
    assert report.evidence is None
    assert report.evidence_retention_status == "released"
    assert report.evidence_released_at is not None
    assert not ConversationReportEvidenceHold.objects.filter(report=report).exists()
    release_event = report.moderation_events.get(event_type="evidence_released")
    assert release_event.actor == moderator
    assert release_event.internal_note == "دوره نگهداری لازم پایان یافت."
    repeated = api_client.post(release_url, {}, format="json")
    assert repeated.status_code == 400


@pytest.mark.django_db
def test_repeated_restrictions_audit_only_actions_created_by_the_report(api_client: APIClient):
    submitter = verified_user("submitter@example.com", "مالک")
    renter = verified_user("renter@example.com", "رها")
    _listing, inquiry_id, _message = start_inquiry(api_client, renter=renter, submitter=submitter)
    report_url = f"/api/v1/messages/listing-inquiries/{inquiry_id}/reports/"
    first = api_client.post(report_url, {}, format="json")
    second = api_client.post(report_url, {}, format="json")
    moderator = verified_user("moderator@example.com", "ناظر")
    moderator.groups.add(Group.objects.get(name="Conversation Moderator"))
    api_client.force_authenticate(moderator)
    payload = {
        "decision": "upheld",
        "restrict_pair": True,
        "suspend_account_id": str(renter.id),
    }

    first_decision = api_client.post(
        f"/api/v1/operator/conversation-reports/{first.data['id']}/decision/",
        payload,
        format="json",
    )
    second_decision = api_client.post(
        f"/api/v1/operator/conversation-reports/{second.data['id']}/decision/",
        payload,
        format="json",
    )

    assert first_decision.data["pair_restricted"] is True
    assert first_decision.data["suspended_account_id"] == str(renter.id)
    assert second_decision.data["pair_restricted"] is False
    assert second_decision.data["suspended_account_id"] is None
    second_report = ConversationReport.objects.get(id=second.data["id"])
    assert list(second_report.moderation_events.values_list("event_type", flat=True)) == ["upheld"]
    assert not hasattr(second_report, "pair_restriction")
    assert not second_report.initiation_suspensions.exists()
