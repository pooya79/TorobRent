import pytest


@pytest.mark.django_db
@pytest.mark.parametrize("mode", ["approval_required", "automatic"])
def test_representative_sees_assignment_and_immutable_approval_provenance(
    api_client, discovered_case, mode
):
    from apps.communications.models import SystemNotification
    from apps.source_proposals.models import SourceAssignment

    proposal, base, operator, representative, _ = discovered_case
    version = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    result = api_client.post(
        f"{base}/profile/approve/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": version["id"],
            "confirmed": True,
            "review_mode": mode,
        },
        format="json",
    )
    assert result.status_code == 200
    api_client.force_authenticate(representative)
    detail = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()
    assignment = detail["assignment"]
    assert assignment["state"] == "active"
    assert assignment["source"]["domain"] == "khaneh.example"
    assert assignment["source"]["display_name"] == "خانه‌یاب"
    assert assignment["active_profile_version"] == {"id": version["id"], "number": 1}
    assert assignment["review_mode"] == mode
    assert api_client.get("/api/v1/source-proposals/").json()[0]["assignment"] == assignment
    record = SourceAssignment.objects.get(pk=assignment["id"])
    assert str(record.approval.version_id) == version["id"]
    assert record.approval.representative == representative
    assert record.approval.event.actor == operator
    assert record.approval.version.reservation == proposal.reservations.get()
    assert record.approval.version.profile.source == record.source
    assert record.approval.event.new_state == "approved"
    assert SystemNotification.objects.filter(recipient=representative).count() == 1
    assert detail["history"][-1]["new_state"] == "approved"


@pytest.mark.django_db(transaction=True)
def test_existing_assignments_gain_approval_provenance_without_inventing_history():
    from datetime import timedelta

    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from django.utils import timezone

    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    old_target = [("source_proposals", "0009_sourceprofile_sourceprofilesnapshots_and_more")]
    new_target = [("source_proposals", "0010_sourceassignment_approval_and_more")]
    try:
        executor.migrate(old_target)
        apps = executor.loader.project_state(old_target).apps
        Source = apps.get_model("catalog", "Source")
        Proposal = apps.get_model("source_proposals", "SourceProposal")
        Assignment = apps.get_model("source_proposals", "SourceAssignment")
        User = apps.get_model("accounts", "User")
        representative = User.objects.create(email="migration-rep@example.com")
        operator = User.objects.create(email="migration-operator@example.com")
        source = Source.objects.create(
            name="migration", domain="migration.example", display_name="منبع قدیمی"
        )
        proposal = Proposal.objects.create(
            source=source, submitter=representative, state="approved"
        )
        reservation = apps.get_model("source_proposals", "SourceReservation").objects.create(
            source=source,
            proposal=proposal,
            revision=1,
            approved_url="https://migration.example/",
            expires_at=timezone.now() + timedelta(hours=1),
            released_at=timezone.now(),
            release_reason="approved",
        )
        profile = apps.get_model("source_proposals", "SourceProfile").objects.create(source=source)
        version = apps.get_model("source_proposals", "SourceProfileVersion").objects.create(
            profile=profile,
            reservation=reservation,
            number=1,
            rules={},
            structural_fingerprint="fp",
            validation={},
            samples=[],
            exclusions=[],
            pipeline_version="deterministic-profile-v1",
            provenance="discovery",
        )
        event = apps.get_model("source_proposals", "SourceProposalEvent").objects.create(
            proposal=proposal,
            actor=operator,
            revision=1,
            prior_state="pending",
            new_state="approved",
        )
        decision = apps.get_model("source_proposals", "SourceProfileDecision").objects.create(
            version=version, event=event, review_mode="automatic"
        )
        original = Assignment.objects.create(
            source=source, representative=representative, proposal=proposal
        )
        legacy_source = Source.objects.create(name="legacy", domain="legacy.example")
        legacy_proposal = Proposal.objects.create(
            source=legacy_source, submitter=representative, state="approved"
        )
        legacy = Assignment.objects.create(
            source=legacy_source, representative=representative, proposal=legacy_proposal
        )
        executor = MigrationExecutor(connection)
        executor.migrate(new_target)
        new_apps = executor.loader.project_state(new_target).apps
        Assignment = new_apps.get_model("source_proposals", "SourceAssignment")
        updated = Assignment.objects.get(pk=original.pk)
        assert updated.approval_id == decision.pk
        assert updated.approval.representative_id == representative.pk
        assert updated.created_at == original.created_at
        assert updated.approval.event.actor_id == operator.pk
        assert Assignment.objects.get(pk=legacy.pk).approval_id is None
    finally:
        MigrationExecutor(connection).migrate(latest)


@pytest.mark.django_db
@pytest.mark.parametrize("mode", [None, "", "unrestricted"])
def test_assignment_requires_an_explicit_supported_review_mode(api_client, discovered_case, mode):
    from apps.source_proposals.models import SourceAssignment

    proposal, base, _, _, _ = discovered_case
    version = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    payload = {"reviewed_revision": 1, "reviewed_profile_version": version["id"], "confirmed": True}
    if mode is not None:
        payload["review_mode"] = mode
    assert api_client.post(f"{base}/profile/approve/", payload, format="json").status_code == 400
    assert not SourceAssignment.objects.filter(proposal=proposal).exists()
    assert proposal.reservations.get().released_at is None
    assert proposal.review_claims.get().released_at is None


@pytest.mark.django_db
def test_assignment_is_private_and_approval_history_survives_account_deletion(
    api_client, discovered_case
):
    from django.core.exceptions import ValidationError

    from apps.source_proposals.models import SourceAssignment
    from tests.test_source_proposal_review import make_user

    proposal, base, operator, representative, _ = discovered_case
    version = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    response = api_client.post(
        f"{base}/profile/approve/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": version["id"],
            "confirmed": True,
            "review_mode": "automatic",
        },
        format="json",
    )
    assignment = SourceAssignment.objects.get(pk=response.data["assignment"]["id"])
    approval = assignment.approval
    with pytest.raises(ValidationError):
        type(approval).objects.filter(pk=approval.pk).update(representative=operator)
    api_client.force_authenticate(make_user(email="outsider@example.com", submitter=True))
    assert api_client.get("/api/v1/source-proposals/").json() == []
    assert api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").status_code == 404
    representative.delete()
    assignment.refresh_from_db()
    approval.refresh_from_db()
    assert assignment.representative is None
    assert approval.representative is None
    assert approval.version.reservation.proposal_id == proposal.pk
    assert approval.event.actor == operator
    assert approval.review_mode == "automatic"


@pytest.mark.django_db(transaction=True)
def test_simultaneous_approvals_create_one_assignment_and_one_notification(
    api_client, discovered_case
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    from apps.communications.models import SystemNotification
    from apps.source_proposals.models import SourceAssignment

    if connection.vendor != "postgresql":
        pytest.skip("Concurrent assignment approvals require PostgreSQL.")
    proposal, base, operator, representative, _ = discovered_case
    version = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    barrier = Barrier(2)

    def approve(mode):
        close_old_connections()
        client = APIClient()
        client.force_authenticate(operator)
        try:
            barrier.wait(timeout=10)
            return client.post(
                f"{base}/profile/approve/",
                {
                    "reviewed_revision": 1,
                    "reviewed_profile_version": version["id"],
                    "confirmed": True,
                    "review_mode": mode,
                },
                format="json",
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(approve, ["automatic", "approval_required"]))
    assert sorted(statuses) == [200, 409]
    assignment = SourceAssignment.objects.get(proposal=proposal)
    assert assignment.approval.review_mode == (
        "automatic" if statuses[0] == 200 else "approval_required"
    )
    assert proposal.events.filter(new_state="approved").count() == 1
    assert SystemNotification.objects.filter(recipient=representative).count() == 1
    assert assignment.source.profile.active_version_id == assignment.approval.version_id


@pytest.mark.django_db
def test_expired_reservation_cannot_create_assignment_or_approval_history(
    api_client, discovered_case
):
    from datetime import timedelta

    from django.utils import timezone

    from apps.source_proposals.models import SourceAssignment

    proposal, base, _, _, _ = discovered_case
    version = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    proposal.reservations.update(expires_at=timezone.now() - timedelta(seconds=1))
    result = api_client.post(
        f"{base}/profile/approve/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": version["id"],
            "confirmed": True,
            "review_mode": "automatic",
        },
        format="json",
    )
    assert result.status_code == 409
    assert result.data["code"] == "profile_reservation_expired"
    assert not SourceAssignment.objects.filter(proposal=proposal).exists()
    assert not proposal.events.filter(new_state="approved").exists()
