import pytest

from tests.test_source_proposal_review import make_operator, make_pending_proposal, make_user


@pytest.mark.django_db
def test_source_conversation_reply_notifies_without_deciding_proposal(api_client):
    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    operator = make_operator()
    api_client.force_authenticate(representative)
    before = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()
    opened = api_client.post(
        "/api/v1/messages/source-conversations/", {"proposal_id": str(proposal.pk)}, format="json"
    )
    assert opened.status_code == 200, opened.content
    conversation_id = opened.json()["id"]
    replies = f"/api/v1/messages/source-conversations/{conversation_id}/replies/"
    assert (
        api_client.post(replies, {"body": "لطفا راهنمایی کنید"}, format="json").status_code == 201
    )
    api_client.force_authenticate(operator)
    feed = api_client.get("/api/v1/messages/?kind=source_conversation&unread=true").json()
    assert [item["id"] for item in feed["results"]] == [conversation_id]
    assert api_client.get("/api/v1/messages/unread-count/").json()["count"] == 1
    detail = api_client.get(
        opened.json()["href"].replace("/messages/", "/api/v1/messages/") + "/"
    ).json()
    assert detail["entries"][0]["body"] == "لطفا راهنمایی کنید"
    assert detail["reply_allowed"] is True
    assert api_client.get("/api/v1/messages/unread-count/").json()["count"] == 0
    assert (
        api_client.post(replies, {"body": "نمونه نشانی را بفرستید"}, format="json").status_code
        == 201
    )
    api_client.force_authenticate(representative)
    detail = api_client.get(f"/api/v1/messages/{conversation_id}/").json()
    assert detail["kind"] == "source_conversation"
    assert detail["entries"][-1]["author_name"] == "تیم بررسی منبع"
    assert operator.email not in str(detail)
    assert str(operator.pk) not in str(detail)
    assert api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json() == before
    assert api_client.get("/api/v1/messages/?kind=system_notification").json()["count"] == 0
    assert (
        api_client.post(
            "/api/v1/messages/source-conversations/",
            {"proposal_id": str(proposal.pk)},
            format="json",
        ).json()["id"]
        == conversation_id
    )


@pytest.mark.django_db
@pytest.mark.parametrize(
    "outsider_kind", ["representative", "support", "moderator", "queue", "revoked"]
)
def test_source_conversation_is_private_across_every_message_endpoint(api_client, outsider_kind):
    from django.contrib.auth.models import Permission

    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    api_client.force_authenticate(representative)
    conversation = api_client.post(
        "/api/v1/messages/source-conversations/", {"proposal_id": str(proposal.pk)}, format="json"
    ).json()
    outsider = (
        make_operator(email="outsider@example.com")
        if outsider_kind == "revoked"
        else make_user(email="outsider@example.com", submitter=True)
    )
    permissions = {
        "support": "handle_general_support_requests",
        "moderator": "moderate_conversation_reports",
        "queue": "manage_operator_queue",
    }
    if outsider_kind in permissions:
        outsider.user_permissions.add(Permission.objects.get(codename=permissions[outsider_kind]))
    if outsider_kind == "revoked":
        outsider.get_all_permissions()
        outsider.user_permissions.clear()
    api_client.force_authenticate(outsider)
    base = f"/api/v1/messages/{conversation['id']}/"
    assert api_client.get(base).status_code == 404
    assert api_client.patch(base, {"read": False}, format="json").status_code == 404
    assert (
        api_client.post(
            f"/api/v1/messages/source-conversations/{conversation['id']}/replies/",
            {"body": "private"},
            format="json",
        ).status_code
        == 404
    )
    assert (
        api_client.post(
            "/api/v1/messages/source-conversations/",
            {"proposal_id": str(proposal.pk)},
            format="json",
        ).status_code
        == 404
    )
    assert api_client.get("/api/v1/messages/").json()["count"] == 0
    assert api_client.get("/api/v1/messages/unread-count/").json()["count"] == 0


@pytest.mark.django_db
def test_approved_conversation_follows_responsibility_and_preserves_decisions(
    api_client, assigned_case
):
    from tests.test_source_responsibility import queue_manager, reassign

    proposal, _, original, representative, _ = assigned_case
    api_client.force_authenticate(representative)
    before = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()
    decisions = api_client.get("/api/v1/messages/?kind=system_notification").json()
    opened = api_client.post(
        "/api/v1/messages/source-conversations/", {"proposal_id": str(proposal.pk)}, format="json"
    ).json()
    detail_url = f"/api/v1/messages/{opened['id']}/"
    reply_url = f"/api/v1/messages/source-conversations/{opened['id']}/replies/"
    assert api_client.post(reply_url, {"body": "پس از تایید"}, format="json").status_code == 201
    successor = make_operator(email="successor@example.com")
    api_client.force_authenticate(successor)
    assert api_client.get(detail_url).status_code == 404
    api_client.force_authenticate(original)
    assert api_client.get("/api/v1/messages/?unread=true").json()["count"] == 1
    api_client.force_authenticate(queue_manager())
    assert reassign(api_client, proposal, successor).status_code == 200
    api_client.force_authenticate(original)
    assert api_client.get(detail_url).status_code == 404
    assert api_client.post(reply_url, {"body": "stale"}, format="json").status_code == 404
    assert api_client.get("/api/v1/messages/unread-count/").json()["count"] == 0
    api_client.force_authenticate(successor)
    assert api_client.get("/api/v1/messages/?unread=true").json()["count"] == 1
    detail = api_client.get(detail_url).json()
    assert detail["entries"][0]["body"] == "پس از تایید"
    assert detail["reply_allowed"] is True
    assert api_client.post(reply_url, {"body": "پاسخ مسئول تازه"}, format="json").status_code == 201
    api_client.force_authenticate(representative)
    after = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()
    for field in ("state", "revision", "history", "profile_versions", "publication_mode"):
        assert after.get(field) == before.get(field)
    assert api_client.get("/api/v1/messages/?kind=system_notification").json() == decisions
    assert (
        api_client.get("/api/v1/messages/?kind=source_conversation&unread=true").json()["count"]
        == 1
    )
    assert api_client.delete(detail_url).status_code == 405


@pytest.mark.django_db
def test_deleted_representative_retains_history_but_stops_replies(api_client):
    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    operator = make_operator()
    api_client.force_authenticate(representative)
    opened = api_client.post(
        "/api/v1/messages/source-conversations/", {"proposal_id": str(proposal.pk)}, format="json"
    ).json()
    replies = f"/api/v1/messages/source-conversations/{opened['id']}/replies/"
    api_client.post(replies, {"body": "keep context"}, format="json")
    representative.delete()
    api_client.force_authenticate(operator)
    detail = api_client.get(f"/api/v1/messages/{opened['id']}/").json()
    assert detail["entries"][0]["body"] == "keep context"
    assert detail["reply_allowed"] is False
    assert api_client.post(replies, {"body": "no recipient"}, format="json").status_code == 409


@pytest.mark.django_db
def test_operator_can_open_conversation_and_redaction_retains_context(api_client, client):
    from apps.accounts.models import User

    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    operator = make_operator()
    api_client.force_authenticate(operator)
    opened = api_client.post(
        "/api/v1/messages/source-conversations/", {"proposal_id": str(proposal.pk)}, format="json"
    )
    assert opened.status_code == 200
    conversation_id = opened.json()["id"]
    reply = api_client.post(
        f"/api/v1/messages/source-conversations/{conversation_id}/replies/",
        {"body": "personal details"},
        format="json",
    ).json()
    admin_url = "/admin/communications/sourceconversationmessage/"
    operator.is_staff = True
    operator.save()
    client.force_login(operator)
    assert client.get(admin_url).status_code == 403
    superuser = User.objects.create_superuser(email="privacy@example.com", password="password")
    client.force_login(superuser)
    response = client.post(
        admin_url, {"action": "redact_personal_content", "_selected_action": [reply["id"]]}
    )
    assert response.status_code == 302
    api_client.force_authenticate(representative)
    detail = api_client.get(f"/api/v1/messages/{conversation_id}/").json()
    assert detail["entries"][0]["body"] == "[Personal content redacted]"
    assert detail["entries"][0]["id"] == reply["id"]
    assert detail["entries"][0]["created_at"] == reply["created_at"]
    assert superuser.email not in str(detail)


@pytest.mark.django_db
def test_message_center_can_start_only_accessible_source_conversations(api_client):
    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    other = make_user(email="other@example.com", submitter=True)
    make_pending_proposal(submitter=other, domain="other.example")
    api_client.force_authenticate(representative)
    options = api_client.get("/api/v1/messages/source-conversations/")
    assert options.status_code == 200
    assert options.json() == [
        {"proposal_id": str(proposal.pk), "website_name": "خانه‌یاب", "operator": False}
    ]


@pytest.mark.django_db
def test_pending_reply_routes_to_current_review_claim(api_client):
    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    reviewer = make_operator()
    other = make_operator(email="other-reviewer@example.com")
    api_client.force_authenticate(reviewer)
    assert (
        api_client.post(f"/api/v1/operator/source-proposals/{proposal.pk}/claim/", {}).status_code
        == 201
    )
    api_client.force_authenticate(representative)
    opened = api_client.post(
        "/api/v1/messages/source-conversations/", {"proposal_id": str(proposal.pk)}, format="json"
    ).json()
    api_client.post(
        f"/api/v1/messages/source-conversations/{opened['id']}/replies/",
        {"body": "for reviewer"},
        format="json",
    )
    api_client.force_authenticate(reviewer)
    assert api_client.get("/api/v1/messages/unread-count/").json()["count"] == 1
    api_client.force_authenticate(other)
    assert api_client.get("/api/v1/messages/unread-count/").json()["count"] == 0


@pytest.mark.django_db(transaction=True)
def test_concurrent_open_and_replies_preserve_one_source_thread(api_client):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    if connection.vendor != "postgresql":
        pytest.skip("Concurrent source messaging requires PostgreSQL")
    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    operator = make_operator()
    barrier = Barrier(2)

    def send(actor):
        close_old_connections()
        client = APIClient()
        client.force_authenticate(actor)
        try:
            barrier.wait(timeout=10)
            opened = client.post(
                "/api/v1/messages/source-conversations/",
                {"proposal_id": str(proposal.pk)},
                format="json",
            )
            assert opened.status_code == 200, opened.content
            conversation_id = opened.json()["id"]
            response = client.post(
                f"/api/v1/messages/source-conversations/{conversation_id}/replies/",
                {"body": "parallel message"},
                format="json",
            )
            assert response.status_code == 201, response.content
            return conversation_id
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(send, [representative, operator]))
    assert ids[0] == ids[1]
    api_client.force_authenticate(representative)
    detail = api_client.get(f"/api/v1/messages/{ids[0]}/").json()
    assert len(detail["entries"]) == 2
    assert api_client.get("/api/v1/messages/").json()["count"] == 1


@pytest.mark.django_db
def test_conversation_stays_available_while_correcting_requested_changes(api_client):
    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    operator = make_operator()
    api_client.force_authenticate(operator)
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    assert api_client.post(f"{base}/claim/", {}).status_code == 201
    assert (
        api_client.post(
            f"{base}/request-changes/",
            {"reviewed_revision": 1, "reason": "اصلاح نشانی"},
            format="json",
        ).status_code
        == 200
    )
    api_client.force_authenticate(representative)
    opened = api_client.post(
        "/api/v1/messages/source-conversations/", {"proposal_id": str(proposal.pk)}, format="json"
    ).json()
    edited = api_client.patch(
        f"/api/v1/source-proposals/{proposal.pk}/draft/",
        {"website_name": "نام اصلاح‌شده"},
        format="json",
    )
    assert edited.status_code == 200
    assert edited.json()["state"] == "draft"
    assert api_client.get(f"/api/v1/messages/{opened['id']}/").status_code == 200
    assert (
        api_client.post(
            f"/api/v1/messages/source-conversations/{opened['id']}/replies/",
            {"body": "آیا نشانی درست است؟"},
            format="json",
        ).status_code
        == 201
    )
    api_client.force_authenticate(operator)
    assert (
        api_client.get(f"/api/v1/messages/{opened['id']}/").json()["entries"][-1]["body"]
        == "آیا نشانی درست است؟"
    )
    assert (
        api_client.get(f"/api/v1/operator/source-proposals/?proposal={proposal.pk}").json()[0][
            "state"
        ]
        == "draft"
    )
