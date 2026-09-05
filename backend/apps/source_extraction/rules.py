"""The small declarative language accepted at the Source Profile boundary."""

import json
import re
from typing import Any

from .observations import ALL_FIELDS, ALLOWLISTED_TRANSFORMS

# Simple elements, classes, ids, exact attributes and bounded child/descendant paths.
# No pseudo-selectors, wildcard traversal, XPath, expressions, or custom functions.
IDENTIFIER = r"[a-zA-Z_][\w-]{0,80}"
ATTRIBUTE = rf"\[{IDENTIFIER}(?:=['\"][\w:/@.+ -]{{1,120}}['\"])?\]"
ATOM = rf"(?:{IDENTIFIER})?(?:[.#]{IDENTIFIER}|{ATTRIBUTE})*"
SELECTOR_ATOM = re.compile(ATOM)
JSON_PATH = re.compile(r"\$(?:\.[@a-zA-Z_][\w@-]{0,80}){1,8}")
COMMON = {
    "kind",
    "transform",
    "attribute",
    "currency_hint",
    "origin",
    "priority",
    "training_coverage",
}
KINDS = {
    "css": {"selector"},
    "json": {"path", "script_selector", "currency_path"},
    "label_value": {"container_selector", "label_selector", "value_selector", "label_aliases"},
    "table_column": {"container_selector", "header_selector", "value_selector", "label_aliases"},
}
REQUIRED = {
    "css": {"selector"},
    "json": {"path"},
    "label_value": {"container_selector", "label_selector", "value_selector", "label_aliases"},
    "table_column": {"container_selector", "label_aliases"},
}


def validate_field_rules(mapping: Any) -> dict[str, Any]:
    """Reject unsupported syntax before any selector reaches the extraction engine."""
    if not isinstance(mapping, dict) or set(mapping) - set(ALL_FIELDS):
        raise ValueError("Only known Source Profile fields may be edited.")
    if len(json.dumps(mapping, ensure_ascii=False)) > 65536:
        raise ValueError("Source Profile rules exceed the size limit.")
    for field_mapping in mapping.values():
        if not isinstance(field_mapping, dict):
            raise ValueError("Each field must contain a declarative rule.")
        if "variants" in field_mapping:
            variants = field_mapping["variants"]
            if (
                set(field_mapping) != {"variants"}
                or not isinstance(variants, list)
                or not 1 <= len(variants) <= 16
            ):
                raise ValueError("A field may contain one to sixteen rule variants.")
        else:
            variants = [field_mapping]
        for rule in variants:
            _validate_rule(rule)
    return mapping


def _validate_rule(rule: Any) -> None:
    if (
        not isinstance(rule, dict)
        or not isinstance(rule.get("kind"), str)
        or rule["kind"] not in KINDS
    ):
        raise ValueError("Unsupported declarative rule kind.")
    kind = rule["kind"]
    if set(rule) - (COMMON | KINDS[kind]) or REQUIRED[kind] - set(rule):
        raise ValueError("Unknown or missing rule properties.")
    if (
        not isinstance(rule.get("transform"), str)
        or rule["transform"] not in ALLOWLISTED_TRANSFORMS
    ):
        raise ValueError("Unsupported transform.")
    for key, value in rule.items():
        if key in {"priority", "training_coverage"}:
            if type(value) not in (int, float) or not 0 <= value <= 100:
                raise ValueError("Invalid rule metadata.")
        elif key == "label_aliases":
            if (
                not isinstance(value, list)
                or not 1 <= len(value) <= 12
                or any(not isinstance(alias, str) or not 1 <= len(alias) <= 100 for alias in value)
            ):
                raise ValueError("Label aliases must be a bounded list of text.")
        elif not isinstance(value, str) or not 1 <= len(value) <= 300:
            raise ValueError("Rule values must be bounded text.")
        elif key.endswith("selector") and (not _simple_selector(value)):
            raise ValueError("Only simple bounded CSS paths are accepted.")
        elif key in {"path", "currency_path"} and not JSON_PATH.fullmatch(value):
            raise ValueError("Only bounded JSON property paths are accepted.")
        elif key == "attribute" and not re.fullmatch(IDENTIFIER, value):
            raise ValueError("Invalid attribute name.")
        elif key == "script_selector" and value not in {
            "script[type='application/ld+json']",
            'script[type="application/ld+json"]',
        }:
            raise ValueError("Only JSON-LD data scripts may be selected.")


def _simple_selector(value: str) -> bool:
    # Split outside quoted attributes; the parser then receives at most six simple atoms.
    atoms = re.findall(r"(?:[^\s>\[\]]|\[[^\[\]]*\])+|>", value.strip())
    if not atoms or len(atoms) > 11 or atoms[0] == ">" or atoms[-1] == ">":
        return False
    if re.sub(r"\s+", "", "".join(atoms)) != re.sub(r"\s+", "", value):
        return False
    paths = [atom for atom in atoms if atom != ">"]
    return (
        len(paths) <= 6
        and ">>" not in "".join(atoms)
        and all(SELECTOR_ATOM.fullmatch(atom) for atom in paths)
    )
