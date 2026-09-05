import json
import uuid
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def llm_http(monkeypatch, settings):
    settings.SOURCE_PROFILE_REPAIR_API_KEY = "test-key"
    settings.SOURCE_PROFILE_REPAIR_MODEL = "test-model"
    connection = MagicMock()
    response = connection.getresponse.return_value
    response.status = 200
    response.read1.side_effect = [
        json.dumps({
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": json.dumps({
                            "floor_area_sqm": {
                                "kind": "css",
                                "selector": ".area",
                                "path": None,
                                "transform": "integer",
                                "attribute": None,
                                "currency_hint": None,
                            }
                        })
                    },
                }
            ]
        }).encode(),
        b"",
    ]
    monkeypatch.setattr("http.client.HTTPSConnection", lambda *a, **kw: connection)
    return connection


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
    sent = json.loads(llm_http.request.call_args.kwargs["body"])
    assert sent["tool_choice"] == "none"
    assert sent["response_format"]["json_schema"]["strict"] is True
    evidence = json.loads(sent["messages"][1]["content"])
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
    llm_http.getresponse.return_value.read1.side_effect = [
        json.dumps({
            "choices": [{"finish_reason": "stop", "message": {"content": content}}]
        }).encode(),
        b"",
    ]
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
        ("validation", "validation_failed"),
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
    response = llm_http.getresponse.return_value
    rule = {
        "kind": "css",
        "selector": ".area",
        "path": None,
        "transform": "integer",
        "attribute": None,
        "currency_hint": None,
    }
    content = {"floor_area_sqm": rule}
    envelope = {"choices": [{"finish_reason": "stop", "message": {}}]}
    if failure == "timeout":
        llm_http.request.side_effect = TimeoutError
    elif failure == "network":
        llm_http.request.side_effect = OSError("SECRET provider detail")
    elif failure == "status":
        response.status = 500
    elif failure == "extra_field":
        content["city"] = rule
    elif failure == "script":
        rule["selector"] = "script:contains(eval())"
    elif failure == "validation":
        rule["selector"] = ".deposit"
    elif failure == "refusal":
        envelope["choices"][0]["message"]["refusal"] = "Refused"
    elif failure == "tools":
        envelope["choices"][0]["message"]["tool_calls"] = [{"name": "shell"}]
    elif failure == "incomplete":
        envelope["choices"][0]["finish_reason"] = "length"
    elif failure == "unconfigured":
        settings.SOURCE_PROFILE_REPAIR_API_KEY = ""
    envelope["choices"][0]["message"]["content"] = json.dumps(content)
    raw = json.dumps(envelope).encode()
    if failure == "json":
        raw = b"not json"
    if failure == "oversize":
        raw = b"x" * 65537
    response.read1.side_effect = [raw, b""]
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
    if failure == "validation":
        assert audit["validation"]["fields"]["floor_area_sqm"]["conflicts"] == 5
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

    llm_http.request.side_effect = edit_during_request
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
    llm_http.request.side_effect = lambda *args, **kwargs: operator.user_permissions.clear()
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
    llm_http.getresponse.return_value.read1.side_effect = [
        json.dumps({"choices": [{"finish_reason": "stop", "message": message}]}).encode(),
        b"",
    ]
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
