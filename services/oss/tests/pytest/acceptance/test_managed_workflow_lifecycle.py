"""
Acceptance tests for the full managed-workflow lifecycle.

For each managed workflow in the evaluator catalog the suite:

  1.  Fetch catalog — GET /preview/evaluators/catalog/templates
  2.  Pick a template
  3.  Pick a preset      — GET /preview/evaluators/catalog/templates/{key}/presets
  4.  Create workflow    — POST /preview/workflows/
                          POST /preview/workflows/variants/
                          POST /preview/workflows/revisions/commit
  5.  Deploy            — GET  /preview/environments/query  (find default env)
                          POST /preview/workflows/revisions/deploy
  6.  Invoke via workflow URL        — POST {services}/{service_path}/invoke
  7.  Invoke via /services/invoke   — POST {services}/services/invoke  (uri in revision)
  8.  Invoke via workflow refs       — POST {api}/preview/workflows/invoke
  9.  Invoke via environment refs    — POST {api}/preview/workflows/invoke
  10. Invoke via revision by value   — POST {services}/services/invoke  (uri + params inline)

Run with:
    pytest services/oss/tests/pytest/acceptance/test_managed_workflow_lifecycle.py -v -m acceptance

Requires AGENTA_API_URL and AGENTA_AUTH_KEY env vars (see hosting/docker-compose/ee/.env.ee.dev).
"""

from __future__ import annotations

from typing import Any, Dict
from uuid import uuid4

import pytest

pytestmark = [pytest.mark.acceptance]

# ---------------------------------------------------------------------------
# Managed workflow test cases
# Each entry describes:
#   template_key  – key in the evaluator catalog
#   uri           – agenta: URI registered in the services app
#   service_path  – mount path under {services_url}
#   parameters    – runtime parameters to use (preset-independent fallback)
#   inputs        – handler inputs dict
#   outputs       – handler outputs value
#   requires_llm  – skip if True (needs external LLM API key)
#   requires_url  – skip if True (needs a live webhook URL)
# ---------------------------------------------------------------------------

MANAGED_WORKFLOW_CASES = [
    pytest.param(
        {
            "template_key": "auto_exact_match",
            "uri": "agenta:builtin:auto_exact_match:v0",
            "service_path": "/builtin/auto_exact_match/v0",
            "parameters": {"correct_answer_key": "correct_answer"},
            "inputs": {"correct_answer": "Paris"},
            "outputs": "Paris",
        },
        id="auto_exact_match",
    ),
    pytest.param(
        {
            "template_key": "auto_contains",
            "uri": "agenta:builtin:auto_contains:v0",
            "service_path": "/builtin/auto_contains/v0",
            "parameters": {"substring": "Paris", "case_sensitive": True},
            "inputs": {},
            "outputs": "The capital of France is Paris",
        },
        id="auto_contains",
    ),
    pytest.param(
        {
            "template_key": "auto_contains_any",
            "uri": "agenta:builtin:auto_contains_any:v0",
            "service_path": "/builtin/auto_contains_any/v0",
            "parameters": {"substrings": ["Paris", "London"], "case_sensitive": True},
            "inputs": {},
            "outputs": "Paris is the capital of France",
        },
        id="auto_contains_any",
    ),
    pytest.param(
        {
            "template_key": "auto_contains_all",
            "uri": "agenta:builtin:auto_contains_all:v0",
            "service_path": "/builtin/auto_contains_all/v0",
            "parameters": {"substrings": ["Paris", "France"], "case_sensitive": True},
            "inputs": {},
            "outputs": "Paris is the capital of France",
        },
        id="auto_contains_all",
    ),
    pytest.param(
        {
            "template_key": "auto_starts_with",
            "uri": "agenta:builtin:auto_starts_with:v0",
            "service_path": "/builtin/auto_starts_with/v0",
            "parameters": {"prefix": "Paris", "case_sensitive": True},
            "inputs": {},
            "outputs": "Paris is the capital of France",
        },
        id="auto_starts_with",
    ),
    pytest.param(
        {
            "template_key": "auto_ends_with",
            "uri": "agenta:builtin:auto_ends_with:v0",
            "service_path": "/builtin/auto_ends_with/v0",
            "parameters": {"suffix": "France", "case_sensitive": True},
            "inputs": {},
            "outputs": "Paris is the capital of France",
        },
        id="auto_ends_with",
    ),
    pytest.param(
        {
            "template_key": "auto_regex_test",
            "uri": "agenta:builtin:auto_regex_test:v0",
            "service_path": "/builtin/auto_regex_test/v0",
            "parameters": {
                "regex_pattern": "^Paris",
                "case_sensitive": True,
                "regex_should_match": True,
            },
            "inputs": {},
            "outputs": "Paris is the capital of France",
        },
        id="auto_regex_test",
    ),
    pytest.param(
        {
            "template_key": "auto_contains_json",
            "uri": "agenta:builtin:auto_contains_json:v0",
            "service_path": "/builtin/auto_contains_json/v0",
            "parameters": {},
            "inputs": {},
            "outputs": '{"city": "Paris"}',
        },
        id="auto_contains_json",
    ),
    pytest.param(
        {
            "template_key": "auto_json_diff",
            "uri": "agenta:builtin:auto_json_diff:v0",
            "service_path": "/builtin/auto_json_diff/v0",
            "parameters": {"correct_answer_key": "correct_answer", "threshold": 0.5},
            "inputs": {"correct_answer": '{"city": "Paris"}'},
            "outputs": '{"city": "Paris"}',
        },
        id="auto_json_diff",
    ),
    pytest.param(
        {
            "template_key": "auto_levenshtein_distance",
            "uri": "agenta:builtin:auto_levenshtein_distance:v0",
            "service_path": "/builtin/auto_levenshtein_distance/v0",
            "parameters": {
                "correct_answer_key": "correct_answer",
                "case_sensitive": True,
                "threshold": 0.5,
            },
            "inputs": {"correct_answer": "Paris"},
            "outputs": "Paris",
        },
        id="auto_levenshtein_distance",
    ),
    pytest.param(
        {
            "template_key": "auto_similarity_match",
            "uri": "agenta:builtin:auto_similarity_match:v0",
            "service_path": "/builtin/auto_similarity_match/v0",
            "parameters": {
                "correct_answer_key": "correct_answer",
                "case_sensitive": True,
                "threshold": 0.5,
            },
            "inputs": {"correct_answer": "Paris"},
            "outputs": "Paris",
        },
        id="auto_similarity_match",
    ),
    pytest.param(
        {
            "template_key": "auto_semantic_similarity",
            "uri": "agenta:builtin:auto_semantic_similarity:v0",
            "service_path": "/builtin/auto_semantic_similarity/v0",
            "parameters": {
                "correct_answer_key": "correct_answer",
                "embedding_model": "text-embedding-3-small",
                "threshold": 0.5,
            },
            "inputs": {"correct_answer": "Paris is the capital of France"},
            "outputs": "Paris is the capital of France",
            "requires_llm": True,
        },
        id="auto_semantic_similarity",
        marks=pytest.mark.llm_required,
    ),
    pytest.param(
        {
            "template_key": "auto_ai_critique",
            "uri": "agenta:builtin:auto_ai_critique:v0",
            "service_path": "/builtin/auto_ai_critique/v0",
            "parameters": {
                "prompt_template": [
                    {
                        "role": "system",
                        "content": "Evaluate the following answer. Return a score between 0 and 1.",
                    },
                    {"role": "user", "content": "Answer: {output}"},
                ],
                "model": "gpt-4o-mini",
                "response_type": "text",
                "threshold": 0.5,
            },
            "inputs": {},
            "outputs": "Paris is the capital of France",
            "requires_llm": True,
        },
        id="auto_ai_critique",
        marks=pytest.mark.llm_required,
    ),
    pytest.param(
        {
            "template_key": "auto_webhook_test",
            "uri": "agenta:builtin:auto_webhook_test:v0",
            "service_path": "/builtin/auto_webhook_test/v0",
            "parameters": {
                "webhook_url": "http://localhost:9999/webhook",
                "correct_answer_key": "correct_answer",
                "threshold": 0.5,
            },
            "inputs": {"correct_answer": "Paris"},
            "outputs": "Paris",
            "requires_url": True,
        },
        id="auto_webhook_test",
        marks=pytest.mark.webhook_required,
    ),
    pytest.param(
        {
            "template_key": "auto_custom_code_run",
            "uri": "agenta:builtin:auto_custom_code_run:v0",
            "service_path": "/builtin/auto_custom_code_run/v0",
            "parameters": {
                "code": (
                    "def evaluate(inputs, output, trace):\n"
                    "    return 1.0 if output == inputs.get('correct_answer') else 0.0\n"
                ),
                "runtime": "python",
                "version": "2",
                "correct_answer_key": "correct_answer",
                "threshold": 0.5,
            },
            "inputs": {"correct_answer": "Paris"},
            "outputs": "Paris",
        },
        id="auto_custom_code_run",
    ),
    pytest.param(
        {
            "template_key": "custom_code",
            "uri": "agenta:custom:code:v0",
            "service_path": "/custom/code/v0",
            "parameters": {
                "code": "def evaluate(inputs, output, trace):\n    return 1.0\n",
                "runtime": "python",
                "threshold": 0.5,
            },
            "inputs": {},
            "outputs": "Paris",
        },
        id="custom_code",
    ),
    pytest.param(
        {
            "template_key": "field_match_test",
            "uri": "agenta:builtin:field_match_test:v0",
            "service_path": "/builtin/field_match_test/v0",
            "parameters": {
                "json_field": "city",
                "correct_answer_key": "correct_answer",
            },
            "inputs": {"correct_answer": "Paris"},
            "outputs": '{"city": "Paris"}',
        },
        id="field_match_test",
    ),
    pytest.param(
        {
            "template_key": "json_multi_field_match",
            "uri": "agenta:builtin:json_multi_field_match:v0",
            "service_path": "/builtin/json_multi_field_match/v0",
            "parameters": {
                "fields": ["city"],
                "correct_answer_key": "correct_answer",
            },
            "inputs": {"correct_answer": '{"city": "Paris"}'},
            "outputs": '{"city": "Paris"}',
        },
        id="json_multi_field_match",
    ),
    pytest.param(
        {
            "template_key": "match",
            "uri": "agenta:builtin:match:v0",
            "service_path": "/builtin/match/v0",
            "parameters": {
                "matchers": [
                    {
                        "kind": "text",
                        "mode": "regex",
                        "path": "$.outputs",
                        "reference": "^Paris",
                    }
                ]
            },
            "inputs": {},
            "outputs": "Paris is the capital",
        },
        id="match",
    ),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _uri_to_service_path(uri: str) -> str:
    """'agenta:builtin:auto_exact_match:v0' → '/builtin/auto_exact_match/v0'"""
    parts = uri.split(":")
    return "/" + "/".join(parts[1:])  # drop leading 'agenta'


def _assert_invoke_response(resp, *, case_id: str) -> dict:
    """Assert the response is a valid WorkflowBatchResponse envelope."""
    assert resp.status_code == 200, (
        f"[{case_id}] Expected 200, got {resp.status_code}: {resp.text[:500]}"
    )
    payload = resp.json()
    assert "version" in payload, f"[{case_id}] Missing 'version': {payload}"
    assert "data" in payload, f"[{case_id}] Missing 'data': {payload}"
    return payload


def _invoke_body(
    case: Dict[str, Any],
    *,
    revision: dict | None = None,
) -> dict:
    """Build a /invoke request body for the given case."""
    body: dict = {
        "data": {
            "inputs": case.get("inputs", {}),
            "outputs": case.get("outputs", ""),
            "trace": case.get("trace", {}),
            "parameters": case.get("parameters", {}),
        }
    }
    if revision is not None:
        body["data"]["revision"] = revision
    return body


# ---------------------------------------------------------------------------
# Module-level cache — lifecycle runs once per template_key
# ---------------------------------------------------------------------------

_LIFECYCLE_CACHE: Dict[str, Dict[str, Any]] = {}


def _lifecycle_setup(case: Dict[str, Any], mod_api, mod_services_api) -> Dict[str, Any]:
    """
    Full lifecycle:
      catalog → template → preset →
      create (workflow + variant + revision) →
      deploy to default environment →
      return all IDs and refs needed by tests.
    """
    template_key = case["template_key"]
    uri = case["uri"]

    # ------------------------------------------------------------------
    # 1. Fetch catalog template
    # ------------------------------------------------------------------
    resp = mod_api("GET", f"/preview/evaluators/catalog/templates/{template_key}")
    # 404 means this template is not in the catalog — use case parameters directly
    template_data: Dict[str, Any] = {}
    if resp.status_code == 200:
        tmpl = resp.json().get("template") or resp.json()
        template_data = tmpl.get("data") or {}

    # ------------------------------------------------------------------
    # 2. Fetch first preset (optional)
    # ------------------------------------------------------------------
    preset_parameters: Dict[str, Any] = {}
    resp = mod_api(
        "GET", f"/preview/evaluators/catalog/templates/{template_key}/presets"
    )
    if resp.status_code == 200:
        presets = resp.json().get("presets", [])
        if presets:
            preset_parameters = (presets[0].get("data") or {}).get("parameters", {})

    # Merge: preset → case fallback (case values take priority)
    parameters = {**preset_parameters, **case.get("parameters", {})}

    # ------------------------------------------------------------------
    # 3. Create workflow (artifact + variant + revision in one shot)
    # ------------------------------------------------------------------
    uid = uuid4().hex[:8]
    name = f"test-{template_key}-{uid}"
    slug = f"test-{template_key}-{uid}".replace("_", "-")

    workflow_data: Dict[str, Any] = {"uri": uri, "parameters": parameters}
    if template_data.get("schemas"):
        workflow_data["schemas"] = template_data["schemas"]

    resp = mod_api(
        "POST",
        "/preview/simple/workflows/",
        json={"workflow": {"slug": slug, "name": name, "data": workflow_data}},
    )
    assert resp.status_code == 200, f"Create simple workflow failed: {resp.text}"
    assert resp.json().get("workflow"), f"No workflow in response: {resp.text}"
    workflow = resp.json()["workflow"]
    workflow_id = workflow["id"]
    revision_id = workflow["revision_id"]
    revision_slug = workflow.get("slug")
    revision_version = None

    # ------------------------------------------------------------------
    # 6. Find default environment (first environment returned)
    # ------------------------------------------------------------------
    resp = mod_api("POST", "/preview/environments/query", json={})
    assert resp.status_code == 200, f"Query environments failed: {resp.text}"
    environments = resp.json().get("environments", [])
    assert environments, "No environments found — create a default environment first"
    environment = environments[0]
    environment_id = environment["id"]
    environment_slug = environment.get("slug") or environment.get("name")

    # ------------------------------------------------------------------
    # 7. Deploy revision to environment
    # ------------------------------------------------------------------
    resp = mod_api(
        "POST",
        "/preview/workflows/revisions/deploy",
        json={
            "workflow_revision_ref": {"id": revision_id},
            "environment_ref": {"id": environment_id},
        },
    )
    assert resp.status_code == 200, f"Deploy failed: {resp.text}"

    return {
        "template_key": template_key,
        "uri": uri,
        "service_path": _uri_to_service_path(uri),
        "parameters": parameters,
        "inputs": case.get("inputs", {}),
        "outputs": case.get("outputs", ""),
        "trace": case.get("trace", {}),
        #
        "workflow_id": workflow_id,
        "revision_id": revision_id,
        "revision_slug": revision_slug,
        "revision_version": revision_version,
        #
        "environment_id": environment_id,
        "environment_slug": environment_slug,
    }


# ---------------------------------------------------------------------------
# Parametrized test class — one instance per managed workflow
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", MANAGED_WORKFLOW_CASES)
class TestManagedWorkflowLifecycle:
    """Full lifecycle for each managed workflow: catalog → create → deploy → invoke×5."""

    @pytest.fixture(scope="function", autouse=True)
    def setup(self, case, mod_api, mod_services_api):
        """Run the full lifecycle once per template_key (cached), inject into test."""
        key = case["template_key"]
        if key not in _LIFECYCLE_CACHE:
            _LIFECYCLE_CACHE[key] = _lifecycle_setup(case, mod_api, mod_services_api)
        self._ctx = _LIFECYCLE_CACHE[key]
        self._mod_services_api = mod_services_api
        self._mod_api = mod_api

    # ------------------------------------------------------------------
    # 6. Invoke via workflow URL (direct service path)
    # ------------------------------------------------------------------

    def test_invoke_via_workflow_url(self):
        """POST {services}/{service_path}/invoke — direct per-service endpoint."""
        ctx = self._ctx
        body = _invoke_body(ctx)

        resp = self._mod_services_api(
            "POST",
            f"{ctx['service_path']}/invoke",
            json=body,
        )
        _assert_invoke_response(resp, case_id=ctx["template_key"])

    # ------------------------------------------------------------------
    # 7. Invoke via /services/invoke (dispatch by URI in revision)
    # ------------------------------------------------------------------

    def test_invoke_via_services_invoke(self):
        """POST /invoke with uri in data.revision.data."""
        ctx = self._ctx
        body = _invoke_body(
            ctx,
            revision={"data": {"uri": ctx["uri"]}},
        )

        resp = self._mod_services_api("POST", "/invoke", json=body)
        _assert_invoke_response(resp, case_id=ctx["template_key"])

    # ------------------------------------------------------------------
    # 8. Invoke via workflow refs (API resolves revision)
    # ------------------------------------------------------------------

    def test_invoke_via_workflow_refs(self):
        """POST /preview/workflows/invoke with workflow/variant/revision IDs."""
        ctx = self._ctx
        body = {
            "references": {
                "workflow": {"id": ctx["workflow_id"]},
                "workflow_revision": {"id": ctx["revision_id"]},
            },
            "data": {
                "inputs": ctx["inputs"],
                "outputs": ctx["outputs"],
                "trace": ctx["trace"],
            },
        }

        resp = self._mod_api("POST", "/preview/workflows/invoke", json=body)
        _assert_invoke_response(resp, case_id=ctx["template_key"])

    # ------------------------------------------------------------------
    # 9. Invoke via environment refs (API resolves via deployment)
    # ------------------------------------------------------------------

    def test_invoke_via_environment_refs(self):
        """POST /preview/workflows/invoke with environment ref."""
        ctx = self._ctx
        body = {
            "references": {
                "environment": {"slug": ctx["environment_slug"]},
            },
            "data": {
                "inputs": ctx["inputs"],
                "outputs": ctx["outputs"],
                "trace": ctx["trace"],
            },
        }

        resp = self._mod_api("POST", "/preview/workflows/invoke", json=body)
        _assert_invoke_response(resp, case_id=ctx["template_key"])

    # ------------------------------------------------------------------
    # 10. Invoke via revision by value (fully stateless, inline data)
    # ------------------------------------------------------------------

    def test_invoke_via_revision_by_value(self):
        """POST /invoke with full revision data inline — no DB lookup."""
        ctx = self._ctx
        body = _invoke_body(
            ctx,
            revision={
                "data": {
                    "uri": ctx["uri"],
                    "parameters": ctx["parameters"],
                }
            },
        )

        resp = self._mod_services_api("POST", "/invoke", json=body)
        _assert_invoke_response(resp, case_id=ctx["template_key"])
