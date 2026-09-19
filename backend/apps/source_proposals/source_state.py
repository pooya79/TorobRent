"""Mutations of operational state retained on the Catalog Source model.

Callers serialize the Source row before invoking these operations. Keeping the
mutations here makes their revisions and audit effects visible in one place.
"""

from datetime import datetime, timedelta

from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Source

from .models import ExternalListingCandidate, SourceResponsibilityChange
from .review_claims import SourceProposalReviewConflict


def record_responsibility(
    *, source: Source, operator: User | None, actor: User, reason: str
) -> None:
    source.responsible_operator = operator
    source.responsibility_revision += 1
    source.save(update_fields=("responsible_operator", "responsibility_revision"))
    SourceResponsibilityChange.objects.create(
        source=source,
        operator=operator,
        actor=actor,
        revision=source.responsibility_revision,
        reason=reason,
    )


def advance_processing_revision(source: Source) -> None:
    """Fence old work and retire legacy candidates without a request revision."""
    source.processing_revision += 1
    source.save(update_fields=("processing_revision",))
    ExternalListingCandidate.objects.filter(
        source=source,
        extraction_run__isnull=True,
        discovery_version__isnull=True,
        state__in=("pending", "changes_requested"),
    ).update(superseded=True)


def set_crawl_schedule(
    *, source: Source, interval_hours: int, reviewed_revision: int | None
) -> None:
    if reviewed_revision != source.crawl_schedule_revision:
        raise SourceProposalReviewConflict(
            "schedule_conflict", "برنامه تغییر کرده؛ صفحه را تازه کنید."
        )
    if interval_hours not in (0, 1, 6, 12, 24, 72, 168):
        raise ValidationError("فاصله اجرای معتبر انتخاب کنید.")
    source.crawl_interval_hours = interval_hours
    source.crawl_schedule_revision += 1
    source.next_crawl_at = (
        timezone.now() + timedelta(hours=interval_hours) if interval_hours else None
    )
    source.crawl_schedule_error = ""
    source.save(
        update_fields=(
            "crawl_interval_hours",
            "crawl_schedule_revision",
            "next_crawl_at",
            "crawl_schedule_error",
        )
    )


def record_crawl_outcome(*, source: Source, now: datetime, error: str = "") -> None:
    """Advance one interval after an attempted scheduled dispatch."""
    source.crawl_schedule_error = error
    source.next_crawl_at = now + timedelta(hours=source.crawl_interval_hours)
    source.save(update_fields=("next_crawl_at", "crawl_schedule_error"))
