import json
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from apps.source_proposals.repair_provider import output_schema


def test_repair_schema_is_accepted_by_real_langchain_json_schema_conversion() -> None:
    chat = ChatOpenAI(
        model="test-model",
        api_key=SecretStr("test-key"),
        base_url="https://provider.invalid/v1",
        max_retries=0,
    )

    structured = chat.with_structured_output(
        output_schema(["floor_area_sqm"]),
        method="json_schema",
        include_raw=True,
        strict=True,
    )

    assert structured is not None


@pytest.fixture
def llm_http(monkeypatch, settings):
    settings.SOURCE_PROFILE_REPAIR_API_KEY = "test-key"
    settings.SOURCE_PROFILE_REPAIR_MODEL = "test-model"
    settings.SOURCE_PROFILE_REPAIR_BASE_URL = "https://provider.example/v1"
    invoke = MagicMock()
    structured = MagicMock(invoke=invoke)
    client = MagicMock()
    client.with_structured_output.return_value = structured
    constructor = MagicMock(return_value=client)

    def respond(parsed=None, *, parsing_error=None, finish_reason="stop", refusal=None, tools=None):
        raw = SimpleNamespace(
            response_metadata={"finish_reason": finish_reason},
            additional_kwargs={"refusal": refusal} if refusal else {},
            tool_calls=tools or [],
        )
        result = {"raw": raw, "parsed": parsed, "parsing_error": parsing_error}
        invoke.return_value = result
        return result

    default_rule = {
        "floor_area_sqm": {
            "kind": "css",
            "selector": ".area",
            "path": None,
            "transform": "integer",
            "attribute": None,
            "currency_hint": None,
        }
    }
    success_response = respond(default_rule)
    monkeypatch.setattr("apps.source_proposals.repair_provider.ChatOpenAI", constructor)
    return SimpleNamespace(
        request=invoke,
        constructor=constructor,
        client=client,
        respond=respond,
        success_response=success_response,
    )


@pytest.mark.django_db
def test_explicit_repair_creates_validated_version_and_retains_audit(
    api_client, discovered_case, llm_http
):
    _, base, _, _, _ = discovered_case
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    payload = {
        "request_id": str(uuid.uuid4()),
        "reviewed_revision": 1,
        "reviewed_profile_version": original["id"],
        "selected_fields": ["floor_area_sqm"],
    }
    response = api_client.post(f"{base}/profile/repair/", payload, format="json")
    assert response.status_code == 200
    repaired, retained = response.data["profile_versions"]
    assert retained == original
    assert repaired["provenance"] == "llm"
    assert str(repaired["parent"]) == original["id"]
    assert repaired["validation"]["approval_enabled"] is True
    assert (
        repaired["validation"]["held_out_page_urls"] == original["validation"]["held_out_page_urls"]
    )
    assert repaired["is_active"] is False
    assert repaired["status"] == "proposed"
    for field, rule in original["rules"].items():
        if field != "floor_area_sqm":
            assert repaired["rules"][field] == rule
    audit = response.data["profile_repairs"][0]
    assert audit["outcome"] == "succeeded"
    assert audit["model"] == "test-model"
    assert audit["selected_fields"] == ["floor_area_sqm"]
    assert len(audit["evidence_sha256"]) == 64
    assert audit["prompt_version"] and audit["schema_version"]
    assert audit["duration_ms"] >= 0
    assert audit["structured_result"]["floor_area_sqm"]["selector"] == ".area"
    assert audit["result_version"] == repaired["id"]
    configured = llm_http.constructor.call_args.kwargs
    assert configured["base_url"] == "https://provider.example/v1"
    assert configured["model_kwargs"] == {"tool_choice": "none"}
    assert configured["max_retries"] == 0
    assert configured["reasoning_effort"] == "high"
    assert configured["max_completion_tokens"] == 16384
    structured = llm_http.client.with_structured_output.call_args
    assert structured.kwargs == {"method": "json_schema", "include_raw": True, "strict": True}
    messages = llm_http.request.call_args.args[0]
    assert messages[0][0] == "system"
    evidence = json.loads(messages[1][1])
    assert list(evidence) == ["floor_area_sqm"]
    assert len(evidence["floor_area_sqm"]) <= 5
    assert "09121234567" not in str(evidence)
    assert not any(url in str(evidence) for url in original["validation"]["held_out_page_urls"])
    repeated = api_client.post(f"{base}/profile/repair/", payload, format="json")
    assert repeated.status_code == 200
    assert len(repeated.data["profile_versions"]) == 2
    assert llm_http.request.call_count == 1


@pytest.mark.django_db
@pytest.mark.parametrize(
    "content", ['{"floor_area_sqm": NaN}', '{"floor_area_sqm": {}, "floor_area_sqm": {}}']
)
def test_nonstandard_json_is_an_audited_failure(api_client, discovered_case, llm_http, content):
    _, base, _, _, _ = discovered_case
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    llm_http.respond(parsing_error=ValueError(content))
    response = api_client.post(
        f"{base}/profile/repair/",
        {
            "request_id": str(uuid.uuid4()),
            "reviewed_revision": 1,
            "reviewed_profile_version": original["id"],
            "selected_fields": ["floor_area_sqm"],
        },
        format="json",
    )
    assert response.status_code == 200
    assert response.data["profile_versions"] == [original]
    assert response.data["profile_repairs"][0]["outcome"] == "malformed_output"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "failure,outcome",
    [
        ("timeout", "timeout"),
        ("network", "provider_error"),
        ("status", "provider_error"),
        ("json", "malformed_output"),
        ("oversize", "malformed_output"),
        ("extra_field", "malformed_output"),
        ("script", "malformed_output"),
        ("refusal", "malformed_output"),
        ("tools", "malformed_output"),
        ("incomplete", "malformed_output"),
        ("unconfigured", "not_configured"),
    ],
)
def test_repair_failure_preserves_parent_and_active_version(
    api_client, discovered_case, llm_http, settings, failure, outcome
):
    from apps.source_proposals.models import SourceProfile

    proposal, base, _, _, _ = discovered_case
    # An existing active version must never be silently replaced by repair.
    lineage = SourceProfile.objects.get(source=proposal.reservations.get().source)
    lineage.active_version = lineage.versions.first()
    lineage.save()
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    rule = {
        "kind": "css",
        "selector": ".area",
        "path": None,
        "transform": "integer",
        "attribute": None,
        "currency_hint": None,
    }
    content = {"floor_area_sqm": rule}
    if failure == "timeout":
        llm_http.request.side_effect = TimeoutError
    elif failure in ("network", "status"):
        llm_http.request.side_effect = OSError("SECRET provider detail")
    elif failure == "json":
        llm_http.respond(parsing_error=ValueError("invalid provider output"))
    elif failure == "oversize":
        content["padding"] = "x" * 65536
    elif failure == "extra_field":
        content["city"] = rule
    elif failure == "script":
        rule["selector"] = "script:contains(eval())"
    elif failure == "refusal":
        llm_http.respond(content, refusal="Refused")
    elif failure == "tools":
        llm_http.respond(content, tools=[{"name": "shell"}])
    elif failure == "incomplete":
        llm_http.respond(content, finish_reason="length")
    elif failure == "unconfigured":
        settings.SOURCE_PROFILE_REPAIR_API_KEY = ""
    if failure not in ("json", "refusal", "tools", "incomplete"):
        llm_http.respond(content)
    response = api_client.post(
        f"{base}/profile/repair/",
        {
            "request_id": str(uuid.uuid4()),
            "reviewed_revision": 1,
            "reviewed_profile_version": original["id"],
            "selected_fields": ["floor_area_sqm"],
        },
        format="json",
    )
    assert response.status_code == 200
    assert response.data["profile_versions"] == [original]
    audit = response.data["profile_repairs"][0]
    assert audit["outcome"] == outcome
    assert audit["detail"]
    assert audit["result_version"] is None
    assert "SECRET" not in str(response.data)
    retained = api_client.get("/api/v1/operator/source-proposals/").data[0]
    assert retained["profile_repairs"] == response.data["profile_repairs"]
    assert retained["profile_versions"] == [original]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "fields",
    [
        [],
        ["unknown"],
        ["city", "city"],
        ["city", "district", "neighborhood", "floor_area_sqm", "bedroom_count"],
    ],
)
def test_repair_requires_bounded_explicit_field_selection(
    api_client, discovered_case, llm_http, fields
):
    _, base, _, _, _ = discovered_case
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    response = api_client.post(
        f"{base}/profile/repair/",
        {
            "request_id": str(uuid.uuid4()),
            "reviewed_revision": 1,
            "reviewed_profile_version": original["id"],
            "selected_fields": fields,
        },
        format="json",
    )
    assert response.status_code == 400
    assert llm_http.request.call_count == 0


@pytest.mark.django_db
@pytest.mark.parametrize(
    "identity,status",
    [("representative", 403), ("other", 409), ("self", 400), ("expired", 409), ("revoked", 403)],
)
def test_only_assigned_capable_independent_operator_can_repair(
    api_client, discovered_case, llm_http, identity, status
):
    from datetime import timedelta

    from django.contrib.auth.models import Permission
    from django.utils import timezone

    from tests.test_source_proposal_review import make_operator

    proposal, base, operator, representative, _ = discovered_case
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    if identity == "self":
        representative.user_permissions.add(
            Permission.objects.get(codename="review_source_proposal")
        )
    if identity in ("self", "representative"):
        api_client.force_authenticate(representative)
    elif identity == "other":
        api_client.force_authenticate(make_operator(email="other@example.com"))
    elif identity == "expired":
        proposal.review_claims.update(expires_at=timezone.now() - timedelta(seconds=1))
    else:
        operator.user_permissions.clear()
        for attr in ("_perm_cache", "_user_perm_cache"):
            if hasattr(operator, attr):
                delattr(operator, attr)
    response = api_client.post(
        f"{base}/profile/repair/",
        {
            "request_id": str(uuid.uuid4()),
            "reviewed_revision": 1,
            "reviewed_profile_version": original["id"],
            "selected_fields": ["floor_area_sqm"],
        },
        format="json",
    )
    assert response.status_code == status
    assert llm_http.request.call_count == 0


@pytest.mark.django_db
def test_model_response_cannot_overwrite_concurrent_manual_edit(
    api_client, discovered_case, llm_http
):
    _, base, _, _, _ = discovered_case
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]

    def edit_during_request(*args, **kwargs):
        assert (
            api_client.post(
                f"{base}/profile/edit/",
                {
                    "reviewed_revision": 1,
                    "reviewed_profile_version": original["id"],
                    "rules": original["rules"],
                },
                format="json",
            ).status_code
            == 200
        )

    def edit_and_respond(*args, **kwargs):
        edit_during_request(*args, **kwargs)
        return llm_http.success_response

    llm_http.request.side_effect = edit_and_respond
    response = api_client.post(
        f"{base}/profile/repair/",
        {
            "request_id": str(uuid.uuid4()),
            "reviewed_revision": 1,
            "reviewed_profile_version": original["id"],
            "selected_fields": ["floor_area_sqm"],
        },
        format="json",
    )
    assert response.status_code == 200
    assert response.data["profile_repairs"][0]["outcome"] == "stale_review"
    assert [v["provenance"] for v in response.data["profile_versions"]] == ["manual", "discovery"]
    assert response.data["profile_versions"][1] == original


@pytest.mark.django_db
def test_revoked_capability_during_model_call_discards_result(
    api_client, discovered_case, llm_http
):
    _, base, operator, _, _ = discovered_case
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]

    def revoke_and_respond(*args, **kwargs):
        operator.user_permissions.clear()
        return llm_http.success_response

    llm_http.request.side_effect = revoke_and_respond
    response = api_client.post(
        f"{base}/profile/repair/",
        {
            "request_id": str(uuid.uuid4()),
            "reviewed_revision": 1,
            "reviewed_profile_version": original["id"],
            "selected_fields": ["floor_area_sqm"],
        },
        format="json",
    )
    assert response.status_code == 200
    assert response.data["profile_repairs"][0]["outcome"] == "stale_review"
    assert response.data["profile_versions"] == [original]


@pytest.mark.django_db
def test_interrupted_attempt_requires_new_explicit_request(
    api_client, discovered_case, llm_http, monkeypatch
):
    from datetime import timedelta

    from django.utils import timezone

    _, base, _, _, _ = discovered_case
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    payload = {
        "request_id": str(uuid.uuid4()),
        "reviewed_revision": 1,
        "reviewed_profile_version": original["id"],
        "selected_fields": ["floor_area_sqm"],
    }
    llm_http.request.side_effect = SystemExit("Simulated worker shutdown")
    with pytest.raises(SystemExit):
        api_client.post(f"{base}/profile/repair/", payload, format="json")
    retained = api_client.get("/api/v1/operator/source-proposals/").data[0]
    assert retained["profile_repairs"][0]["outcome"] == "pending"
    assert retained["profile_versions"] == [original]
    assert api_client.post(f"{base}/profile/repair/", payload, format="json").status_code == 200
    fresh = {**payload, "request_id": str(uuid.uuid4())}
    assert api_client.post(f"{base}/profile/repair/", fresh, format="json").status_code == 409
    later = timezone.now() + timedelta(seconds=61)
    monkeypatch.setattr(timezone, "now", lambda: later)
    assert (
        api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_repairs"][0][
            "outcome"
        ]
        == "interrupted"
    )
    assert api_client.post(f"{base}/profile/repair/", payload, format="json").status_code == 200
    assert llm_http.request.call_count == 1
    llm_http.request.side_effect = None
    response = api_client.post(f"{base}/profile/repair/", fresh, format="json")
    assert response.status_code == 200
    assert response.data["profile_repairs"][0]["outcome"] == "succeeded"
    assert llm_http.request.call_count == 2


@pytest.mark.django_db
@pytest.mark.parametrize("message", [None, "not an object", []])
def test_malformed_provider_message_is_recorded_without_changing_profile(
    api_client, discovered_case, llm_http, message
):
    _, base, _, _, _ = discovered_case
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    llm_http.respond(message)
    response = api_client.post(
        f"{base}/profile/repair/",
        {
            "request_id": str(uuid.uuid4()),
            "reviewed_revision": 1,
            "reviewed_profile_version": original["id"],
            "selected_fields": ["floor_area_sqm"],
        },
        format="json",
    )
    assert response.status_code == 200
    assert response.data["profile_repairs"][0]["outcome"] == "malformed_output"
    assert response.data["profile_versions"] == [original]


@pytest.mark.django_db
def test_safe_repair_retains_regression_as_draft(api_client, discovered_case, llm_http):
    from apps.source_proposals.models import SourceProfile

    proposal, base, _, _, _ = discovered_case
    lineage = SourceProfile.objects.get(source=proposal.reservations.get().source)
    lineage.active_version = lineage.versions.first()
    lineage.save()
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    llm_http.respond({
        "floor_area_sqm": {
            "kind": "css",
            "selector": ".deposit",
            "path": None,
            "transform": "integer",
            "attribute": None,
            "currency_hint": None,
        }
    })
    response = api_client.post(
        f"{base}/profile/repair/",
        {
            "request_id": str(uuid.uuid4()),
            "reviewed_revision": 1,
            "reviewed_profile_version": original["id"],
            "selected_fields": ["floor_area_sqm"],
        },
        format="json",
    )
    assert response.status_code == 200
    repaired, retained = response.data["profile_versions"]
    assert retained == original
    assert repaired["validation"]["rules_valid"] is True
    assert repaired["validation"]["quality_passed"] is False
    assert repaired["status"] == "proposed"
    assert repaired["is_active"] is False
    assert response.data["profile_repairs"][0]["outcome"] == "succeeded"
    area = next(item for item in repaired["comparison"] if item["field"] == "floor_area_sqm")
    assert area["before_validation"]["conflicts"] == 0
    assert area["after_validation"]["conflicts"] == 5
    assert len(area["samples"]) == 10
    assert {sample["change"] for sample in area["samples"]} == {"regressed"}
    assert (
        api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"]
        == response.data["profile_versions"]
    )


@pytest.mark.django_db
@pytest.mark.parametrize("mode", ["approval_required", "automatic"])
def test_rent_improvement_is_reviewable_while_area_still_fails(
    api_client, discovered_case, llm_http, mode
):
    _, base, _, representative, _ = discovered_case
    original = api_client.get("/api/v1/operator/source-proposals/").data[0]["profile_versions"][0]
    edited = api_client.post(
        f"{base}/profile/edit/",
        {
            "reviewed_revision": 1,
            "reviewed_profile_version": original["id"],
            "rules": {
                **original["rules"],
                "floor_area_sqm": {"kind": "css", "selector": ".deposit", "transform": "integer"},
                "monthly_rent_rial": {
                    "kind": "css",
                    "selector": ".deposit",
                    "transform": "money_rial",
                },
            },
        },
        format="json",
    )
    assert edited.status_code == 200
    parent = edited.data["profile_versions"][0]
    assert parent["validation"]["fields"]["monthly_rent_rial"]["passed"] is False
    llm_http.respond({
        "monthly_rent_rial": {
            "kind": "css",
            "selector": ".rent",
            "path": None,
            "transform": "money_rial",
            "attribute": None,
            "currency_hint": None,
        }
    })
    payload = {
        "request_id": str(uuid.uuid4()),
        "reviewed_revision": 1,
        "reviewed_profile_version": parent["id"],
        "selected_fields": ["monthly_rent_rial"],
    }
    response = api_client.post(f"{base}/profile/repair/", payload, format="json")
    assert response.status_code == 200
    draft = response.data["profile_versions"][0]
    assert draft["validation"]["fields"]["monthly_rent_rial"]["passed"] is True
    assert draft["validation"]["fields"]["floor_area_sqm"]["passed"] is False
    assert draft["validation"]["quality_passed"] is False
    assert draft["is_active"] is False
    assert draft["status"] == "proposed"
    comparison = draft["comparison"]
    rent = next(item for item in comparison if item["field"] == "monthly_rent_rial")
    assert rent["before_validation"]["resolved"] == 0
    assert rent["after_validation"]["resolved"] == 5
    assert rent["before_rule"]["selector"] == ".deposit"
    assert rent["after_rule"]["selector"] == ".rent"
    assert len(rent["samples"]) == 10
    assert {sample["change"] for sample in rent["samples"]} == {"improved"}
    assert {sample["after"]["value"] for sample in rent["samples"]} == {200000000}
    assert {sample["url"] for sample in rent["samples"]} == {
        sample["canonical_url"] for sample in draft["samples"]
    }
    assert {sample["split"] for sample in rent["samples"]} == {"training", "held_out"}
    assert api_client.post(f"{base}/profile/repair/", payload, format="json").data == response.data
    approval = {
        "reviewed_revision": 1,
        "reviewed_profile_version": draft["id"],
        "confirmed": True,
        "review_mode": mode,
    }
    assert api_client.post(f"{base}/profile/approve/", approval, format="json").status_code == 400
    approval.update(limitations_acknowledged=True, reason="محدودیت متراژ بررسی شد.")
    stale = {**approval, "reviewed_profile_version": parent["id"]}
    assert api_client.post(f"{base}/profile/approve/", stale, format="json").status_code == 409
    approved = api_client.post(f"{base}/profile/approve/", approval, format="json")
    assert approved.status_code == 200
    assert approved.data["profile_versions"][0]["is_active"] is True
    assert approved.data["profile_versions"][0]["comparison"] == comparison
    api_client.force_authenticate(representative)
    own = api_client.get(f"/api/v1/source-proposals/{response.data['id']}/")
    assert own.status_code == 200
    assert "profile_versions" not in own.data
    assert "profile_repairs" not in own.data


@pytest.mark.django_db
@pytest.mark.parametrize("restore_responsibility", [False, True])
def test_responsibility_change_during_model_call_discards_result(
    api_client, assigned_case, llm_http, django_capture_on_commit_callbacks, restore_responsibility
):
    from rest_framework.test import APIClient

    from tests.test_source_responsibility import queue_manager, reassign

    proposal, _, operator, _, _ = assigned_case
    api_client.force_authenticate(operator)
    base = f"/api/v1/operator/source-proposals/{proposal.pk}"
    with django_capture_on_commit_callbacks(execute=True):
        started = api_client.post(
            f"{base}/profile/review/",
            {
                "reviewed_revision": 1,
                "confirmed": True,
                "max_pages": 50,
                "target_detail_pages": 30,
            },
            format="json",
        )
    assert started.status_code == 200
    before = api_client.get("/api/v1/operator/source-proposals/").json()[0]
    manager = queue_manager()
    manager_client = APIClient()
    manager_client.force_authenticate(manager)

    def change_during_request(*args, **kwargs):
        assert reassign(manager_client, proposal, manager).status_code == 200
        if restore_responsibility:
            assert reassign(manager_client, proposal, operator, revision=2).status_code == 200
            assert api_client.post(f"{base}/claim/", {}).status_code == 201

    def change_and_respond(*args, **kwargs):
        change_during_request(*args, **kwargs)
        return llm_http.success_response

    llm_http.request.side_effect = change_and_respond
    response = api_client.post(
        f"{base}/profile/repair/",
        {
            "request_id": str(uuid.uuid4()),
            "reviewed_revision": before["revision"],
            "reviewed_profile_version": before["profile_versions"][0]["id"],
            "selected_fields": ["floor_area_sqm"],
        },
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["profile_repairs"][0]["outcome"] == "stale_review"
    assert response.json()["profile_versions"] == before["profile_versions"]
