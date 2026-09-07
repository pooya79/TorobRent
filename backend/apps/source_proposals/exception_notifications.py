"""Durable aggregation and in-app delivery, serialized with current Source responsibility."""

from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.catalog.models import Source
from apps.communications.models import SystemNotification

from .models import (
    ExtractionRun,
    SourceAssignment,
    SourceExceptionNotice,
    SourceExceptionNotificationState,
)


def eligible_assignment(source: Source) -> SourceAssignment | None:
    operator = source.responsible_operator
    if operator is None or not has_capability(operator, OperatorCapability.REVIEW_SOURCE_PROPOSALS):
        return None
    return (
        SourceAssignment.objects
        .filter(source=source, revoked_at__isnull=True)
        .exclude(representative=operator)
        .first()
    )


def aggregate_changes(source: Source, changes: dict[str, int]) -> None:
    # Extraction completion already holds the Source lock.
    state, _ = SourceExceptionNotificationState.objects.get_or_create(source=source)
    for kind, count in changes.items():
        state.pending_changes[kind] = state.pending_changes.get(kind, 0) + count
    state.save(update_fields=("pending_changes",))


def deliver_summaries() -> int:
    delivered = 0
    today = timezone.localdate()
    source_ids = list(
        SourceExceptionNotificationState.objects
        .filter(
            (Q(last_summary_date__isnull=True) | Q(last_summary_date__lt=today))
            & ~Q(pending_changes={})
            | Q(failing=True, failure_notified=False)
        )
        .order_by(F("last_delivery_check").asc(nulls_first=True), "source_id")
        .values_list("source_id", flat=True)[:200]
    )
    for source_id in source_ids:
        with transaction.atomic():
            source = Source.objects.select_for_update().get(pk=source_id)
            state = SourceExceptionNotificationState.objects.get(source=source)
            deliver_failure(source, state)
            state.last_delivery_check = timezone.now()
            state.save(update_fields=("failure_notified", "last_delivery_check"))
            assignment = eligible_assignment(source)
            if not assignment or not state.pending_changes or state.last_summary_date == today:
                continue
            assert source.responsible_operator_id is not None
            notice = SourceExceptionNotice.objects.create(
                source=source, kind="summary", changes=state.pending_changes, summary_date=today
            )
            SystemNotification.objects.create(
                recipient_id=source.responsible_operator_id,
                originating_source_exception_notice=notice,
                target_source_proposal=assignment.proposal,
            )
            state.pending_changes = {}
            state.last_summary_date = today
            state.save()
            delivered += 1
    return delivered


def record_run_health(run: ExtractionRun) -> None:
    if run.state == "cancelled" or not run.attempted_pages:
        return
    # The worker holds Source across outcome recording and both kinds of notification.
    source = Source.objects.get(pk=run.request.assignment.source_id)
    state, _ = SourceExceptionNotificationState.objects.get_or_create(source=source)
    if state.last_run:
        previous = state.last_run.request
        if (run.request.created_at, str(run.request_id), run.attempts) <= (
            previous.created_at,
            str(previous.pk),
            state.last_attempt,
        ):
            return
    state.last_run = run
    state.last_attempt = run.attempts
    state.failing = not run.usable_results
    if not state.failing:
        state.failure_notified = False
    deliver_failure(source, state)
    state.save()


def deliver_failure(source: Source, state: SourceExceptionNotificationState) -> None:
    assignment = eligible_assignment(source)
    if not assignment or not state.failing or state.failure_notified:
        return
    assert source.responsible_operator_id is not None
    notice = SourceExceptionNotice.objects.create(source=source, kind="failure")
    SystemNotification.objects.create(
        recipient_id=source.responsible_operator_id,
        originating_source_exception_notice=notice,
        target_source_proposal=assignment.proposal,
    )
    state.failure_notified = True
