import uuid
from dataclasses import asdict

from celery import shared_task
from django.conf import settings
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from .group_consistency import grouped_property_queryset, measure_group_consistency
from .image_evidence import backfill_listing_image_hashes
from .match_suggestions import (
    eligible_property_roots,
    measure_candidates_for_property,
)
from .models import (
    PropertyMatchSuggestion,
    PropertyMatchSuggestionOrigin,
    PropertyMatchSuggestionState,
)
from .services import expire_listings

PROPERTY_MATCH_RECONCILIATION_LOCK = "catalog:property-match-reconciliation"
PROPERTY_MATCH_RECONCILIATION_TIMEOUT = settings.CELERY_TASK_TIME_LIMIT + 5 * 60
GROUP_CONSISTENCY_RECONCILIATION_LOCK = "catalog:group-consistency-reconciliation"
GROUP_CONSISTENCY_RECONCILIATION_TIMEOUT = settings.CELERY_TASK_TIME_LIMIT + 5 * 60


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
