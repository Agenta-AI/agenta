"""
Acceptance tests for the full managed-workflow lifecycle.

For each managed workflow in the workflow or evaluator catalog the suite:

  1.  Fetch catalog template
  2.  Pick a template
  3.  Pick a preset
  4.  Create workflow    — POST /workflows/
                          POST /workflows/variants/
                          POST /workflows/revisions/commit
  5.  Deploy            — GET  /environments/query  (find default env)
                          POST /workflows/revisions/deploy
  6.  Invoke via workflow URL        — POST {services}/{service_path}/invoke
  7.  Invoke via /services/invoke   — POST {services}/services/invoke  (uri in revision)
  8.  Invoke via workflow refs       — POST {api}/workflows/invoke
  9.  Invoke via environment refs    — POST {api}/workflows/invoke
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
#   template_key  – key in the workflow or evaluator catalog
#   uri           – agenta: URI registered in the services app
#   service_path  – mount path under {services_url}
#   parameters    – runtime parameters to use (preset-independent fallback)
#   inputs        – handler inputs dict
#   outputs       – handler outputs value (when applicable)
#   messages      – chat message history (chat workflows)
#   requires_llm  – skip if True (needs external LLM API key)
#   requires_url  – skip if True (needs a live webhook URL)
# ---------------------------------------------------------------------------

MANAGED_WORKFLOW_CASES = [
    pytest.param(
        {
            "template_key": "chat",
            "catalog_root": "/workflows/catalog/templates",
            "uri": "agenta:builtin:chat:v0",
            "flags": {"is_application": True, "is_chat": True},
            "parameters": {
                "prompt": {
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are an expert in geography.",
                        }
                    ],
                    "llm_config": {"model": "gpt-4o-mini"},
                }
            },
            "inputs": {"context": "Focus on concise answers."},
            "messages": [{"role": "user", "content": "What is the capital of France?"}],
            "output_kind": "assistant_message",
            "requires_llm": True,
        },
        id="chat",
        marks=[
            pytest.mark.llm_required,
        ],
    ),
    pytest.param(
        {
            "template_key": "auto_exact_match",
            "uri": "agenta:builtin:auto_exact_match:v0",
            "service_path": "/auto_exact_match/v0",
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
            "service_path": "/auto_contains/v0",
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
            "service_path": "/auto_contains_any/v0",
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
            "service_path": "/auto_contains_all/v0",
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
            "service_path": "/auto_starts_with/v0",
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
            "service_path": "/auto_ends_with/v0",
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
            "service_path": "/auto_regex_test/v0",
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
            "service_path": "/auto_contains_json/v0",
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
            "service_path": "/auto_json_diff/v0",
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
            "service_path": "/auto_levenshtein_distance/v0",
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
            "service_path": "/auto_similarity_match/v0",
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
            "service_path": "/auto_semantic_similarity/v0",
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
        marks=[
            pytest.mark.llm_required,
            # pytest.mark.xfail(reason="requires LLM API key", strict=False),
        ],
    ),
    pytest.param(
        {
            "template_key": "auto_ai_critique",
            "uri": "agenta:builtin:auto_ai_critique:v0",
            "service_path": "/auto_ai_critique/v0",
            "parameters": {
                "prompt_template": [
                    {
                        "role": "system",
                        "content": "Evaluate the following answer. Respond with a JSON object containing a 'score' field (number between 0 and 1).",
                    },
                    {"role": "user", "content": "Answer: {output}"},
                ],
                "model": "gpt-4o-mini",
                "response_type": "json_schema",
                "json_schema": {
                    "name": "evaluation_result",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "score": {"type": "number"},
                        },
                        "required": ["score"],
                        "additionalProperties": False,
                    },
                    "strict": True,
                },
                "threshold": 0.5,
            },
            "inputs": {},
            "outputs": "Paris is the capital of France",
            "output_kind": "numeric_score",
            "requires_llm": True,
        },
        id="auto_ai_critique",
        marks=[
            pytest.mark.llm_required,
            # pytest.mark.xfail(reason="requires LLM API key", strict=False),
        ],
    ),
    pytest.param(
        {
            "template_key": "auto_webhook_test",
            "uri": "agenta:builtin:auto_webhook_test:v0",
            "service_path": "/auto_webhook_test/v0",
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
        marks=[
            pytest.mark.webhook_required,
            pytest.mark.xfail(reason="requires live webhook URL", strict=False),
        ],
    ),
    pytest.param(
        {
            "template_key": "auto_custom_code_run",
            "uri": "agenta:builtin:auto_custom_code_run:v0",
            "service_path": "/auto_custom_code_run/v0",
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
            "service_path": "/code/v0",
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
            "service_path": "/field_match_test/v0",
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
            "service_path": "/json_multi_field_match/v0",
            "parameters": {
                "fields": ["city"],
                "correct_answer_key": "correct_answer",
            },
            "inputs": {"correct_answer": '{"city": "Paris"}'},
            "outputs": '{"city": "Paris"}',
            "output_kind": "field_scores",
        },
        id="json_multi_field_match",
    ),
    pytest.param(
        {
            "template_key": "match",
            "uri": "agenta:builtin:match:v0",
            "service_path": "/match/v0",
            "parameters": {
                "matchers": [
                    {
                        "mode": "text",
                        "match": "regex",
                        "target": "$.outputs",
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
    """'agenta:builtin:auto_exact_match:v0' → '/auto_exact_match/v0'"""
    parts = uri.split(":")
    return "/" + "/".join(parts[2:])  # drop leading 'agenta' and kind


def _assert_invoke_response(resp, *, case_id: str) -> dict:
    """Assert the response is a valid WorkflowBatchResponse envelope."""
    assert resp.status_code == 200, (
        f"[{case_id}] Expected 200, got {resp.status_code}: {resp.text[:500]}"
    )
    payload = resp.json()
    assert "version" in payload, f"[{case_id}] Missing 'version': {payload}"
    assert "data" in payload, f"[{case_id}] Missing 'data': {payload}"
    return payload


def _maybe_xfail_for_llm_provider_error(
    resp,
    *,
    case_id: str,
    allow_llm_failure: bool = False,
) -> None:
    if not allow_llm_failure:
        return

    text = (getattr(resp, "text", "") or "")[:2000]
    markers = (
        "RateLimitError",
        "AuthenticationError",
        "insufficient_quota",
        "exceeded your current quota",
        "prompt-completion-error",
        "No API key found for model",
        "Incorrect API key provided",
        "api_key client option must be set",
        "OPENAI_API_KEY environment variable",
        "invalid_api_key",
    )
    if resp.status_code in {400, 401, 424, 429, 500} and any(
        marker in text for marker in markers
    ):
        pytest.xfail(f"[{case_id}] live LLM provider unavailable or quota exhausted")


def _build_data_payload(case: Dict[str, Any]) -> dict:
    data: dict = {}
    if "inputs" in case:
        data["inputs"] = case["inputs"]
    if "messages" in case:
        data["messages"] = case["messages"]
    if "outputs" in case:
        data["outputs"] = case["outputs"]
    if "trace" in case:
        data["trace"] = case["trace"]
    if "parameters" in case:
        data["parameters"] = case["parameters"]
    return data


def _invoke_body(
    case: Dict[str, Any],
    *,
    revision: dict | None = None,
) -> dict:
    """Build a /invoke request body for the given case."""
    body: dict = {"data": _build_data_payload(case)}
    if revision is not None:
        body["data"]["revision"] = revision
    return body


def _inspect_body(body: dict) -> dict:
    inspect: dict = {}

    for key in ("version", "references", "selector", "flags", "tags", "meta"):
        if key in body:
            inspect[key] = body[key]

    if "revision" in body:
        inspect["revision"] = body["revision"]

    data = body.get("data")
    if isinstance(data, dict) and "revision" in data:
        inspect["revision"] = data["revision"]

    return inspect


def _post_invoke_with_inspect(
    services_api,
    path: str,
    *,
    json: dict,
    inspect_json: dict | None = None,
):
    inspect_path = "/inspect"
    if inspect_json is None:
        if path == "/invoke":
            inspect_json = _inspect_body(json)
        else:
            inspect_path = f"{path[: -len('/invoke')]}/inspect"
            inspect_json = _inspect_body(json)
    elif path == "/invoke":
        inspect_path = "/inspect"

    inspect_resp = services_api(
        "POST",
        inspect_path,
        json=inspect_json,
    )
    assert inspect_resp.status_code == 200, (
        f"Inspect failed for {inspect_path}: {inspect_resp.text[:500]}"
    )
    return services_api("POST", path, json=json)


def _assert_case_outputs(payload: dict, *, case: Dict[str, Any]) -> None:
    case_id = case["template_key"]
    outputs = payload["data"]["outputs"]
    output_kind = case.get("output_kind", "success_bool")

    if output_kind == "assistant_message":
        assert isinstance(outputs, dict), (
            f"[{case_id}] outputs should be a dict, got: {type(outputs)}"
        )
        assert outputs.get("role") == "assistant", (
            f"[{case_id}] expected assistant role, got: {outputs}"
        )
        content = outputs.get("content")
        assert isinstance(content, str), (
            f"[{case_id}] expected string content, got: {outputs}"
        )
        assert content.strip(), f"[{case_id}] expected non-empty content: {outputs}"
        return

    assert isinstance(outputs, dict), (
        f"[{case_id}] outputs should be a dict, got: {type(outputs)}"
    )

    if output_kind == "field_scores":
        assert "aggregate_score" in outputs, (
            f"[{case_id}] outputs missing 'aggregate_score': {outputs}"
        )
        assert isinstance(outputs["aggregate_score"], (int, float)), (
            f"[{case_id}] 'aggregate_score' should be numeric, got: {outputs}"
        )
        return

    if output_kind == "numeric_score":
        assert "score" in outputs, f"[{case_id}] outputs missing 'score': {outputs}"
        assert isinstance(outputs["score"], (int, float)), (
            f"[{case_id}] 'score' should be numeric, got: {outputs}"
        )
        assert 0 <= outputs["score"] <= 1, (
            f"[{case_id}] 'score' should be between 0 and 1, got: {outputs}"
        )
        return

    assert "success" in outputs, f"[{case_id}] outputs missing 'success': {outputs}"
    assert isinstance(outputs["success"], bool), (
        f"[{case_id}] 'success' should be bool, got: {type(outputs['success'])}"
    )


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
    catalog_root = case.get("catalog_root", "/evaluators/catalog/templates")

    # ------------------------------------------------------------------
    # 1. Fetch catalog template
    # ------------------------------------------------------------------
    resp = mod_api("GET", f"{catalog_root}/{template_key}")
    # 404 means this template is not in the catalog — use case parameters directly
    template_data: Dict[str, Any] = {}
    if resp.status_code == 200:
        tmpl = resp.json().get("template") or resp.json()
        template_data = tmpl.get("data") or {}

    # ------------------------------------------------------------------
    # 2. Fetch first preset (optional)
    # ------------------------------------------------------------------
    preset_parameters: Dict[str, Any] = {}
    resp = mod_api("GET", f"{catalog_root}/{template_key}/presets")
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
        "/simple/workflows/",
        json={
            "workflow": {
                "slug": slug,
                "name": name,
                "flags": case.get("flags", {}),
                "data": workflow_data,
            }
        },
    )
    assert resp.status_code == 200, f"Create simple workflow failed: {resp.text}"
    assert resp.json().get("workflow"), f"No workflow in response: {resp.text}"
    workflow = resp.json()["workflow"]
    workflow_id = workflow["id"]
    workflow_slug = workflow.get("slug")
    revision_id = workflow["revision_id"]
    revision_version = None

    # ------------------------------------------------------------------
    # 6. Find default environment (first environment returned)
    # ------------------------------------------------------------------
    resp = mod_api("POST", "/environments/query", json={})
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
        "/workflows/revisions/deploy",
        json={
            "workflow_revision_ref": {"id": revision_id},
            "environment_ref": {"id": environment_id},
        },
    )
    assert resp.status_code == 200, f"Deploy failed: {resp.text}"

    ctx: Dict[str, Any] = {
        "template_key": template_key,
        "uri": uri,
        "service_path": _uri_to_service_path(uri),
        "parameters": parameters,
        "inputs": case.get("inputs", {}),
        "trace": case.get("trace", {}),
        "output_kind": case.get("output_kind", "success_bool"),
        "requires_llm": case.get("requires_llm", False),
        #
        "workflow_id": workflow_id,
        "workflow_slug": workflow_slug,
        "revision_id": revision_id,
        "revision_version": revision_version,
        #
        "environment_id": environment_id,
        "environment_slug": environment_slug,
    }
    if "outputs" in case:
        ctx["outputs"] = case["outputs"]
    if "messages" in case:
        ctx["messages"] = case["messages"]
    return ctx


# ---------------------------------------------------------------------------
# Parametrized test class — one instance per managed workflow
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", MANAGED_WORKFLOW_CASES)
class TestManagedWorkflowLifecycle:
    """Full lifecycle for each managed workflow: catalog → create → deploy → invoke×3."""

    @pytest.fixture(scope="function", autouse=True)
    def setup(self, case, mod_api, mod_services_api):
        """Run the full lifecycle once per template_key (cached), inject into test."""
        key = case["template_key"]
        if key not in _LIFECYCLE_CACHE:
            _LIFECYCLE_CACHE[key] = _lifecycle_setup(case, mod_api, mod_services_api)
        self._ctx = _LIFECYCLE_CACHE[key]
        self._mod_services_api = mod_services_api

    def test_invoke_direct(self):
        """POST {services}/{service_path}/invoke — direct per-service mount, no dispatcher."""
        ctx = self._ctx
        resp = _post_invoke_with_inspect(
            self._mod_services_api,
            f"{ctx['service_path']}/invoke",
            json=_invoke_body(ctx),
            inspect_json={
                "revision": {
                    "data": {
                        "uri": ctx["uri"],
                        "parameters": ctx["parameters"],
                    }
                }
            },
        )
        _maybe_xfail_for_llm_provider_error(
            resp,
            case_id=ctx["template_key"],
            allow_llm_failure=ctx.get("requires_llm", False),
        )
        _assert_invoke_response(resp, case_id=ctx["template_key"])

    def test_inspect_direct_returns_canonical_revision(self):
        """POST {services}/{service_path}/inspect — direct mount returns canonical URI."""
        ctx = self._ctx
        resp = self._mod_services_api(
            "POST",
            f"{ctx['service_path']}/inspect",
            json={},
        )
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        assert payload["data"]["revision"]["data"]["uri"] == ctx["uri"]

    def test_invoke_inline(self):
        """POST /invoke with URI + parameters inline — dispatcher routes by URI, no DB lookup."""
        ctx = self._ctx
        resp = _post_invoke_with_inspect(
            self._mod_services_api,
            "/invoke",
            json=_invoke_body(
                ctx,
                revision={"data": {"uri": ctx["uri"], "parameters": ctx["parameters"]}},
            ),
        )
        _maybe_xfail_for_llm_provider_error(
            resp,
            case_id=ctx["template_key"],
            allow_llm_failure=ctx.get("requires_llm", False),
        )
        _assert_invoke_response(resp, case_id=ctx["template_key"])

    def test_invoke_by_env(self):
        """POST /invoke with env ref + selector key — SDK resolves revision via retrieve."""
        ctx = self._ctx
        data = {"inputs": ctx.get("inputs", {})}
        if "messages" in ctx:
            data["messages"] = ctx["messages"]
        if "outputs" in ctx:
            data["outputs"] = ctx["outputs"]
        resp = _post_invoke_with_inspect(
            self._mod_services_api,
            "/invoke",
            json={
                "references": {
                    "environment": {"slug": ctx["environment_slug"]},
                },
                "selector": {
                    "key": f"{ctx['workflow_slug']}.revision",
                },
                "data": data,
            },
        )
        _maybe_xfail_for_llm_provider_error(
            resp,
            case_id=ctx["template_key"],
            allow_llm_failure=ctx.get("requires_llm", False),
        )
        _assert_invoke_response(resp, case_id=ctx["template_key"])

    def test_output_matches_expected_shape(self):
        """Invoke returns the expected outputs envelope for the managed workflow."""
        ctx = self._ctx
        resp = _post_invoke_with_inspect(
            self._mod_services_api,
            f"{ctx['service_path']}/invoke",
            json=_invoke_body(ctx),
            inspect_json={
                "revision": {
                    "data": {
                        "uri": ctx["uri"],
                        "parameters": ctx["parameters"],
                    }
                }
            },
        )
        _maybe_xfail_for_llm_provider_error(
            resp,
            case_id=ctx["template_key"],
            allow_llm_failure=ctx.get("requires_llm", False),
        )
        payload = _assert_invoke_response(resp, case_id=ctx["template_key"])
        _assert_case_outputs(payload, case=ctx)


# ---------------------------------------------------------------------------
# Match-specific test class — exhaustive kind/mode/aggregation coverage
# ---------------------------------------------------------------------------

_MATCH_SERVICE_PATH = "/match/v0"
_MATCH_URI = "agenta:builtin:match:v0"


def _match_inline(services_api, matchers: list, inputs: dict = None, outputs=None):
    """Helper: POST /invoke with match matchers inline (no DB lookup)."""
    return _post_invoke_with_inspect(
        services_api,
        "/invoke",
        json={
            "data": {
                "inputs": inputs or {},
                "outputs": outputs if outputs is not None else "",
                "revision": {
                    "data": {
                        "uri": _MATCH_URI,
                        "parameters": {"matchers": matchers},
                    }
                },
            }
        },
    )


def _match_direct(services_api, matchers: list, inputs: dict = None, outputs=None):
    """Helper: POST /match/v0/invoke (direct mount)."""
    return _post_invoke_with_inspect(
        services_api,
        f"{_MATCH_SERVICE_PATH}/invoke",
        json={
            "data": {
                "inputs": inputs or {},
                "outputs": outputs if outputs is not None else "",
                "parameters": {"matchers": matchers},
            }
        },
        inspect_json={
            "revision": {
                "data": {
                    "uri": _MATCH_URI,
                    "parameters": {"matchers": matchers},
                }
            }
        },
    )


def _assert_match_result(resp, *, expected_success: bool = None, min_results: int = 1):
    """Assert the match response envelope and return the outputs dict."""
    assert resp.status_code == 200, (
        f"Expected 200, got {resp.status_code}: {resp.text[:500]}"
    )
    payload = resp.json()
    assert "version" in payload, f"Missing 'version': {payload}"
    assert "data" in payload, f"Missing 'data': {payload}"
    outputs = payload["data"]["outputs"]
    assert isinstance(outputs, dict), f"outputs should be dict, got: {outputs}"
    assert "score" in outputs, f"Missing 'score' in outputs: {outputs}"
    assert "success" in outputs, f"Missing 'success' in outputs: {outputs}"
    matcher_nodes = {k: v for k, v in outputs.items() if k not in ("score", "success")}
    assert len(matcher_nodes) >= min_results, (
        f"Expected >= {min_results} matcher result(s), got: {matcher_nodes}"
    )
    if expected_success is not None:
        first = next(iter(matcher_nodes.values()))
        assert first.get("success") is expected_success, (
            f"Expected success={expected_success}, got: {first}"
        )
    return outputs


@pytest.mark.acceptance
class TestMatchV0Kinds:
    """Tests for match:v0 — kind=text and kind=json across all modes."""

    # ------------------------------------------------------------------ text

    def test_text_valid_non_empty_string(self, services_api):
        """text/valid: non-empty string → success=True."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "valid",
                    "target": "$.outputs",
                }
            ],
            outputs="Paris",
        )
        _assert_match_result(resp, expected_success=True)

    def test_text_exact_match(self, services_api):
        """text/exact: identical string → success=True."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "exact",
                    "target": "$.outputs",
                    "reference": "Paris",
                }
            ],
            outputs="Paris",
        )
        _assert_match_result(resp, expected_success=True)

    def test_text_exact_mismatch(self, services_api):
        """text/exact: different string → success=False."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "exact",
                    "target": "$.outputs",
                    "reference": "Paris",
                }
            ],
            outputs="London",
        )
        _assert_match_result(resp, expected_success=False)

    def test_text_starts_with_success(self, services_api):
        """text/starts_with: output begins with prefix → success=True."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "starts_with",
                    "target": "$.outputs",
                    "reference": "Paris",
                }
            ],
            outputs="Paris is the capital",
        )
        _assert_match_result(resp, expected_success=True)

    def test_text_starts_with_failure(self, services_api):
        """text/starts_with: output does not begin with prefix → success=False."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "starts_with",
                    "target": "$.outputs",
                    "reference": "Paris",
                }
            ],
            outputs="The capital is Paris",
        )
        _assert_match_result(resp, expected_success=False)

    def test_text_ends_with_success(self, services_api):
        """text/ends_with: output ends with suffix → success=True."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "ends_with",
                    "target": "$.outputs",
                    "reference": "France",
                }
            ],
            outputs="Paris is the capital of France",
        )
        _assert_match_result(resp, expected_success=True)

    def test_text_ends_with_failure(self, services_api):
        """text/ends_with: output does not end with suffix → success=False."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "ends_with",
                    "target": "$.outputs",
                    "reference": "France",
                }
            ],
            outputs="France is where Paris is",
        )
        _assert_match_result(resp, expected_success=False)

    def test_text_contains_single_success(self, services_api):
        """text/contains: substring present → success=True."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "contains",
                    "target": "$.outputs",
                    "reference": "capital",
                }
            ],
            outputs="Paris is the capital of France",
        )
        _assert_match_result(resp, expected_success=True)

    def test_text_contains_single_failure(self, services_api):
        """text/contains: substring absent → success=False."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "contains",
                    "target": "$.outputs",
                    "reference": "Berlin",
                }
            ],
            outputs="Paris is the capital of France",
        )
        _assert_match_result(resp, expected_success=False)

    def test_text_contains_any_one_present(self, services_api):
        """text/contains references match=any: one substring present → success=True."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "contains",
                    "target": "$.outputs",
                    "references": ["Paris", "Berlin", "Rome"],
                    "contains": "any",
                }
            ],
            outputs="Paris is the capital",
        )
        _assert_match_result(resp, expected_success=True)

    def test_text_contains_any_none_present(self, services_api):
        """text/contains references match=any: none present → success=False."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "contains",
                    "target": "$.outputs",
                    "references": ["Berlin", "Rome", "Madrid"],
                    "contains": "any",
                }
            ],
            outputs="Paris is the capital",
        )
        _assert_match_result(resp, expected_success=False)

    def test_text_contains_all_all_present(self, services_api):
        """text/contains references match=all: all substrings present → success=True."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "contains",
                    "target": "$.outputs",
                    "references": ["Paris", "France"],
                    "contains": "all",
                }
            ],
            outputs="Paris is the capital of France",
        )
        _assert_match_result(resp, expected_success=True)

    def test_text_contains_all_one_missing(self, services_api):
        """text/contains references match=all: one substring absent → success=False."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "contains",
                    "target": "$.outputs",
                    "references": ["Paris", "France"],
                    "contains": "all",
                }
            ],
            outputs="Paris is a great city",
        )
        _assert_match_result(resp, expected_success=False)

    def test_text_regex_anchored_success(self, services_api):
        """text/regex: anchored pattern matches start of output → success=True."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "regex",
                    "target": "$.outputs",
                    "reference": "^Paris",
                }
            ],
            outputs="Paris is the capital",
        )
        _assert_match_result(resp, expected_success=True)

    def test_text_regex_anchored_failure(self, services_api):
        """text/regex: anchored pattern does not match → success=False."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "regex",
                    "target": "$.outputs",
                    "reference": "^Paris",
                }
            ],
            outputs="The capital is Paris",
        )
        _assert_match_result(resp, expected_success=False)

    def test_text_regex_case_insensitive(self, services_api):
        """text/regex: case_sensitive=False matches regardless of case."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "regex",
                    "target": "$.outputs",
                    "reference": "^paris",
                    "case_sensitive": False,
                }
            ],
            outputs="PARIS is the capital",
        )
        _assert_match_result(resp, expected_success=True)

    def test_text_similarity_levenshtein_exact(self, services_api):
        """text/similarity levenshtein: identical strings → score=1.0, success=True."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "similarity",
                    "target": "$.outputs",
                    "reference": "Paris",
                    "similarity": "levenshtein",
                    "threshold": 0.8,
                }
            ],
            outputs="Paris",
        )
        result = _assert_match_result(resp, expected_success=True)
        assert result["m"].get("score") == pytest.approx(1.0)

    def test_text_similarity_levenshtein_one_edit(self, services_api):
        """text/similarity levenshtein: one edit apart → high score, success depends on threshold."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "similarity",
                    "target": "$.outputs",
                    "reference": "Paris",
                    "similarity": "levenshtein",
                    "threshold": 0.5,
                }
            ],
            outputs="Pariss",  # 1 insertion → distance=1, normalized ~0.83
        )
        result = _assert_match_result(resp, expected_success=True)
        assert result["m"].get("score", 0) > 0.5

    def test_text_similarity_jaccard_identical(self, services_api):
        """text/similarity jaccard (SequenceMatcher): identical strings → score=1.0."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "similarity",
                    "target": "$.outputs",
                    "reference": "Paris is the capital",
                    "similarity": "jaccard",
                    "threshold": 0.5,
                }
            ],
            outputs="Paris is the capital",
        )
        result = _assert_match_result(resp, expected_success=True)
        assert result["m"].get("score") == pytest.approx(1.0)

    def test_text_similarity_jaccard_different(self, services_api):
        """text/similarity jaccard: completely different strings → low score, success=False."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "similarity",
                    "target": "$.outputs",
                    "reference": "Paris",
                    "similarity": "jaccard",
                    "threshold": 0.9,
                }
            ],
            outputs="Berlin",
        )
        _assert_match_result(resp, expected_success=False)

    # ------------------------------------------------------------------ paths

    def test_path_jsonpath_nested_input_reference(self, services_api):
        """Path=$.outputs, reference=$.inputs.expected resolves from request inputs."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "exact",
                    "target": "$.outputs",
                    "reference": "$.inputs.expected",
                }
            ],
            inputs={"expected": "Paris"},
            outputs="Paris",
        )
        _assert_match_result(resp, expected_success=True)

    def test_path_json_pointer(self, services_api):
        """Path format: JSON Pointer (/outputs) resolves the output field."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "text",
                    "match": "regex",
                    "target": "/outputs",
                    "reference": "^Paris",
                }
            ],
            outputs="Paris is the capital",
        )
        _assert_match_result(resp, expected_success=True)

    # ------------------------------------------------------------------ json

    def test_json_valid_parseable_output(self, services_api):
        """json/valid: parseable JSON string output → success=True."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "json",
                    "match": "valid",
                    "target": "$.outputs",
                }
            ],
            outputs='{"city": "Paris"}',
        )
        _assert_match_result(resp, expected_success=True)

    def test_json_valid_unparseable_output(self, services_api):
        """json/valid: non-JSON string output → success=False."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "json",
                    "match": "valid",
                    "target": "$.outputs",
                }
            ],
            outputs="not json",
        )
        _assert_match_result(resp, expected_success=False)

    def test_json_exact_match(self, services_api):
        """json/exact: identical JSON objects → success=True."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "json",
                    "match": "exact",
                    "target": "$.outputs",
                    "reference": "$.inputs.correct",
                }
            ],
            inputs={"correct": '{"city": "Paris"}'},
            outputs='{"city": "Paris"}',
        )
        _assert_match_result(resp, expected_success=True)

    def test_json_exact_mismatch(self, services_api):
        """json/exact: different JSON values → success=False."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "json",
                    "match": "exact",
                    "target": "$.outputs",
                    "reference": "$.inputs.correct",
                }
            ],
            inputs={"correct": '{"city": "Paris"}'},
            outputs='{"city": "Berlin"}',
        )
        _assert_match_result(resp, expected_success=False)

    def test_json_overlap_identical(self, services_api):
        """json/overlap: identical JSON → score=1.0, success=True."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "json",
                    "match": "diff",
                    "target": "$.outputs",
                    "reference": "$.inputs.correct",
                    "threshold": 0.8,
                }
            ],
            inputs={"correct": '{"city": "Paris", "country": "France"}'},
            outputs='{"city": "Paris", "country": "France"}',
        )
        result = _assert_match_result(resp, expected_success=True)
        assert result["m"].get("score") == pytest.approx(1.0)

    def test_json_overlap_partial(self, services_api):
        """json/overlap: half fields match → score=0.5, fails at threshold=0.8."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "json",
                    "match": "diff",
                    "target": "$.outputs",
                    "reference": "$.inputs.correct",
                    "threshold": 0.8,
                }
            ],
            inputs={"correct": '{"city": "Paris", "country": "France"}'},
            outputs='{"city": "Paris", "country": "Germany"}',
        )
        result = _assert_match_result(resp, expected_success=False)
        score = result["m"].get("score", 1.0)
        assert score < 0.8

    def test_json_overlap_schema_only(self, services_api):
        """json/overlap use_schema_only=True: matching field types regardless of values → success=True."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m",
                    "mode": "json",
                    "match": "diff",
                    "target": "$.outputs",
                    "reference": "$.inputs.correct",
                    "diff": "schema",
                    "threshold": 0.9,
                }
            ],
            inputs={"correct": '{"city": "Paris", "population": 2161000}'},
            outputs='{"city": "Berlin", "population": 3677000}',
        )
        _assert_match_result(resp, expected_success=True)


@pytest.mark.acceptance
class TestMatchV0Aggregation:
    """Tests for match:v0 aggregation strategies: all, any, weighted."""

    def test_aggregate_all_both_pass(self, services_api):
        """aggregate=all: both children succeed → success=True, score=avg(1.0,1.0)=1.0."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "root",
                    "mode": "text",
                    "match": "valid",
                    "target": "$.outputs",
                    "success": "all",
                    "matchers": [
                        {
                            "key": "has_paris",
                            "mode": "text",
                            "match": "contains",
                            "target": "$.outputs",
                            "reference": "Paris",
                        },
                        {
                            "key": "has_france",
                            "mode": "text",
                            "match": "contains",
                            "target": "$.outputs",
                            "reference": "France",
                        },
                    ],
                }
            ],
            outputs="Paris is the capital of France",
        )
        result = _assert_match_result(resp, expected_success=True)
        assert result["root"].get("score") == pytest.approx(1.0)

    def test_aggregate_all_one_fails(self, services_api):
        """aggregate=all: one child fails → success=False (AND semantics)."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "root",
                    "mode": "text",
                    "match": "valid",
                    "target": "$.outputs",
                    "success": "all",
                    "matchers": [
                        {
                            "key": "has_paris",
                            "mode": "text",
                            "match": "contains",
                            "target": "$.outputs",
                            "reference": "Paris",
                        },
                        {
                            "key": "has_france",
                            "mode": "text",
                            "match": "contains",
                            "target": "$.outputs",
                            "reference": "France",
                        },
                    ],
                }
            ],
            outputs="Paris is a great city",
        )
        _assert_match_result(resp, expected_success=False)

    def test_aggregate_any_one_passes(self, services_api):
        """aggregate=any: one child succeeds → success=True (OR semantics)."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "root",
                    "mode": "text",
                    "match": "valid",
                    "target": "$.outputs",
                    "success": "any",
                    "matchers": [
                        {
                            "key": "has_paris",
                            "mode": "text",
                            "match": "contains",
                            "target": "$.outputs",
                            "reference": "Paris",
                        },
                        {
                            "key": "has_berlin",
                            "mode": "text",
                            "match": "contains",
                            "target": "$.outputs",
                            "reference": "Berlin",
                        },
                    ],
                }
            ],
            outputs="Paris is the capital",
        )
        _assert_match_result(resp, expected_success=True)

    def test_aggregate_any_none_pass(self, services_api):
        """aggregate=any: all children fail → success=False."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "root",
                    "mode": "text",
                    "match": "valid",
                    "target": "$.outputs",
                    "success": "any",
                    "matchers": [
                        {
                            "key": "has_paris",
                            "mode": "text",
                            "match": "contains",
                            "target": "$.outputs",
                            "reference": "Paris",
                        },
                        {
                            "key": "has_berlin",
                            "mode": "text",
                            "match": "contains",
                            "target": "$.outputs",
                            "reference": "Berlin",
                        },
                    ],
                }
            ],
            outputs="Madrid is the capital of Spain",
        )
        _assert_match_result(resp, expected_success=False)

    def test_aggregate_weighted_above_threshold(self, services_api):
        """aggregate=weighted: weighted score above threshold → success=True."""
        # m1 passes (weight=2, score=1.0), m2 fails (weight=1, score=0.0)
        # weighted_score = (1.0*2 + 0.0*1) / 3 = 0.67 > threshold=0.5
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "root",
                    "mode": "text",
                    "match": "valid",
                    "target": "$.outputs",
                    "score": "weighted",
                    "threshold": 0.5,
                    "matchers": [
                        {
                            "key": "has_paris",
                            "mode": "text",
                            "match": "contains",
                            "target": "$.outputs",
                            "reference": "Paris",
                            "weight": 2.0,
                        },
                        {
                            "key": "has_france",
                            "mode": "text",
                            "match": "contains",
                            "target": "$.outputs",
                            "reference": "France",
                            "weight": 1.0,
                        },
                    ],
                }
            ],
            outputs="Paris is a great city",
        )
        _assert_match_result(resp, expected_success=True)

    def test_aggregate_weighted_below_threshold(self, services_api):
        """aggregate=weighted: weighted score below threshold → success=False."""
        # both fail → score=0.0 < threshold=0.5
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "root",
                    "mode": "text",
                    "match": "valid",
                    "target": "$.outputs",
                    "score": "weighted",
                    "threshold": 0.5,
                    "matchers": [
                        {
                            "key": "has_paris",
                            "mode": "text",
                            "match": "contains",
                            "target": "$.outputs",
                            "reference": "Paris",
                            "weight": 1.0,
                        },
                        {
                            "key": "has_france",
                            "mode": "text",
                            "match": "contains",
                            "target": "$.outputs",
                            "reference": "France",
                            "weight": 1.0,
                        },
                    ],
                }
            ],
            outputs="Berlin is the capital of Germany",
        )
        _assert_match_result(resp, expected_success=False)

    def test_multiple_top_level_matchers(self, services_api):
        """Multiple top-level matchers produce one result per matcher."""
        resp = _match_direct(
            services_api,
            matchers=[
                {
                    "key": "m1",
                    "mode": "text",
                    "match": "contains",
                    "target": "$.outputs",
                    "reference": "Paris",
                },
                {
                    "key": "m2",
                    "mode": "text",
                    "match": "ends_with",
                    "target": "$.outputs",
                    "reference": "France",
                },
                {
                    "key": "m3",
                    "mode": "text",
                    "match": "starts_with",
                    "target": "$.outputs",
                    "reference": "Paris",
                },
            ],
            outputs="Paris is the capital of France",
        )
        result = _assert_match_result(resp, min_results=3)
        assert "m1" in result and "m2" in result and "m3" in result
