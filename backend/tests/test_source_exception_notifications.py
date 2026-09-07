import re
from datetime import UTC, datetime, timedelta

import pytest

from tests.test_extraction_publication import execute_run
from tests.test_source_exceptions import BAD_URL, exceptions


@pytest.mark.django_db
def test_daily_summary_aggregates_changes_and_keeps_counts_without_repeat_messages(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_proposals.tasks import deliver_source_exception_summaries

    now = datetime(2026, 9, 6, 10, tzinfo=UTC)

    def clock():
        nonlocal now
        now += timedelta(milliseconds=1)
        return now

    monkeypatch.setattr("django.utils.timezone.now", clock)
    fetcher = assigned_case[4]
    original = fetcher.pages[BAD_URL]
    fetcher.pages[BAD_URL] = original.replace('class="area">85', 'class="area">95')
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert deliver_source_exception_summaries.run() == 1
    api_client.force_authenticate(assigned_case[2])
    notices = api_client.get("/api/v1/messages/?kind=system_notification").json()["results"]
    assert len(notices) == 1
    assert notices[0]["title"] == "خلاصه تغییرات مشکلات استخراج منبع"
    assert "جدید: 1" in notices[0]["preview"]
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert deliver_source_exception_summaries.run() == 0
    assert exceptions(api_client, assigned_case)[0]["state"] == "open"
    fetcher.pages[BAD_URL] = original
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    fetcher.pages[BAD_URL] = original.replace('class="area">85', 'class="area">95')
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert deliver_source_exception_summaries.run() == 0
    now += timedelta(days=1)
    assert deliver_source_exception_summaries.run() == 1
    api_client.force_authenticate(assigned_case[2])
    latest = api_client.get("/api/v1/messages/?kind=system_notification").json()["results"][0]
    assert "رفع شده: 1" in latest["preview"]
    assert "بازگشایی: 1" in latest["preview"]
    now += timedelta(days=1)
    assert deliver_source_exception_summaries.run() == 0


def failure_notices(client, operator):
    client.force_authenticate(operator)
    return [
        item
        for item in client.get("/api/v1/messages/?kind=system_notification").json()["results"]
        if item["title"] == "استخراج منبع نتیجه قابل استفاده نداشت"
    ]


@pytest.mark.django_db
def test_failure_alert_is_immediate_deduplicated_and_rearmed_by_recovery(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):

    fetcher = assigned_case[4]
    originals = dict(fetcher.pages)
    for url, html in originals.items():
        fetcher.pages[url] = re.sub(r'class="area">[0-9]+', 'class="area">9999', html)
    first = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert first["usable_results"] == 0
    assert first["attempted_pages"] > 0
    notices = failure_notices(api_client, assigned_case[2])
    assert len(notices) == 1
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert len(failure_notices(api_client, assigned_case[2])) == 1
    fetcher.pages.update(originals)
    recovered = execute_run(
        api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
    )
    assert recovered["usable_results"] == 10
    for url, html in originals.items():
        fetcher.pages[url] = re.sub(r'class="area">[0-9]+', 'class="area">9999', html)
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert len(failure_notices(api_client, assigned_case[2])) == 2
    api_client.force_authenticate(assigned_case[3])
    case = api_client.get(f"/api/v1/source-proposals/{assigned_case[0].pk}/").json()
    assert case["assignment"]["source"]["processing_paused"] is False
    assert not failure_notices(api_client, assigned_case[3])


@pytest.mark.django_db
def test_excluded_only_attempt_does_not_alert_or_claim_recovery(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from tests.test_source_exclusions import add_exclusion

    assert (
        add_exclusion(
            api_client, assigned_case, url=assigned_case[0].website_url, kind="exact"
        ).status_code
        == 200
    )
    run = execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    assert run["attempted_pages"] == 0
    assert run["skipped_pages"]
    assert not failure_notices(api_client, assigned_case[2])


@pytest.mark.django_db
def test_pending_summary_follows_responsibility_and_links_require_current_authority(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_proposals.tasks import deliver_source_exception_summaries
    from tests.test_source_proposal_review import make_operator
    from tests.test_source_responsibility import queue_manager, reassign

    proposal, _, original, representative, fetcher = assigned_case
    fetcher.pages[BAD_URL] = fetcher.pages[BAD_URL].replace('class="area">85', 'class="area">95')
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    manager = queue_manager()
    successor = make_operator(email="summary-successor@example.com")
    api_client.force_authenticate(manager)
    assert reassign(api_client, proposal, successor).status_code == 200
    assert deliver_source_exception_summaries.run() == 1
    api_client.force_authenticate(successor)
    items = api_client.get("/api/v1/messages/?kind=system_notification").json()["results"]
    assert len(items) == 1
    endpoint = f"/api/v1/messages/{items[0]['id']}/"
    assert api_client.get(endpoint).json()["target"]["href"] == (
        f"/operator/source-proposals?proposal={proposal.pk}"
    )
    for user in (original, representative, manager):
        api_client.force_authenticate(user)
        assert api_client.get(endpoint).status_code == 404
    api_client.force_authenticate(manager)
    assert reassign(api_client, proposal, original, revision=2).status_code == 200
    assert deliver_source_exception_summaries.run() == 0
    api_client.force_authenticate(successor)
    assert api_client.get(endpoint).json()["target"] is None


@pytest.mark.django_db
@pytest.mark.parametrize("denial", ["capability", "inactive", "revoked"])
def test_summary_waits_for_an_authorized_recipient(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks, denial
):
    from django.utils import timezone

    from apps.source_proposals.models import SourceAssignment
    from apps.source_proposals.tasks import deliver_source_exception_summaries

    _, assignment, operator, _, fetcher = assigned_case
    fetcher.pages[BAD_URL] = fetcher.pages[BAD_URL].replace('class="area">85', 'class="area">95')
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    if denial == "capability":
        operator.user_permissions.clear()
    elif denial == "inactive":
        operator.is_active = False
        operator.save()
    else:
        SourceAssignment.objects.filter(pk=assignment["id"]).update(revoked_at=timezone.now())
    assert deliver_source_exception_summaries.run() == 0


@pytest.mark.django_db
def test_failure_delivery_waits_for_eligible_operator_and_survives_reassignment(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from apps.source_proposals.tasks import deliver_source_exception_summaries
    from tests.test_source_responsibility import queue_manager, reassign

    proposal, _, operator, _, fetcher = assigned_case
    operator.is_active = False
    operator.save()
    for url, html in list(fetcher.pages.items()):
        fetcher.pages[url] = re.sub(r'class="area">[0-9]+', 'class="area">9999', html)
    # Create through the representative API; the old Operator is no longer authorized to read it.
    monkeypatch.setattr("apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: fetcher)
    api_client.force_authenticate(assigned_case[3])
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(
            f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
            {"assignment": assigned_case[1]["id"], "url": proposal.website_url},
            format="json",
        )
    assert response.status_code == 201
    successor = queue_manager()
    api_client.force_authenticate(successor)
    assert reassign(api_client, proposal, successor).status_code == 200
    deliver_source_exception_summaries.run()
    assert len(failure_notices(api_client, successor)) == 1
    deliver_source_exception_summaries.run()
    assert len(failure_notices(api_client, successor)) == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_summary_tasks_deliver_once(api_client, assigned_case, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from apps.source_proposals.tasks import deliver_source_exception_summaries, extract_source

    if connection.vendor != "postgresql":
        pytest.skip("Concurrent delivery requires PostgreSQL")
    proposal, assignment, operator, _, fetcher = assigned_case
    monkeypatch.setattr(extract_source, "delay", lambda *args: None)
    monkeypatch.setattr("apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: fetcher)
    fetcher.pages[BAD_URL] = fetcher.pages[BAD_URL].replace('class="area">85', 'class="area">95')
    response = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {"assignment": assignment["id"], "url": BAD_URL},
        format="json",
    )
    extract_source.run(response.json()["id"])
    extract_source.run(response.json()["id"])
    barrier = Barrier(2)

    def deliver():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return deliver_source_exception_summaries.run()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(lambda _: deliver(), range(2))) == 1
    api_client.force_authenticate(operator)
    messages = api_client.get("/api/v1/messages/?kind=system_notification").json()["results"]
    summaries = [item for item in messages if item["title"] == "خلاصه تغییرات مشکلات استخراج منبع"]
    assert len(summaries) == 1
    assert "جدید: 1" in summaries[0]["preview"]
    assert len(failure_notices(api_client, operator)) == 1


@pytest.mark.django_db
def test_unchecked_source_is_not_starved_by_ineligible_delivery_backlog(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    from django.utils import timezone

    from apps.catalog.models import Source
    from apps.source_proposals.models import SourceExceptionNotificationState
    from apps.source_proposals.tasks import deliver_source_exception_summaries

    fetcher = assigned_case[4]
    fetcher.pages[BAD_URL] = fetcher.pages[BAD_URL].replace('class="area">85', 'class="area">95')
    execute_run(api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks)
    sources = Source.objects.bulk_create([
        Source(name=f"unassigned-{i}", domain=f"unassigned-{i}.example") for i in range(200)
    ])
    SourceExceptionNotificationState.objects.bulk_create([
        SourceExceptionNotificationState(
            source=source, pending_changes={"new": 1}, last_delivery_check=timezone.now()
        )
        for source in sources
    ])
    assert deliver_source_exception_summaries.run() == 1


@pytest.mark.django_db
def test_redirect_into_excluded_page_does_not_alert(api_client, assigned_case, monkeypatch):
    from dataclasses import replace

    from apps.source_extraction.fetching import FetchBatch
    from apps.source_proposals.tasks import extract_source
    from tests.test_source_exclusions import add_exclusion

    proposal, assignment, operator, representative, fetcher = assigned_case
    destination = "https://khaneh.example/excluded/10000"
    assert (
        add_exclusion(api_client, assigned_case, url=destination, kind="exact").status_code == 200
    )

    class RedirectingFetcher:
        def fetch(self, urls, **kwargs):
            batch = fetcher.fetch(urls, **kwargs)
            return FetchBatch(
                tuple(
                    replace(record, page=replace(record.page, url=destination))
                    if record.page
                    else record
                    for record in batch.records
                )
            )

    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: RedirectingFetcher()
    )
    api_client.force_authenticate(representative)
    response = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {"assignment": assignment["id"], "url": BAD_URL},
        format="json",
    )
    extract_source.run(response.json()["id"])
    run = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()["assignment"][
        "recent_requests"
    ][0]["run"]
    assert run["skipped_pages"]
    assert run["attempted_pages"] == 0
    assert not failure_notices(api_client, operator)


@pytest.mark.django_db
def test_transient_task_retries_do_not_repeat_alerts(api_client, assigned_case, monkeypatch):
    from celery.exceptions import Retry

    from apps.source_extraction.fetching import (
        FetchBatch,
        FetchFailure,
        FetchFailureCode,
        FetchRecord,
    )
    from apps.source_proposals.tasks import extract_source

    now = datetime(2026, 9, 6, 12, tzinfo=UTC)
    monkeypatch.setattr("django.utils.timezone.now", lambda: now)
    proposal, assignment, operator, representative, _ = assigned_case

    class FailedFetcher:
        def fetch(self, urls, **kwargs):
            return FetchBatch(
                tuple(
                    FetchRecord(
                        url,
                        failure=FetchFailure(
                            FetchFailureCode.TIMEOUT,
                            url,
                            "private transport detail",
                            transient=True,
                        ),
                    )
                    for url in urls
                )
            )

    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kw: FailedFetcher()
    )
    response = api_client.post(
        f"/api/v1/source-proposals/{proposal.pk}/extraction-requests/",
        {"assignment": assignment["id"], "url": BAD_URL},
        format="json",
    )
    for _ in range(2):
        with pytest.raises(Retry):
            extract_source.run(response.json()["id"])
        assert len(failure_notices(api_client, operator)) == 1
        now += timedelta(minutes=15)
    extract_source.run(response.json()["id"])
    assert len(failure_notices(api_client, operator)) == 1
    api_client.force_authenticate(representative)
    run = api_client.get(f"/api/v1/source-proposals/{proposal.pk}/").json()["assignment"][
        "recent_requests"
    ][0]["run"]
    assert run["attempts"] == 3
    assert run["attempted_pages"] == 1
    assert run["usable_results"] == 0
