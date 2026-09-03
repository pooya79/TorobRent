from unittest.mock import patch

import pytest
from django.core.exceptions import ValidationError
from django.db import transaction

from apps.communications.models import SystemNotification
from apps.communications.services import create_source_proposal_review_notification
from apps.source_proposals.models import SourceProposalEvent
from apps.source_proposals.services import (
    claim_source_proposal_review,
    reject_source_proposal,
    request_source_proposal_changes,
)
from tests.test_source_proposal_review import make_operator, make_pending_proposal, make_user


@pytest.mark.django_db
def test_source_proposal_outcome_creates_a_notification_in_the_decision_transaction():
    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    operator = make_operator()
    claim_source_proposal_review(proposal=proposal, actor=operator)

    request_source_proposal_changes(
        proposal=proposal,
        actor=operator,
        reviewed_revision=proposal.revision,
        reason="مدرک نمایندگی را تکمیل کنید.",
    )

    notification = SystemNotification.objects.get()
    assert notification.recipient == representative
    assert notification.originating_source_proposal_event.new_state == "changes_requested"
    assert notification.target_source_proposal == proposal


@pytest.mark.django_db
def test_rolled_back_source_proposal_outcome_leaves_no_notification():
    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    operator = make_operator()
    claim_source_proposal_review(proposal=proposal, actor=operator)

    with pytest.raises(RuntimeError, match="roll back"), transaction.atomic():
        reject_source_proposal(
            proposal=proposal,
            actor=operator,
            reviewed_revision=proposal.revision,
            reason="منبع قابل تایید نیست.",
        )
        raise RuntimeError("roll back")

    assert not SystemNotification.objects.exists()


@pytest.mark.django_db
def test_source_proposal_notification_is_idempotent_and_immutable():
    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    event = SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=representative,
        revision=proposal.revision,
        prior_state="pending",
        new_state="rejected",
        reason="منبع قابل تایید نیست.",
    )

    first = create_source_proposal_review_notification(event)
    second = create_source_proposal_review_notification(event)

    assert first == second
    assert SystemNotification.objects.count() == 1
    first.target_source_proposal = None
    with pytest.raises(ValidationError, match="immutable"):
        first.save()
    with pytest.raises(ValidationError, match="immutable"):
        first.delete()


@pytest.mark.django_db
def test_source_proposal_notifications_share_feed_behavior_and_isolate_recipients(api_client):
    representative = make_user(email="representative@example.com", submitter=True)
    other = make_user(email="other@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    event = SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=representative,
        revision=proposal.revision,
        prior_state="pending",
        new_state="rejected",
        reason="مالکیت دامنه اثبات نشد.",
    )
    notification = create_source_proposal_review_notification(event)

    api_client.force_authenticate(other)
    assert api_client.get("/api/v1/messages/").data["count"] == 0
    assert api_client.get(f"/api/v1/messages/{notification.id}/").status_code == 404

    api_client.force_authenticate(representative)
    feed = api_client.get("/api/v1/messages/")
    assert feed.status_code == 200
    assert feed.data["results"][0]["group"] == {
        "kind": "source_proposal",
        "id": str(proposal.id),
        "label": "خانه‌یاب",
    }
    assert api_client.get("/api/v1/messages/unread-count/").data == {"count": 1}

    detail = api_client.get(f"/api/v1/messages/{notification.id}/")
    assert detail.data["title"] == "منبع پیشنهادی شما رد شد"
    assert detail.data["body"] == "مالکیت دامنه اثبات نشد."
    assert detail.data["target"] == {
        "label": "مشاهده منبع پیشنهادی",
        "href": f"/source-proposal?proposal={proposal.id}",
    }
    assert api_client.get("/api/v1/messages/unread-count/").data == {"count": 0}

    unread = api_client.patch(
        f"/api/v1/messages/{notification.id}/", {"read": False}, format="json"
    )
    assert unread.data["read"] is False

    representative.is_submitter = False
    representative.save(update_fields=("is_submitter",))
    unavailable = api_client.get(f"/api/v1/messages/{notification.id}/")
    assert unavailable.status_code == 200
    assert unavailable.data["body"] == "مالکیت دامنه اثبات نشد."
    assert unavailable.data["target"] is None


@pytest.mark.django_db
def test_only_meaningful_source_proposal_outcomes_create_notifications():
    representative = make_user(email="representative@example.com", submitter=True)
    proposal = make_pending_proposal(submitter=representative)
    pending_event = SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=representative,
        revision=proposal.revision,
        prior_state="draft",
        new_state="pending",
    )

    with patch("apps.communications.services.SystemNotification.objects.get_or_create") as create:
        create_source_proposal_review_notification(pending_event)

    create.assert_not_called()
