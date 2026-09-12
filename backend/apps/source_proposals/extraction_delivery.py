"""Durable delivery of queued Extraction Requests to the worker broker."""

import logging
from datetime import timedelta

from celery.exceptions import OperationalError
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from .models import ExtractionRequest, ExtractionRun, ExtractionState

logger = logging.getLogger(__name__)
DELIVERY_ERROR = "ارسال درخواست به صف ممکن نشد؛ سامانه دوباره تلاش می‌کند."


@transaction.atomic
def deliver_extraction_request(request_id: str) -> bool:
    from .tasks import extract_source

    request = (
        ExtractionRequest.objects
        .select_for_update(skip_locked=True)
        .filter(pk=request_id, state=ExtractionState.QUEUED, delivery_pending=True)
        .first()
    )
    if request is None:
        return False
    generation = (
        ExtractionRun.objects
        .filter(request=request)
        .values_list("discovery_generation", flat=True)
        .first()
        or 0
    )
    attempted_at = timezone.now()
    try:
        if generation:
            extract_source.delay(request_id, generation)
        else:
            extract_source.delay(request_id)
    except OperationalError, OSError:
        logger.warning("Extraction broker delivery failed for %s", request_id, exc_info=True)
        request.delivery_error = DELIVERY_ERROR
    else:
        # Eager execution can already have committed the next continuation on this connection.
        current_generation = (
            ExtractionRun.objects
            .filter(request=request)
            .values_list("discovery_generation", flat=True)
            .first()
            or 0
        )
        if current_generation != generation:
            return True
        request.delivery_pending = False
        request.delivery_error = ""
    request.delivery_attempted_at = attempted_at
    request.save(update_fields=("delivery_pending", "delivery_error", "delivery_attempted_at"))
    return not request.delivery_pending


def dispatch_pending_extractions() -> int:
    """Retry unresolved deliveries after a minute; queue duplicates are fenced by the worker."""
    retry_before = timezone.now() - timedelta(minutes=1)
    pending = list(
        ExtractionRequest.objects
        .filter(state=ExtractionState.QUEUED, delivery_pending=True)
        .filter(Q(delivery_attempted_at__isnull=True) | Q(delivery_attempted_at__lte=retry_before))
        .order_by(F("delivery_attempted_at").asc(nulls_first=True), "created_at", "pk")
        .values_list("pk", flat=True)[:100]
    )
    return sum(deliver_extraction_request(str(request_id)) for request_id in pending)
