"""Compare retained evidence only; never re-fetch or re-score historical profiles."""

from typing import Any

from apps.source_extraction.observations import ALL_FIELDS

from .models import SourceProfileVersion


def _field_result(sample: dict[str, Any], field: str) -> dict[str, Any]:
    value = sample.get("normalized", {}).get(field)
    conflicts = sample.get("conflicts", {}).get(field, [])
    status = (
        "conflict"
        if conflicts
        else "missing"
        if field in sample.get("unresolved", []) or value is None or value == "unknown"
        else "resolved"
    )
    return {"value": value, "conflicts": conflicts, "status": status}


def compare_profile(version: SourceProfileVersion) -> list[dict[str, Any]]:
    parent = version.parent
    if version.provenance != "llm" or parent is None:
        return []
    before_samples = {sample["canonical_url"]: sample for sample in parent.samples}
    after_samples = {sample["canonical_url"]: sample for sample in version.samples}
    held_out = set(version.validation.get("held_out_page_urls", []))
    comparison = []
    for field in ALL_FIELDS:
        samples = []
        for url in sorted(before_samples.keys() | after_samples.keys()):
            before = _field_result(before_samples.get(url, {}), field)
            after = _field_result(after_samples.get(url, {}), field)
            if before == after:
                continue
            change = "changed"
            if before["status"] != "resolved" and after["status"] == "resolved":
                change = "improved"
            elif before["status"] == "resolved" and after["status"] != "resolved":
                change = "regressed"
            samples.append({
                "url": url,
                "split": "held_out" if url in held_out else "training",
                "before": before,
                "after": after,
                "change": change,
            })
        before_rule = parent.rules.get(field)
        after_rule = version.rules.get(field)
        before_validation = parent.validation.get("fields", {}).get(field)
        after_validation = version.validation.get("fields", {}).get(field)
        if samples or before_rule != after_rule or before_validation != after_validation:
            comparison.append({
                "field": field,
                "before_rule": before_rule,
                "after_rule": after_rule,
                "before_validation": before_validation,
                "after_validation": after_validation,
                "samples": samples,
            })
    return comparison
