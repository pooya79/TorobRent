"""Shared serialization for retained Catalog Curation scoring evidence."""

from typing import Any

from .models import PropertyMatchSuggestionEvaluation


def evaluation_snapshot(evaluation: PropertyMatchSuggestionEvaluation) -> dict[str, Any]:
    return {
        "score": evaluation.score,
        "band": evaluation.band,
        "scoring_version": evaluation.scoring_version,
        "evidence_fingerprint": evaluation.evidence_fingerprint,
        "left_revision": evaluation.left_revision,
        "right_revision": evaluation.right_revision,
        "evidence": evaluation.evidence,
        "origin": evaluation.origin,
    }


def assessment_snapshot(assessment: dict[str, Any], *, origin: str) -> dict[str, Any]:
    return {
        "score": assessment["score"],
        "band": assessment["band"],
        "scoring_version": assessment["scoring_version"],
        "evidence": assessment["signals"],
        "origin": origin,
    }
