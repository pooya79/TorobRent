"""Current page outcomes and retained attempts, serialized by the worker's Source lock."""

from typing import Any

from apps.source_extraction.normalization import normalize_url

from .models import ExtractionRun, SourceExceptionAttempt, SourceExtractionException


def record_exceptions(run: ExtractionRun) -> None:
    if run.state == "cancelled":
        return
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
        if not recorded:
            continue
        if state != "resolved" and (
            exception.first_occurrence is None or run.started_at < exception.first_occurrence
        ):
            exception.first_occurrence = run.started_at
        if current:
            for name, value in defaults.items():
                if name != "first_occurrence":
                    setattr(exception, name, value)
        exception.save()
