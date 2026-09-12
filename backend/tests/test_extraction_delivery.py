from datetime import UTC, datetime

import pytest
from celery.exceptions import OperationalError
from django.utils import timezone

from apps.source_proposals.tasks import dispatch_scheduled_crawls, extract_source
from tests.test_source_crawl_control import control, operator_case


@pytest.mark.django_db
def test_scheduled_extraction_recovers_after_broker_outage(
    api_client, assigned_case, monkeypatch, django_capture_on_commit_callbacks
):
    clock = [datetime(2026, 9, 12, 8, tzinfo=UTC)]
    monkeypatch.setattr(timezone, "now", lambda: clock[0])
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
    clock[0] = datetime(2026, 9, 12, 14, tzinfo=UTC)

    def offline(*args):
        raise OperationalError("broker unavailable")

    monkeypatch.setattr(extract_source, "delay", offline)
    with django_capture_on_commit_callbacks(execute=True):
        dispatch_scheduled_crawls.run()
    first = operator_case(api_client, assigned_case)["assignment"]["recent_requests"][0]
    assert first["state"] == "queued"
    assert first["delivery_error"]

    delivered = []
    monkeypatch.setattr(extract_source, "delay", lambda *args: delivered.append(args))
    clock[0] = datetime(2026, 9, 12, 14, 1, tzinfo=UTC)
    with django_capture_on_commit_callbacks(execute=True):
        dispatch_scheduled_crawls.run()
    assert delivered == [(first["id"],)]
    monkeypatch.setattr(
        "apps.source_proposals.extraction.SourcePageFetcher", lambda **kwargs: assigned_case[4]
    )
    extract_source.run(*delivered[0])
    recovered = operator_case(api_client, assigned_case)["assignment"]["recent_requests"]
    assert len(recovered) == 1
    assert recovered[0]["id"] == first["id"]
    assert recovered[0]["state"] == "complete"
    assert recovered[0]["delivery_error"] == ""
