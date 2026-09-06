"""Current page outcomes and retained attempts, serialized by the worker's Source lock."""

from typing import Any

from django.db.models import Q

from apps.source_extraction.normalization import normalize_url

from .models import (
    ExternalListingCandidate,
    ExtractionRun,
    SourceExceptionAttempt,
    SourceExtractionException,
)


def record_exceptions(run: ExtractionRun) -> None:
    if run.state == "cancelled":
        return
    changes: dict[str, int] = {}
    outcomes: dict[str, tuple[str, str, str]] = {}
    for error in run.errors:
        outcomes[normalize_url(error.get("url", run.request.canonical_url))] = (
            "open",
            str(error["code"]),
            "دریافت یا استخراج صفحه ناموفق بود.",
        )
    for candidate in run.candidates.all():
        outcomes[normalize_url(candidate.external_url)] = (
            ("open", "candidate_checks", "اطلاعات استخراج‌شده نیازمند بررسی است.")
            if candidate.validation_errors
            else ("resolved", "", "استخراج تازه از بررسی اطلاعات عبور کرد.")
        )
    for page in run.skipped_pages:
        outcomes[normalize_url(page["url"])] = ("excluded", "excluded", page["reason"])
    for evidence in run.withdrawals:
        outcomes[normalize_url(evidence["url"])] = ("resolved", "", "آگهی دیگر در دسترس نیست.")
    for url, (state, problem, detail) in outcomes.items():
        defaults: dict[str, Any] = {
            "state": state,
            "problem": problem,
            "detail": detail,
            "last_run": run,
            "last_attempt": run.attempts,
            "last_attempt_at": run.started_at,
            "first_occurrence": run.started_at if state != "resolved" else None,
        }
        exception, created = SourceExtractionException.objects.get_or_create(
            source=run.request.assignment.source, canonical_url=url, defaults=defaults
        )
        previous = exception.last_run.request
        current = created or (run.request.created_at, str(run.request_id), run.attempts) >= (
            previous.created_at,
            str(previous.pk),
            exception.last_attempt,
        )
        _, recorded = SourceExceptionAttempt.objects.get_or_create(
            exception=exception,
            run=run,
            attempt=run.attempts,
            defaults={
                "attempted_at": run.started_at,
                "state": state,
                "problem": problem,
                "detail": detail,
                "is_current": current,
            },
        )
        candidates = ExternalListingCandidate.objects.filter(
            source=run.request.assignment.source,
            external_url=url,
            state__in=("pending", "changes_requested"),
            discovery_version__isnull=True,
        )
        if current:
            candidates.filter(
                Q(extraction_run__isnull=True)
                | Q(extraction_run__request__created_at__lt=run.request.created_at)
                | Q(
                    extraction_run__request__created_at=run.request.created_at,
                    extraction_run__request_id__lt=run.request_id,
                )
            ).update(superseded=True)
        else:
            candidates.filter(extraction_run=run).update(superseded=True)
        if not recorded:
            continue
        if (current and state != exception.state) or created:
            change = (
                ("new" if created or exception.first_occurrence is None else "reopened")
                if state == "open"
                else "resolved"
                if not created and exception.state == "open" and state == "resolved"
                else ""
            )
            if change:
                changes[change] = changes.get(change, 0) + 1
        if state != "resolved" and (
            exception.first_occurrence is None or run.started_at < exception.first_occurrence
        ):
            exception.first_occurrence = run.started_at
        if current:
            for name, value in defaults.items():
                if name != "first_occurrence":
                    setattr(exception, name, value)
        exception.save()

    run.withdrawals = [
        evidence
        for evidence in run.withdrawals
        if SourceExtractionException.objects.filter(
            source=run.request.assignment.source,
            canonical_url=normalize_url(evidence["url"]),
            last_run=run,
        ).exists()
    ]
    run.save(update_fields=("withdrawals",))

    if changes:
        from .exception_notifications import aggregate_changes

        aggregate_changes(run.request.assignment.source, changes)
