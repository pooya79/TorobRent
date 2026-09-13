import uuid
from typing import TypedDict

from django.db import transaction
from django.utils import timezone

from .group_consistency import grouped_property_queryset, measure_group_consistency
from .match_suggestions import (
    eligible_property_roots,
    evaluate_property_pair,
    measure_indexed_candidate_page,
)
from .matching import SCORING_VERSION
from .models import (
    PropertyMatchOperation,
    PropertyMatchSuggestion,
    PropertyMatchSuggestionOrigin,
    PropertyMatchSuggestionState,
)


class OperationResult(TypedDict):
    operation_id: str
    status: str
    phase: str
    generation: int
    processed_targets: int
    evaluated_pairs: int
    active_suggestions: int
    measured_groups: int


def operation_result(operation: PropertyMatchOperation) -> OperationResult:
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


def ensure_property_match_operation(*, operation_id: uuid.UUID, kind: str) -> None:
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
def process_property_match_operation_page(
    *,
    operation_id: uuid.UUID,
    kind: str,
    page_size: int,
    generation: int,
) -> tuple[OperationResult, bool]:
    operation = PropertyMatchOperation.objects.select_for_update().get(pk=operation_id)
    if operation.kind != kind:
        raise ValueError("operation kind does not match task")
    if operation.status == PropertyMatchOperation.Status.COMPLETED:
        return operation_result(operation), False
    if operation.generation != generation:
        return operation_result(operation), False
    if operation.scoring_version != SCORING_VERSION:
        operation.status = PropertyMatchOperation.Status.FAILED
        operation.error_code = "scoring_version_changed"
        operation.save(update_fields=("status", "error_code", "updated_at"))
        return operation_result(operation), True

    operation.status = PropertyMatchOperation.Status.RUNNING
    operation.error_code = ""
    while True:
        if operation.phase == PropertyMatchOperation.Phase.CANDIDATES:
            properties = eligible_property_roots().order_by("pk")
            if operation.cursor is not None:
                properties = properties.filter(pk__gt=operation.cursor)
            property_id = properties.values_list("pk", flat=True).first()
            if property_id is None:
                operation.phase = PropertyMatchOperation.Phase.GROUPS
                operation.cursor = None
                operation.secondary_cursor = None
                continue
            counts = measure_indexed_candidate_page(
                property_id,
                limit=page_size,
                after_id=operation.secondary_cursor,
                origin=PropertyMatchSuggestionOrigin.BACKFILL,
                persist_inactive=True,
            )
            operation.evaluated_pairs += counts["evaluated"]
            operation.active_suggestions += counts["active"]
            if counts["next_after_id"] is None:
                operation.cursor = property_id
                operation.secondary_cursor = None
                operation.processed_targets += 1
            else:
                operation.secondary_cursor = uuid.UUID(counts["next_after_id"])
            break

        if operation.phase == PropertyMatchOperation.Phase.SUGGESTIONS:
            suggestions = PropertyMatchSuggestion.objects.exclude(
                state=PropertyMatchSuggestionState.APPROVED
            ).order_by("pk")
            if operation.cursor is not None:
                suggestions = suggestions.filter(pk__gt=operation.cursor)
            suggestion_rows = list(suggestions.values_list("pk", "left_id", "right_id")[:page_size])
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
            property_ids = list(properties.values_list("pk", flat=True)[:page_size])
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
            "secondary_cursor",
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
    return operation_result(operation), True


def record_property_match_operation_failure(
    *, operation_id: uuid.UUID, kind: str, error: Exception
) -> None:
    operation = PropertyMatchOperation.objects.filter(pk=operation_id, kind=kind).first()
    if operation is None or operation.status == PropertyMatchOperation.Status.COMPLETED:
        return
    operation.status = PropertyMatchOperation.Status.FAILED
    operation.error_code = error.__class__.__name__
    operation.save(update_fields=("status", "error_code", "updated_at"))
