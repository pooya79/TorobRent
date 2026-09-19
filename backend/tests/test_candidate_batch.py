from uuid import uuid4

import pytest

from apps.communications.models import SystemNotification
from apps.source_proposals.models import ExternalListingCandidate
from tests.test_extraction_publication import execute_run


@pytest.mark.django_db
@pytest.mark.parametrize(
    "action,reason", [("reject", ""), ("reject", "اطلاعات نادرست"), ("approve", "")]
)
def test_fifty_decisions_create_one_summary_and_keep_individual_audit(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks, action, reason
):
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    template = ExternalListingCandidate.objects.get(pk=run["candidates"][0]["id"])
    for index in range(40):
        template.pk = uuid4()
        template.external_url = f"https://khaneh.example/listing/batch-{index}"
        template.save(force_insert=True)
    candidates = list(ExternalListingCandidate.objects.filter(extraction_run_id=run["id"]))
    payload = {
        "action": action,
        "reason": reason,
        "confirmed": True,
        "items": [{"id": str(c.pk), "reviewed_revision": c.revision} for c in candidates],
    }
    url = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/results/decide/"
    response = api_client.post(url, payload, format="json")
    assert response.status_code == 200, response.data
    assert len(response.data["succeeded"]) == 50
    assert response.data["failed"] == []
    notices = SystemNotification.objects.filter(
        originating_candidate_event__candidate__in=candidates
    )
    notice = notices.get()
    assert notice.recipient == assigned_case[3]
    assert len(notice.candidate_batch_event_ids) == 50
    for candidate in candidates:
        candidate.refresh_from_db()
        assert candidate.state == ("rejected" if action == "reject" else "published")
        assert str(candidate.events.latest("created_at").pk) in notice.candidate_batch_event_ids
    # Replaying a completed batch must not duplicate either decisions or notifications.
    repeated = api_client.post(url, payload, format="json")
    assert repeated.status_code == 200
    assert repeated.data["succeeded"] == []
    assert len(repeated.data["failed"]) == 50
    assert notices.count() == 1
    api_client.force_authenticate(assigned_case[3])
    messages = api_client.get("/api/v1/messages/").json()["results"]
    summary = next(message for message in messages if message["id"] == str(notice.pk))
    title = "50 آگهی رد شد" if action == "reject" else "50 آگهی منتشر شد"
    assert summary["title"] == title
    assert summary["preview"] == (f"{title}. {reason}" if reason else f"{title}.")


@pytest.mark.django_db
def test_partial_batch_counts_only_success_and_checks_scope_and_permissions(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    items = [{"id": c["id"], "reviewed_revision": c["revision"]} for c in run["candidates"][:2]]
    url = f"/api/v1/operator/source-proposals/{assigned_case[0].pk}/results/decide/"
    payload = {"action": "reject", "items": items}
    api_client.force_authenticate(assigned_case[3])
    assert api_client.post(url, payload, format="json").status_code == 403
    api_client.force_authenticate(assigned_case[2])
    assert (
        api_client.post(url, {**payload, "items": [items[0], items[0]]}, format="json").status_code
        == 400
    )
    assert (
        api_client.post(
            url,
            {**payload, "items": [items[0], {"id": str(uuid4()), "reviewed_revision": 1}]},
            format="json",
        ).status_code
        == 400
    )
    assert api_client.post(url, {**payload, "action": "approve"}, format="json").status_code == 400
    items[1]["reviewed_revision"] += 1
    response = api_client.post(url, payload, format="json")
    assert response.status_code == 200
    assert response.data["succeeded"] == [items[0]["id"]]
    assert response.data["failed"][0]["id"] == items[1]["id"]
    notice = SystemNotification.objects.get(
        originating_candidate_event__candidate_id=items[0]["id"]
    )
    assert len(notice.candidate_batch_event_ids) == 1
    untouched = ExternalListingCandidate.objects.get(pk=items[1]["id"])
    assert untouched.state == "pending"
