import uuid
from dataclasses import asdict
from typing import Protocol, TypedDict

from celery import shared_task
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .group_consistency import grouped_property_queryset, measure_group_consistency
from .image_evidence import backfill_listing_image_hashes
from .match_suggestions import (
    eligible_property_roots,
    evaluate_property_pair,
    measure_candidates_for_property,
)
from .matching import SCORING_VERSION
from .models import (
    PropertyMatchOperation,
    PropertyMatchSuggestion,
    PropertyMatchSuggestionOrigin,
    PropertyMatchSuggestionState,
)
from .services import expire_listings

PROPERTY_MATCH_RECONCILIATION_LOCK = "catalog:property-match-reconciliation"
PROPERTY_MATCH_RECONCILIATION_TIMEOUT = settings.CELERY_TASK_TIME_LIMIT + 5 * 60
GROUP_CONSISTENCY_RECONCILIATION_LOCK = "catalog:group-consistency-reconciliation"
GROUP_CONSISTENCY_RECONCILIATION_TIMEOUT = settings.CELERY_TASK_TIME_LIMIT + 5 * 60


class DelayedTask(Protocol):
    def delay(self, **kwargs: object) -> object: ...


class OperationResult(TypedDict):
    operation_id: str
    status: str
    phase: str
    generation: int
    processed_targets: int
    evaluated_pairs: int
    active_suggestions: int
    measured_groups: int


def _operation_result(operation: PropertyMatchOperation) -> OperationResult:
    return {
        "operation_id": str(operation.pk),
        "status": operation.status,
        "phase": operation.phase,
        "generation": operation.generation,
        "processed_targets": operation.processed_targets,
        "evaluated_pairs": operation.evaluated_pairs,
        "active_suggestions": operation.active_suggestions,
        "measured_groups": operation.measured_groups,
    }


def _ensure_property_match_operation(*, operation_id: uuid.UUID, kind: str) -> None:
    initial_phase = (
        PropertyMatchOperation.Phase.CANDIDATES
        if kind == PropertyMatchOperation.Kind.BACKFILL
        else PropertyMatchOperation.Phase.SUGGESTIONS
    )
    operation, _ = PropertyMatchOperation.objects.get_or_create(
        pk=operation_id,
        defaults={
            "kind": kind,
            "phase": initial_phase,
            "scoring_version": SCORING_VERSION,
        },
    )
    if operation.kind != kind:
        raise ValueError("operation kind does not match task")


@transaction.atomic
def _process_property_match_operation_page(
    *,
    operation_id: uuid.UUID,
    kind: str,
    limit: int,
    generation: int,
) -> tuple[OperationResult, bool]:
    operation = PropertyMatchOperation.objects.select_for_update().get(pk=operation_id)
    if operation.kind != kind:
        raise ValueError("operation kind does not match task")
    if operation.status == PropertyMatchOperation.Status.COMPLETED:
        return _operation_result(operation), False
    if operation.generation != generation:
        return _operation_result(operation), False
    if operation.scoring_version != SCORING_VERSION:
        operation.status = PropertyMatchOperation.Status.FAILED
        operation.error_code = "scoring_version_changed"
        operation.save(update_fields=("status", "error_code", "updated_at"))
        return _operation_result(operation), True

    operation.status = PropertyMatchOperation.Status.RUNNING
    operation.error_code = ""
    while True:
        if operation.phase == PropertyMatchOperation.Phase.CANDIDATES:
            properties = eligible_property_roots().order_by("pk")
            if operation.cursor is not None:
                properties = properties.filter(pk__gt=operation.cursor)
            property_ids = list(properties.values_list("pk", flat=True)[:limit])
            if not property_ids:
                operation.phase = PropertyMatchOperation.Phase.GROUPS
                operation.cursor = None
                continue
            for property_id in property_ids:
                counts = measure_candidates_for_property(
                    property_id,
                    limit=500,
                    origin=PropertyMatchSuggestionOrigin.BACKFILL,
                    persist_inactive=True,
                    only_higher_ids=True,
                )
                operation.evaluated_pairs += counts["evaluated"]
                operation.active_suggestions += counts["active"]
            operation.cursor = property_ids[-1]
            operation.processed_targets += len(property_ids)
            break

        if operation.phase == PropertyMatchOperation.Phase.SUGGESTIONS:
            suggestions = PropertyMatchSuggestion.objects.filter(
                state__in=(
                    PropertyMatchSuggestionState.PENDING,
                    PropertyMatchSuggestionState.REJECTED,
                    PropertyMatchSuggestionState.SNOOZED,
                )
            ).order_by("pk")
            if operation.cursor is not None:
                suggestions = suggestions.filter(pk__gt=operation.cursor)
            suggestion_rows = list(suggestions.values_list("pk", "left_id", "right_id")[:limit])
            if not suggestion_rows:
                operation.phase = PropertyMatchOperation.Phase.GROUPS
                operation.cursor = None
                continue
            for _suggestion_id, left_id, right_id in suggestion_rows:
                suggestion = evaluate_property_pair(
                    left_id,
                    right_id,
                    origin=PropertyMatchSuggestionOrigin.RESCORE,
                    persist_inactive=True,
                )
                if suggestion is not None:
                    operation.evaluated_pairs += 1
                    operation.active_suggestions += int(
                        suggestion.state == PropertyMatchSuggestionState.PENDING
                    )
            operation.cursor = suggestion_rows[-1][0]
            operation.processed_targets += len(suggestion_rows)
            break

        if operation.phase == PropertyMatchOperation.Phase.GROUPS:
            properties = grouped_property_queryset().order_by("pk")
            if operation.cursor is not None:
                properties = properties.filter(pk__gt=operation.cursor)
            property_ids = list(properties.values_list("pk", flat=True)[:limit])
            if not property_ids:
                operation.status = PropertyMatchOperation.Status.COMPLETED
                operation.phase = PropertyMatchOperation.Phase.COMPLETED
                operation.cursor = None
                operation.completed_at = timezone.now()
                break
            for property_id in property_ids:
                if measure_group_consistency(property_id) is not None:
                    operation.measured_groups += 1
            operation.cursor = property_ids[-1]
            operation.processed_targets += len(property_ids)
            break

        if operation.phase == PropertyMatchOperation.Phase.COMPLETED:
            operation.status = PropertyMatchOperation.Status.COMPLETED
            break

        raise ValueError("unknown operation phase")

    operation.generation += 1
    operation.save(
        update_fields=(
            "status",
            "phase",
            "cursor",
            "generation",
            "processed_targets",
            "evaluated_pairs",
            "active_suggestions",
            "measured_groups",
            "error_code",
            "completed_at",
            "updated_at",
        )
    )
    return _operation_result(operation), True


def _record_operation_failure(*, operation_id: uuid.UUID, kind: str, error: Exception) -> None:
    operation = PropertyMatchOperation.objects.filter(pk=operation_id, kind=kind).first()
    if operation is None or operation.status == PropertyMatchOperation.Status.COMPLETED:
        return
    operation.status = PropertyMatchOperation.Status.FAILED
    operation.error_code = error.__class__.__name__
    operation.save(update_fields=("status", "error_code", "updated_at"))


def _run_property_match_operation(
    *,
    task: DelayedTask,
    operation_id: str,
    kind: str,
    limit: int,
    generation: int,
) -> OperationResult:
    if limit < 1 or limit > 500:
        raise ValueError("limit must be between 1 and 500")
    parsed_id = uuid.UUID(operation_id)
    _ensure_property_match_operation(operation_id=parsed_id, kind=kind)
    try:
        result, advanced = _process_property_match_operation_page(
            operation_id=parsed_id,
            kind=kind,
            limit=limit,
            generation=generation,
        )
    except Exception as error:
        _record_operation_failure(operation_id=parsed_id, kind=kind, error=error)
        raise
    should_schedule = result["status"] == PropertyMatchOperation.Status.RUNNING or (
        result["status"] == PropertyMatchOperation.Status.FAILED
        and result["generation"] > generation
    )
    if should_schedule and (advanced or result["generation"] > generation):
        try:
            task.delay(
                operation_id=operation_id,
                limit=limit,
                generation=result["generation"],
            )
        except Exception as error:
            _record_operation_failure(operation_id=parsed_id, kind=kind, error=error)
            raise
    return result


@shared_task  # type: ignore[untyped-decorator]
def backfill_property_matching(
    *, operation_id: str, limit: int = 100, generation: int = 0
) -> OperationResult:
    return _run_property_match_operation(
        task=backfill_property_matching,
        operation_id=operation_id,
        kind=PropertyMatchOperation.Kind.BACKFILL,
        limit=limit,
        generation=generation,
    )


@shared_task  # type: ignore[untyped-decorator]
def rescore_property_matching(
    *, operation_id: str, limit: int = 100, generation: int = 0
) -> OperationResult:
    return _run_property_match_operation(
        task=rescore_property_matching,
        operation_id=operation_id,
        kind=PropertyMatchOperation.Kind.RESCORE,
        limit=limit,
        generation=generation,
    )


def _finish_focused_measurement(property_id: uuid.UUID) -> None:
    from .match_suggestion_signals import (
        FOCUSED_MEASUREMENT_DIRTY_KEY,
        FOCUSED_MEASUREMENT_KEY,
        _dispatch_focused_measurement,
    )

    cache.delete(FOCUSED_MEASUREMENT_KEY.format(property_id=property_id))
    dirty_key = FOCUSED_MEASUREMENT_DIRTY_KEY.format(property_id=property_id)
    if cache.get(dirty_key):
        cache.delete(dirty_key)
        _dispatch_focused_measurement(property_id)


def _renew_reconciliation_fence(token: str, processing_key: str) -> bool:
    if cache.get(PROPERTY_MATCH_RECONCILIATION_LOCK) != token:
        return False
    cache.touch(PROPERTY_MATCH_RECONCILIATION_LOCK, PROPERTY_MATCH_RECONCILIATION_TIMEOUT)
    cache.touch(processing_key, PROPERTY_MATCH_RECONCILIATION_TIMEOUT)
    return True


@shared_task  # type: ignore[untyped-decorator]
def expire_due_listings() -> int:
    return expire_listings()


@shared_task  # type: ignore[untyped-decorator]
def backfill_listing_image_identity(
    *, limit: int = 100, after_id: str | None = None
) -> dict[str, int | str | None]:
    return asdict(backfill_listing_image_hashes(limit=limit, after_id=after_id))


@shared_task  # type: ignore[untyped-decorator]
def measure_property_match_candidates(*, property_id: str, limit: int = 100) -> dict[str, int]:
    parsed_property_id = uuid.UUID(property_id)
    try:
        return measure_candidates_for_property(parsed_property_id, limit=limit)
    finally:
        _finish_focused_measurement(parsed_property_id)


@shared_task  # type: ignore[untyped-decorator]
def reconcile_property_match_suggestions(
    *,
    limit: int = 100,
    after_id: str | None = None,
    run_token: str | None = None,
) -> dict[str, int | str | None]:
    if limit < 1 or limit > 500:
        raise ValueError("limit must be between 1 and 500")
    token = run_token or str(uuid.uuid4())
    if run_token is None:
        if not cache.add(
            PROPERTY_MATCH_RECONCILIATION_LOCK,
            token,
            timeout=PROPERTY_MATCH_RECONCILIATION_TIMEOUT,
        ):
            return {"status": "already_running", "processed": 0, "next_after_id": None}
    elif cache.get(PROPERTY_MATCH_RECONCILIATION_LOCK) != token:
        return {"status": "stale_delivery", "processed": 0, "next_after_id": None}
    page_identity = after_id or "root"
    processing_key = f"{PROPERTY_MATCH_RECONCILIATION_LOCK}:processing:{token}:{page_identity}"
    completed_key = f"{PROPERTY_MATCH_RECONCILIATION_LOCK}:completed:{token}:{page_identity}"
    if cache.get(completed_key) or not cache.add(
        processing_key,
        True,
        timeout=PROPERTY_MATCH_RECONCILIATION_TIMEOUT,
    ):
        return {"status": "duplicate_delivery", "processed": 0, "next_after_id": None}
    try:
        PropertyMatchSuggestion.objects.filter(state=PropertyMatchSuggestionState.PENDING).filter(
            Q(left__merged_into__isnull=False) | Q(right__merged_into__isnull=False)
        ).update(
            state=PropertyMatchSuggestionState.SUPERSEDED,
            last_evaluated_at=timezone.now(),
        )
        properties = eligible_property_roots().order_by("pk")
        if after_id is not None:
            properties = properties.filter(pk__gt=uuid.UUID(after_id))
        property_ids = list(properties.values_list("pk", flat=True)[:limit])
        for property_id in property_ids:
            if not _renew_reconciliation_fence(token, processing_key):
                return {"status": "stale_delivery", "processed": 0, "next_after_id": None}
            measure_candidates_for_property(
                property_id,
                limit=limit,
                origin=PropertyMatchSuggestionOrigin.NIGHTLY,
            )
        if not _renew_reconciliation_fence(token, processing_key):
            return {"status": "stale_delivery", "processed": 0, "next_after_id": None}
        next_after_id = str(property_ids[-1]) if len(property_ids) == limit else None
        cache.set(completed_key, True, timeout=24 * 60 * 60)
        cache.delete(processing_key)
        if next_after_id is not None:
            reconcile_property_match_suggestions.delay(
                limit=limit,
                after_id=next_after_id,
                run_token=token,
            )
        elif cache.get(PROPERTY_MATCH_RECONCILIATION_LOCK) == token:
            cache.delete(PROPERTY_MATCH_RECONCILIATION_LOCK)
        return {
            "status": "completed",
            "processed": len(property_ids),
            "next_after_id": next_after_id,
        }
    except Exception:
        cache.delete(processing_key)
        if cache.get(PROPERTY_MATCH_RECONCILIATION_LOCK) == token:
            cache.delete(PROPERTY_MATCH_RECONCILIATION_LOCK)
        raise


@shared_task  # type: ignore[untyped-decorator]
def reconcile_grouped_property_consistency(
    *,
    limit: int = 100,
    after_id: str | None = None,
    run_token: str | None = None,
) -> dict[str, int | str | None]:
    if limit < 1 or limit > 500:
        raise ValueError("limit must be between 1 and 500")
    token = run_token or str(uuid.uuid4())
    if run_token is None:
        acquired = cache.add(
            GROUP_CONSISTENCY_RECONCILIATION_LOCK,
            token,
            timeout=GROUP_CONSISTENCY_RECONCILIATION_TIMEOUT,
        )
        if not acquired:
            return {"status": "already_running", "processed": 0, "next_after_id": None}
    elif cache.get(GROUP_CONSISTENCY_RECONCILIATION_LOCK) != token:
        return {"status": "stale_delivery", "processed": 0, "next_after_id": None}
    page_identity = after_id or "root"
    processing_key = f"{GROUP_CONSISTENCY_RECONCILIATION_LOCK}:processing:{token}:{page_identity}"
    completed_key = f"{GROUP_CONSISTENCY_RECONCILIATION_LOCK}:completed:{token}:{page_identity}"
    if cache.get(completed_key) or not cache.add(
        processing_key,
        True,
        timeout=GROUP_CONSISTENCY_RECONCILIATION_TIMEOUT,
    ):
        return {"status": "duplicate_delivery", "processed": 0, "next_after_id": None}
    try:
        properties = grouped_property_queryset().order_by("pk")
        if after_id is not None:
            properties = properties.filter(pk__gt=uuid.UUID(after_id))
        property_ids = list(properties.values_list("pk", flat=True)[:limit])
        for property_id in property_ids:
            if cache.get(GROUP_CONSISTENCY_RECONCILIATION_LOCK) != token:
                return {"status": "stale_delivery", "processed": 0, "next_after_id": None}
            cache.touch(
                GROUP_CONSISTENCY_RECONCILIATION_LOCK,
                GROUP_CONSISTENCY_RECONCILIATION_TIMEOUT,
            )
            cache.touch(processing_key, GROUP_CONSISTENCY_RECONCILIATION_TIMEOUT)
            measure_group_consistency(property_id)
        next_after_id = str(property_ids[-1]) if len(property_ids) == limit else None
        cache.set(completed_key, True, timeout=24 * 60 * 60)
        cache.delete(processing_key)
        if next_after_id is not None:
            reconcile_grouped_property_consistency.delay(
                limit=limit,
                after_id=next_after_id,
                run_token=token,
            )
        elif cache.get(GROUP_CONSISTENCY_RECONCILIATION_LOCK) == token:
            cache.delete(GROUP_CONSISTENCY_RECONCILIATION_LOCK)
        return {
            "status": "completed",
            "processed": len(property_ids),
            "next_after_id": next_after_id,
        }
    except Exception:
        cache.delete(processing_key)
        if cache.get(GROUP_CONSISTENCY_RECONCILIATION_LOCK) == token:
            cache.delete(GROUP_CONSISTENCY_RECONCILIATION_LOCK)
        raise
