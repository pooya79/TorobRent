import uuid
from dataclasses import asdict

from celery import shared_task
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

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
    return measure_candidates_for_property(uuid.UUID(property_id), limit=limit)


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
        if not cache.add(PROPERTY_MATCH_RECONCILIATION_LOCK, token, timeout=30 * 60):
            return {"status": "already_running", "processed": 0, "next_after_id": None}
    elif cache.get(PROPERTY_MATCH_RECONCILIATION_LOCK) != token:
        return {"status": "stale_delivery", "processed": 0, "next_after_id": None}
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
            measure_candidates_for_property(
                property_id,
                limit=limit,
                origin=PropertyMatchSuggestionOrigin.NIGHTLY,
            )
        next_after_id = str(property_ids[-1]) if len(property_ids) == limit else None
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
        if cache.get(PROPERTY_MATCH_RECONCILIATION_LOCK) == token:
            cache.delete(PROPERTY_MATCH_RECONCILIATION_LOCK)
        raise
