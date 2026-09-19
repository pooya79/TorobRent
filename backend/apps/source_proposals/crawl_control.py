"""Operator crawl requests and durable, per-Source recurring fetch schedules."""

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Source

from .models import SourceAssignment, SourceProposal, SourceProposalEvent
from .responsibility import require_source_responsibility
from .source_processing.extraction import submit_request
from .source_state import record_crawl_outcome, set_crawl_schedule


@transaction.atomic
def control_crawl(
    *,
    proposal: SourceProposal,
    actor: User,
    action: str,
    url: str = "",
    max_pages: int | None = None,
    target_detail_pages: int | None = None,
    interval_hours: int = 0,
    reviewed_schedule_revision: int | None = None,
) -> SourceProposal:
    proposal = SourceProposal.objects.select_for_update(no_key=True).get(pk=proposal.pk)
    source = require_source_responsibility(proposal=proposal, actor=actor)
    assignment = SourceAssignment.objects.filter(proposal=proposal, revoked_at__isnull=True).first()
    if source is None or assignment is None:
        raise ValidationError("تخصیص فعال منبع لازم است.")
    if action == "run":
        if (
            assignment.approval is None
            or assignment.representative is None
            or source.profile.active_version_id != assignment.approval.version_id
        ):
            raise ValidationError("تخصیص، نماینده و پروفایل فعال لازم است.")
        from .exclusions import matching_exclusion

        entry_url = url or proposal.website_url
        if matching_exclusion(source, entry_url):
            raise ValidationError("این نشانی مسدود است؛ ابتدا محدودیت آن را بررسی کنید.")
        submit_request(
            assignment_id=assignment.pk,
            proposal_id=str(proposal.pk),
            actor=assignment.representative,
            initiated_by=actor,
            url=entry_url,
            max_pages=max_pages,
            target_detail_pages=target_detail_pages,
        )
    elif action == "schedule":
        set_crawl_schedule(
            source=source,
            interval_hours=interval_hours,
            reviewed_revision=reviewed_schedule_revision,
        )
        SourceProposalEvent.objects.create(
            proposal=proposal,
            actor=actor,
            revision=proposal.revision,
            prior_state=proposal.state,
            new_state=proposal.state,
            reason=f"برنامه دریافت صفحات: هر {interval_hours} ساعت"
            if interval_hours
            else "دریافت زمان‌بندی‌شده غیرفعال شد",
        )
    else:
        raise ValidationError("اقدام معتبر نیست.")
    return proposal


def dispatch_due_crawls() -> int:
    """Serialize with manual changes; missed intervals produce one request, not a backlog."""
    now = timezone.now()
    proposals = list(
        SourceProposal.objects
        .filter(
            source__next_crawl_at__lte=now,
            source__crawl_interval_hours__gt=0,
            source__processing_paused=False,
            sourceassignment__revoked_at__isnull=True,
            sourceassignment__approval__isnull=False,
        )
        .order_by("source__next_crawl_at", "pk")
        .values_list("pk", flat=True)
        .distinct()[:100]
    )
    dispatched = 0
    for proposal_id in proposals:
        with transaction.atomic():
            proposal = SourceProposal.objects.select_for_update(no_key=True).get(pk=proposal_id)
            if proposal.source_id is None:
                continue
            source = Source.objects.select_for_update().get(pk=proposal.source_id)
            if (
                source.processing_paused
                or not source.crawl_interval_hours
                or not source.next_crawl_at
                or source.next_crawl_at > now
            ):
                continue
            try:
                # Savepoint rolls back failed validation without losing the schedule outcome.
                with transaction.atomic():
                    if source.responsible_operator is None:
                        raise ValidationError("اپراتور مسئول منبع تعیین نشده است.")
                    control_crawl(
                        proposal=proposal, actor=source.responsible_operator, action="run"
                    )
            except ValidationError as exc:
                error = exc.messages[0]
            else:
                error = ""
                dispatched += 1
            record_crawl_outcome(source=source, now=now, error=error)
    return dispatched
