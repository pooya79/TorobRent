"""Explicit Operator action, isolated from Discovery and every background workflow."""

import hashlib
import json
from dataclasses import asdict
from datetime import timedelta
from typing import Any
from uuid import UUID

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Source
from apps.source_extraction.contract import ExtractionContract
from apps.source_extraction.observations import ALL_FIELDS

from .models import (
    SourceProfileRepair,
    SourceProfileRepairResult,
    SourceProfileVersion,
    SourceProposal,
)
from .profiles import _version_evidence, extractor_profile, review_version, validation_pages
from .repair_provider import (
    PROMPT_VERSION,
    SCHEMA_VERSION,
    RepairFailure,
    checked_rules,
    redacted_text,
    request_repair,
)
from .review_claims import SourceProposalReviewConflict

# Allows transport and validation to finish; abandoned attempts never trigger automatic retries.
REPAIR_STALE_SECONDS = 60


def training_evidence(version: SourceProfileVersion, fields: list[str]) -> str:
    training = set(version.validation["training_page_urls"])
    samples = [sample for sample in version.samples if sample["canonical_url"] in training][:5]
    evidence = {
        field: [
            {
                "sample": index,
                "observations": [
                    {
                        "locator": redacted_text(item.get("source_locator", ""), 300),
                        "text": redacted_text(item.get("evidence_snippet", ""), 240),
                    }
                    for item in sample.get("evidence", {}).get(field, [])[:3]
                ],
            }
            for index, sample in enumerate(samples)
        ]
        for field in fields
    }
    return json.dumps(evidence, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def repair_profile(
    *,
    proposal: SourceProposal,
    actor: User,
    reviewed_revision: int,
    reviewed_profile_version: UUID,
    selected_fields: list[str],
    request_id: UUID,
) -> SourceProposal:
    if (
        not 1 <= len(selected_fields) <= 4
        or len(set(selected_fields)) != len(selected_fields)
        or set(selected_fields) - set(ALL_FIELDS)
    ):
        raise ValidationError("Select one to four distinct Source Profile fields.")
    fields = sorted(selected_fields)
    with transaction.atomic():
        proposal = SourceProposal.objects.select_for_update().get(pk=proposal.pk)
        existing = SourceProfileRepair.objects.filter(pk=request_id).first()
        if existing:
            if (
                existing.parent.reservation.proposal_id != proposal.pk
                or existing.actor_id != actor.pk
                or existing.parent_id != reviewed_profile_version
                or existing.reviewed_revision != reviewed_revision
                or existing.selected_fields != fields
            ):
                raise SourceProposalReviewConflict(
                    "repair_request_conflict", "Use a new repair request ID."
                )
            return proposal
        version, _ = review_version(
            proposal=proposal,
            actor=actor,
            reviewed_revision=reviewed_revision,
            reviewed_profile_version=reviewed_profile_version,
        )
        validation_pages(version)
        if SourceProfileRepair.objects.filter(
            parent=version,
            result__isnull=True,
            started_at__gt=timezone.now() - timedelta(seconds=REPAIR_STALE_SECONDS),
        ).exists():
            raise SourceProposalReviewConflict(
                "repair_in_progress", "A repair is already in progress; refresh this case."
            )
        evidence = training_evidence(version, fields)
        attempt = SourceProfileRepair.objects.create(
            id=request_id,
            parent=version,
            actor=actor,
            reviewed_revision=reviewed_revision,
            selected_fields=fields,
            model=settings.SOURCE_PROFILE_REPAIR_MODEL,
            prompt_version=PROMPT_VERSION,
            schema_version=SCHEMA_VERSION,
            evidence_sha256=hashlib.sha256(evidence.encode()).hexdigest(),
        )
    result: Any = None
    validation: dict[str, Any] = {}
    new_version = None
    try:
        result = request_repair(
            model=attempt.model,
            api_key=settings.SOURCE_PROFILE_REPAIR_API_KEY,
            evidence=evidence,
            fields=fields,
        )
        try:
            rules = checked_rules(result, fields)
        except ValueError, TypeError:
            raise RepairFailure(
                "malformed_output",
                "قواعد مدل معتبر نیست؛ فیلدها را دستی اصلاح کنید یا دوباره درخواست دهید.",
            ) from None
        with transaction.atomic():
            # Permissions may change while waiting for the external model.
            actor = User.objects.get(pk=actor.pk)
            proposal = SourceProposal.objects.select_for_update().get(pk=proposal.pk)
            version, _ = review_version(
                proposal=proposal,
                actor=actor,
                reviewed_revision=reviewed_revision,
                reviewed_profile_version=reviewed_profile_version,
            )
            Source.objects.select_for_update().get(pk=version.profile.source_id)
            pages = validation_pages(version)
            contract = ExtractionContract()
            checked = contract.revalidate_profile(
                extractor_profile(version), pages, {**version.rules, **rules}
            )
            validation = asdict(checked.validation)
            if not checked.validation.approval_enabled or any(
                not checked.validation.fields[field].passed for field in fields
            ):
                raise RepairFailure(
                    "validation_failed",
                    "اعتبارسنجی اصلاح موفق نبود؛ شواهد را بررسی و فیلدها را دستی اصلاح کنید.",
                )
            new_version = SourceProfileVersion.objects.create(
                profile=version.profile,
                reservation=version.reservation,
                number=version.profile.versions.latest("number").number + 1,
                parent=version,
                **_version_evidence(checked, pages, contract),
                exclusions=version.exclusions,
                provenance="llm",
                created_by=actor,
            )
            _record_result(
                attempt,
                "succeeded",
                "نسخه تازه ساخته شد؛ پیش از تأیید آن را بررسی کنید.",
                result,
                validation,
                new_version,
            )
        return proposal
    except RepairFailure as exc:
        outcome, detail = exc.outcome, str(exc)
    except SourceProposalReviewConflict, ValidationError:
        outcome, detail = (
            "stale_review",
            "وضعیت بررسی تغییر کرده است؛ پرونده را تازه کنید و دوباره بررسی کنید.",
        )
    except ValueError:
        outcome, detail = (
            "validation_failed",
            "اعتبارسنجی ممکن نشد؛ شواهد را بررسی و دستی اصلاح کنید.",
        )
    _record_result(attempt, outcome, detail, result, validation, None)
    return proposal


def _record_result(
    attempt: SourceProfileRepair,
    outcome: str,
    detail: str,
    result: Any,
    validation: dict[str, Any],
    version: SourceProfileVersion | None,
) -> None:
    # Never retain raw provider errors, HTML, or arbitrary malformed model prose.
    structured = None
    if isinstance(result, dict):
        structured = _audit_value(result)
    finished = timezone.now()
    SourceProfileRepairResult.objects.create(
        repair=attempt,
        outcome=outcome,
        detail=detail,
        structured_result=structured,
        validation=validation,
        result_version=version,
        finished_at=finished,
        duration_ms=max(0, int((finished - attempt.started_at).total_seconds() * 1000)),
    )


def _audit_value(value: Any, depth: int = 0) -> Any:
    if depth > 5:
        return "[omitted]"
    if isinstance(value, dict):
        return {
            redacted_text(key, 100): _audit_value(item, depth + 1)
            for key, item in list(value.items())[:32]
        }
    if isinstance(value, list):
        return [_audit_value(item, depth + 1) for item in value[:16]]
    if isinstance(value, str):
        return redacted_text(value, 300)
    return value
