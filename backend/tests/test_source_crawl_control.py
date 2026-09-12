from datetime import UTC, datetime, timedelta

import pytest
from django.utils import timezone

from apps.catalog.models import Source
from apps.source_proposals.models import SourceExclusion
from apps.source_proposals.tasks import dispatch_scheduled_crawls


def control(client, case, **body):
    proposal, _, operator, _, _ = case
    client.force_authenticate(operator)
    return client.post(
        f"/api/v1/operator/source-proposals/{proposal.pk}/crawl/", body, format="json"
    )


def operator_case(client, case):
    client.force_authenticate(case[2])
    response = client.get("/api/v1/operator/source-proposals/", {"proposal": str(case[0].pk)})
    assert response.status_code == 200
    return next(item for item in response.json() if item["id"] == str(case[0].pk))


def due_source(case):
    proposal = case[0]
    proposal.refresh_from_db()
    source = Source.objects.get(pk=proposal.source_id)
    source.crawl_interval_hours = 6
    source.next_crawl_at = timezone.now() - timedelta(minutes=1)
    source.save()
    return source


@pytest.fixture(autouse=True)
def queued_worker_delivery(monkeypatch):
    # These API/scheduler tests observe queued requests; worker execution has separate coverage.
    monkeypatch.setattr("apps.source_proposals.tasks.extract_source.delay", lambda *args: None)


@pytest.fixture
def fixed_clock(monkeypatch):
    now = datetime(2026, 9, 12, 12, tzinfo=UTC)
    monkeypatch.setattr(timezone, "now", lambda: now)
    return now


@pytest.mark.django_db
def test_operator_schedule_survives_a_new_read(api_client, assigned_case, fixed_clock):
    response = control(
        api_client, assigned_case, action="schedule", interval_hours=6, reviewed_schedule_revision=0
    )
    assert response.status_code == 200, response.content
    source = operator_case(api_client, assigned_case)["assignment"]["source"]
    assert source["crawl_interval_hours"] == 6
    assert source["crawl_schedule_revision"] == 1
    assert source["next_crawl_at"] == "2026-09-12T18:00:00Z"


@pytest.mark.django_db
def test_operator_schedule_change_appears_in_history(api_client, assigned_case):
    assert (
        control(
            api_client,
            assigned_case,
            action="schedule",
            interval_hours=6,
            reviewed_schedule_revision=0,
        ).status_code
        == 200
    )
    event = operator_case(api_client, assigned_case)["history"][-1]
    assert event["reason"] == "برنامه دریافت صفحات: هر 6 ساعت"
    assert event["actor_label"] == assigned_case[2].email


@pytest.mark.django_db
def test_stale_schedule_change_preserves_current_schedule(api_client, assigned_case):
    assert (
        control(
            api_client,
            assigned_case,
            action="schedule",
            interval_hours=6,
            reviewed_schedule_revision=0,
        ).status_code
        == 200
    )
    before = operator_case(api_client, assigned_case)["assignment"]["source"]
    response = control(
        api_client,
        assigned_case,
        action="schedule",
        interval_hours=24,
        reviewed_schedule_revision=0,
    )
    assert response.status_code == 409
    assert operator_case(api_client, assigned_case)["assignment"]["source"] == before


@pytest.mark.django_db
def test_unsupported_schedule_interval_is_rejected(api_client, assigned_case):
    before = operator_case(api_client, assigned_case)["assignment"]["source"]
    response = control(
        api_client, assigned_case, action="schedule", interval_hours=2, reviewed_schedule_revision=0
    )
    assert response.status_code == 400
    assert operator_case(api_client, assigned_case)["assignment"]["source"] == before


@pytest.mark.django_db
def test_operator_can_switch_to_manual_only(api_client, assigned_case):
    assert (
        control(
            api_client,
            assigned_case,
            action="schedule",
            interval_hours=6,
            reviewed_schedule_revision=0,
        ).status_code
        == 200
    )
    response = control(
        api_client, assigned_case, action="schedule", interval_hours=0, reviewed_schedule_revision=1
    )
    assert response.status_code == 200
    source = operator_case(api_client, assigned_case)["assignment"]["source"]
    assert source["crawl_interval_hours"] == 0
    assert source["next_crawl_at"] is None


@pytest.mark.django_db
def test_manual_crawl_uses_current_representative(api_client, assigned_case):
    url = assigned_case[0].website_url.rstrip("/") + "/more"
    response = control(api_client, assigned_case, action="run", url=url)
    assert response.status_code == 200, response.content
    requests = operator_case(api_client, assigned_case)["assignment"]["recent_requests"]
    request = next(item for item in requests if item["submitted_url"] == url)
    assert request["requester"] == str(assigned_case[3].pk)


@pytest.mark.django_db
def test_manual_crawl_reuses_pending_request(api_client, assigned_case):
    url = assigned_case[0].website_url.rstrip("/") + "/more"
    assert control(api_client, assigned_case, action="run", url=url).status_code == 200
    first = operator_case(api_client, assigned_case)["assignment"]["recent_requests"]
    assert control(api_client, assigned_case, action="run", url=url).status_code == 200
    second = operator_case(api_client, assigned_case)["assignment"]["recent_requests"]
    assert [item["id"] for item in second] == [item["id"] for item in first]
    assert sum(item["submitted_url"] == url for item in second) == 1


@pytest.mark.django_db
def test_manual_crawl_rejects_another_domain(api_client, assigned_case):
    before = operator_case(api_client, assigned_case)["assignment"]["recent_requests"]
    response = control(api_client, assigned_case, action="run", url="https://other.example.com/")
    assert response.status_code == 400
    assert operator_case(api_client, assigned_case)["assignment"]["recent_requests"] == before


@pytest.mark.django_db
def test_representative_cannot_use_operator_crawl_control(api_client, assigned_case):
    proposal, _, _, representative, _ = assigned_case
    api_client.force_authenticate(representative)
    response = api_client.post(
        f"/api/v1/operator/source-proposals/{proposal.pk}/crawl/", {"action": "run"}
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_manual_run_preserves_next_scheduled_time(api_client, assigned_case, fixed_clock):
    due_source(assigned_case)
    assert control(api_client, assigned_case, action="run").status_code == 200
    source = operator_case(api_client, assigned_case)["assignment"]["source"]
    assert source["next_crawl_at"] == "2026-09-12T11:59:00Z"


@pytest.mark.django_db
def test_due_schedule_dispatches_once_and_advances_six_hours(
    api_client, assigned_case, fixed_clock
):
    due_source(assigned_case)
    assert dispatch_scheduled_crawls.run() == 1
    first = operator_case(api_client, assigned_case)["assignment"]
    assert first["source"]["next_crawl_at"] == "2026-09-12T18:00:00Z"
    assert first["source"]["crawl_schedule_error"] == ""
    assert dispatch_scheduled_crawls.run() == 0
    second = operator_case(api_client, assigned_case)["assignment"]
    assert second["recent_requests"] == first["recent_requests"]
    assert second["source"]["next_crawl_at"] == "2026-09-12T18:00:00Z"


@pytest.mark.django_db
@pytest.mark.parametrize("blocked", ["paused", "revoked", "profile", "operator", "exclusion"])
def test_scheduler_respects_current_processing_authority(
    api_client, assigned_case, blocked, fixed_clock
):
    from apps.source_proposals.models import SourceAssignment

    source = due_source(assigned_case)
    assignment = SourceAssignment.objects.get(pk=assigned_case[1]["id"])
    if blocked == "paused":
        source.processing_paused = True
        source.save()
    elif blocked == "revoked":
        assignment.revoked_at = timezone.now()
        assignment.save()
    elif blocked == "profile":
        source.profile.active_version = None
        source.profile.save()
    elif blocked == "operator":
        source.responsible_operator = None
        source.save()
    else:
        SourceExclusion.objects.create(
            source=source,
            kind="exact",
            url=assigned_case[0].website_url,
            reason="blocked",
            actor=assigned_case[2],
        )
    before = operator_case(api_client, assigned_case)["assignment"]["recent_requests"]
    assert dispatch_scheduled_crawls.run() == 0
    after = operator_case(api_client, assigned_case)["assignment"]
    assert after["recent_requests"] == before
    if blocked not in ("paused", "revoked"):
        assert after["source"]["crawl_schedule_error"]
        assert after["source"]["next_crawl_at"] == "2026-09-12T18:00:00Z"
    else:
        assert after["source"]["next_crawl_at"] == "2026-09-12T11:59:00Z"


@pytest.mark.django_db
def test_operator_cannot_run_a_paused_source(api_client, assigned_case):
    source = due_source(assigned_case)
    source.processing_paused = True
    source.save()
    assert control(api_client, assigned_case, action="run").status_code == 400


@pytest.mark.django_db(transaction=True)
def test_concurrent_schedulers_submit_one_request(
    api_client, assigned_case, monkeypatch, fixed_clock
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from apps.source_proposals.tasks import extract_source

    if connection.vendor != "postgresql":
        pytest.skip("Schedule serialization requires PostgreSQL")
    due_source(assigned_case)
    monkeypatch.setattr(extract_source, "delay", lambda *args: None)
    # Start from a new entry URL to distinguish this dispatch from initial approval work.
    proposal = assigned_case[0]
    proposal.website_url = proposal.website_url.rstrip("/") + "/scheduled"
    proposal.save(update_fields=("website_url",))
    barrier = Barrier(2)

    def dispatch(_):
        close_old_connections()
        try:
            barrier.wait(timeout=15)
            return dispatch_scheduled_crawls.run()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(dispatch, range(2)))
    assert sum(results) == 1
    assignment = operator_case(api_client, assigned_case)["assignment"]
    assert (
        sum(item["submitted_url"] == proposal.website_url for item in assignment["recent_requests"])
        == 1
    )
    assert assignment["source"]["next_crawl_at"] == "2026-09-12T18:00:00Z"


@pytest.mark.django_db
@pytest.mark.parametrize("missing", ["representative", "profile"])
def test_operator_can_disable_schedule_when_execution_is_unavailable(
    api_client, assigned_case, missing
):
    due_source(assigned_case)
    if missing == "representative":
        assigned_case[3].delete()
    else:
        assigned_case[0].refresh_from_db()
        profile = assigned_case[0].source.profile
        profile.active_version = None
        profile.save(update_fields=("active_version",))
    response = control(
        api_client, assigned_case, action="schedule", interval_hours=0, reviewed_schedule_revision=0
    )
    assert response.status_code == 200, response.content
    source = operator_case(api_client, assigned_case)["assignment"]["source"]
    assert source["crawl_interval_hours"] == 0
    assert source["next_crawl_at"] is None
