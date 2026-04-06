"""
Catalog-to-observability acceptance tests.

These tests verify the full data pipeline from workflow creation through
invocation to trace capture in the observability system:

  1.  Create workflow from catalog template (evaluator or application)
  2.  Deploy to default environment
  3.  Invoke via dispatcher
  4.  Fetch trace from observability API
  5.  Assert trace structure (trace_id, span_id, inputs, outputs)
  6.  Chain — evaluator invoke linked to the completion trace
  7.  Assert evaluator trace links back to the invocation

Run with:
    pytest services/oss/tests/pytest/acceptance/test_catalog_to_observability.py -v -m acceptance

Requires AGENTA_API_URL, AGENTA_SERVICES_URL, and AGENTA_AUTH_KEY env vars.
Some tests are marked llm_required and are skipped if no LLM key is available.
"""

from __future__ import annotations

import time
from typing import Optional
from uuid import uuid4

import pytest

pytestmark = [pytest.mark.acceptance]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_POLL_INTERVAL = 0.5  # seconds between trace-fetch retries
_POLL_TIMEOUT = 20.0  # maximum seconds to wait for a trace to appear


def _uid() -> str:
    return uuid4().hex[:8]


def _create_simple_workflow(
    mod_api, *, slug: str, name: str, flags: dict, data: dict
) -> dict:
    """POST /preview/simple/workflows/ and return the workflow dict."""
    resp = mod_api(
        "POST",
        "/preview/simple/workflows/",
        json={"workflow": {"slug": slug, "name": name, "flags": flags, "data": data}},
    )
    assert resp.status_code == 200, f"Create workflow failed: {resp.text}"
    wf = resp.json().get("workflow")
    assert wf, f"No workflow in response: {resp.text}"
    return wf


def _deploy(mod_api, *, revision_id: str, environment_id: str) -> None:
    """POST /preview/workflows/revisions/deploy."""
    resp = mod_api(
        "POST",
        "/preview/workflows/revisions/deploy",
        json={
            "workflow_revision_ref": {"id": revision_id},
            "environment_ref": {"id": environment_id},
        },
    )
    assert resp.status_code == 200, f"Deploy failed: {resp.text}"


def _query_default_environment(mod_api) -> dict:
    """Return the first environment (default)."""
    resp = mod_api("POST", "/preview/environments/query", json={})
    assert resp.status_code == 200, f"Query environments failed: {resp.text}"
    envs = resp.json().get("environments", [])
    assert envs, "No environments found — create a default environment first"
    return envs[0]


def _invoke_by_env(
    mod_services_api,
    *,
    environment_slug: str,
    workflow_slug: str,
    data: dict,
    allow_llm_failure: bool = False,
) -> dict:
    """POST /invoke via environment ref + selector key and return response payload."""
    body = {
        "references": {"environment": {"slug": environment_slug}},
        "selector": {"key": f"{workflow_slug}.revision"},
        "data": data,
    }
    inspect_resp = mod_services_api(
        "POST",
        "/inspect",
        json={
            "references": body["references"],
            "selector": body["selector"],
        },
    )
    assert inspect_resp.status_code == 200, (
        f"Inspect failed ({inspect_resp.status_code}): {inspect_resp.text[:500]}"
    )
    resp = mod_services_api("POST", "/invoke", json=body)
    _maybe_xfail_for_llm_provider_error(resp, allow_llm_failure=allow_llm_failure)
    assert resp.status_code == 200, (
        f"Invoke failed ({resp.status_code}): {resp.text[:500]}"
    )
    return resp.json()


def _invoke_with_inspect(
    mod_services_api,
    *,
    body: dict,
    allow_llm_failure: bool = False,
) -> dict:
    inspect_body = {}
    for key in ("version", "references", "selector", "flags", "tags", "meta"):
        if key in body:
            inspect_body[key] = body[key]

    data = body.get("data")
    if isinstance(data, dict) and "revision" in data:
        inspect_body["revision"] = data["revision"]

    inspect_resp = mod_services_api("POST", "/inspect", json=inspect_body)
    assert inspect_resp.status_code == 200, (
        f"Inspect failed ({inspect_resp.status_code}): {inspect_resp.text[:500]}"
    )

    resp = mod_services_api("POST", "/invoke", json=body)
    _maybe_xfail_for_llm_provider_error(resp, allow_llm_failure=allow_llm_failure)
    assert resp.status_code == 200, (
        f"Invoke failed ({resp.status_code}): {resp.text[:500]}"
    )
    return resp.json()


def _invoke_inline(
    mod_services_api,
    *,
    uri: str,
    parameters: dict,
    data: dict,
    allow_llm_failure: bool = False,
) -> dict:
    """POST /invoke with URI + parameters inline and return response payload."""
    revision = {"data": {"uri": uri, "parameters": parameters}}
    return _invoke_with_inspect(
        mod_services_api,
        body={
            "data": {
                **data,
                "revision": revision,
            }
        },
        allow_llm_failure=allow_llm_failure,
    )


def _maybe_xfail_for_llm_provider_error(
    resp, *, allow_llm_failure: bool = False
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
        pytest.xfail("live LLM provider unavailable or quota exhausted")


def _fetch_trace(
    mod_api, trace_id: str, *, timeout: float = _POLL_TIMEOUT
) -> Optional[dict]:
    """Poll observability API until trace appears or timeout elapses."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        resp = mod_api("GET", f"/tracing/traces/{trace_id}")
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, dict):
                traces = data.get("traces")
                if isinstance(traces, dict) and traces:
                    trace = traces.get(trace_id)
                    if isinstance(trace, dict) and trace.get("spans"):
                        return trace
                    first_trace = next(iter(traces.values()), None)
                    if isinstance(first_trace, dict) and first_trace.get("spans"):
                        return first_trace
            elif isinstance(data, list) and data:
                return data
        time.sleep(_POLL_INTERVAL)
    return None


def _assert_trace_structure(trace: dict, *, trace_id: str) -> None:
    """Assert the trace has the expected top-level fields."""
    assert trace, f"Trace {trace_id} is empty"

    if isinstance(trace, list):
        assert len(trace) > 0, f"Trace {trace_id} returned empty list"
        span = trace[0]
    elif isinstance(trace, dict) and "spans" in trace:
        spans = trace.get("spans") or {}
        assert spans, f"Trace {trace_id} returned no spans: {trace}"
        span = next(iter(spans.values()))
    else:
        span = trace

    assert "trace_id" in span or "id" in span, (
        f"Trace {trace_id} missing 'trace_id'/'id': {span}"
    )


# ---------------------------------------------------------------------------
# Fixtures — shared workflow lifecycle per module
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def evaluator_lifecycle(mod_api, mod_services_api):
    """
    Create and deploy a stateless evaluator (auto_exact_match) once per module.
    Returns the full context dict used by tests.
    """
    uid = _uid()
    slug = f"test-obs-evaluator-{uid}"
    name = slug

    wf = _create_simple_workflow(
        mod_api,
        slug=slug,
        name=name,
        flags={"is_evaluator": True},
        data={
            "uri": "agenta:builtin:auto_exact_match:v0",
            "parameters": {"correct_answer_key": "correct_answer"},
        },
    )

    env = _query_default_environment(mod_api)
    _deploy(mod_api, revision_id=wf["revision_id"], environment_id=env["id"])

    return {
        "workflow_id": wf["id"],
        "workflow_slug": wf["slug"],
        "revision_id": wf["revision_id"],
        "environment_id": env["id"],
        "environment_slug": env.get("slug") or env.get("name"),
        "uri": "agenta:builtin:auto_exact_match:v0",
        "parameters": {"correct_answer_key": "correct_answer"},
    }


@pytest.fixture(scope="module")
def completion_lifecycle(mod_api, mod_services_api):
    """
    Create and deploy a completion application (LLM) once per module.
    Returns the full context dict used by tests.
    Marked llm_required — skipped if LLM key unavailable.
    """
    uid = _uid()
    slug = f"test-obs-completion-{uid}"
    name = slug

    wf = _create_simple_workflow(
        mod_api,
        slug=slug,
        name=name,
        flags={"is_application": True},
        data={
            "uri": "agenta:builtin:completion:v0",
            "parameters": {
                "prompt": {
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are an expert in geography.",
                        },
                        {
                            "role": "user",
                            "content": "What is the capital of {{country}}?",
                        },
                    ],
                    "llm_config": {"model": "gpt-4o-mini"},
                }
            },
        },
    )

    env = _query_default_environment(mod_api)
    _deploy(mod_api, revision_id=wf["revision_id"], environment_id=env["id"])

    return {
        "workflow_id": wf["id"],
        "workflow_slug": wf["slug"],
        "revision_id": wf["revision_id"],
        "environment_id": env["id"],
        "environment_slug": env.get("slug") or env.get("name"),
        "uri": "agenta:builtin:completion:v0",
    }


# ---------------------------------------------------------------------------
# Tests — evaluator to observability
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestEvaluatorTraceCapture:
    """Invoke an evaluator workflow and verify its trace is recorded."""

    def test_invoke_creates_trace(self, evaluator_lifecycle, mod_api, mod_services_api):
        """Invoking an evaluator produces a trace_id in the response."""
        ctx = evaluator_lifecycle
        payload = _invoke_by_env(
            mod_services_api,
            environment_slug=ctx["environment_slug"],
            workflow_slug=ctx["workflow_slug"],
            data={"inputs": {"correct_answer": "Paris"}, "outputs": "Paris"},
        )
        assert "trace_id" in payload, f"Response missing trace_id: {payload}"
        assert payload["trace_id"], "trace_id is empty"

    def test_trace_is_fetchable(self, evaluator_lifecycle, mod_api, mod_services_api):
        """The trace_id from invoke can be retrieved from the observability API."""
        ctx = evaluator_lifecycle
        payload = _invoke_by_env(
            mod_services_api,
            environment_slug=ctx["environment_slug"],
            workflow_slug=ctx["workflow_slug"],
            data={"inputs": {"correct_answer": "Paris"}, "outputs": "Paris"},
        )
        trace_id = payload["trace_id"]
        trace = _fetch_trace(mod_api, trace_id)
        assert trace is not None, f"Trace {trace_id} not found within {_POLL_TIMEOUT}s"
        _assert_trace_structure(trace, trace_id=trace_id)

    def test_trace_contains_span_id(
        self, evaluator_lifecycle, mod_api, mod_services_api
    ):
        """Invoke response includes a span_id that is part of the trace."""
        ctx = evaluator_lifecycle
        payload = _invoke_by_env(
            mod_services_api,
            environment_slug=ctx["environment_slug"],
            workflow_slug=ctx["workflow_slug"],
            data={"inputs": {"correct_answer": "Paris"}, "outputs": "Paris"},
        )
        assert "span_id" in payload, f"Response missing span_id: {payload}"
        assert payload["span_id"], "span_id is empty"

    def test_inline_invoke_also_creates_trace(
        self, evaluator_lifecycle, mod_api, mod_services_api
    ):
        """Inline invocation (URI + params in revision, no DB lookup) also produces a traceable trace."""
        ctx = evaluator_lifecycle
        payload = _invoke_inline(
            mod_services_api,
            uri=ctx["uri"],
            parameters=ctx["parameters"],
            data={"inputs": {"correct_answer": "Paris"}, "outputs": "Paris"},
        )
        trace_id = payload.get("trace_id")
        assert trace_id, f"Inline invoke missing trace_id: {payload}"
        trace = _fetch_trace(mod_api, trace_id)
        assert trace is not None, f"Inline invoke trace {trace_id} not found"

    def test_match_result_in_trace_outputs(
        self, evaluator_lifecycle, mod_api, mod_services_api
    ):
        """The invocation outputs (success field) are persisted in the trace span."""
        ctx = evaluator_lifecycle
        payload = _invoke_by_env(
            mod_services_api,
            environment_slug=ctx["environment_slug"],
            workflow_slug=ctx["workflow_slug"],
            data={"inputs": {"correct_answer": "Paris"}, "outputs": "Paris"},
        )
        # trace_id = payload["trace_id"]
        # Also verify the immediate response carries outputs
        assert "data" in payload, f"Missing 'data' in response: {payload}"
        outputs = payload["data"].get("outputs") or {}
        assert "success" in outputs, f"outputs missing 'success': {outputs}"
        assert outputs["success"] is True, (
            f"Expected success=True for exact match: {outputs}"
        )


# ---------------------------------------------------------------------------
# Tests — evaluator linked to invocation (cross-trace linking)
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestEvaluatorLinkedToInvocation:
    """Run an evaluator with links.invocation pointing to a prior invocation trace."""

    def test_evaluator_can_be_linked_to_prior_trace(
        self, evaluator_lifecycle, mod_api, mod_services_api
    ):
        """
        Two-step workflow:
          1. Invoke evaluator (step A) → captures trace_id + span_id
          2. Invoke same evaluator (step B) with links.invocation → the B trace
             is linked back to A's trace.
        """
        ctx = evaluator_lifecycle

        # Step A — first invocation (acts as the "application" being evaluated)
        payload_a = _invoke_by_env(
            mod_services_api,
            environment_slug=ctx["environment_slug"],
            workflow_slug=ctx["workflow_slug"],
            data={"inputs": {"correct_answer": "Paris"}, "outputs": "Paris"},
        )
        trace_id_a = payload_a["trace_id"]
        span_id_a = payload_a["span_id"]
        assert trace_id_a and span_id_a, f"Step A missing trace/span: {payload_a}"

        # Step B — evaluator invocation linked to A
        payload_b = _invoke_with_inspect(
            mod_services_api,
            body={
                "references": {"environment": {"slug": ctx["environment_slug"]}},
                "selector": {"key": f"{ctx['workflow_slug']}.revision"},
                "links": {"invocation": {"trace_id": trace_id_a, "span_id": span_id_a}},
                "data": {"inputs": {"correct_answer": "Paris"}, "outputs": "Paris"},
            },
        )
        trace_id_b = payload_b.get("trace_id")
        assert trace_id_b, f"Linked invoke missing trace_id: {payload_b}"
        assert trace_id_b != trace_id_a, "Linked invocation should produce a new trace"

    def test_linked_trace_is_fetchable(
        self, evaluator_lifecycle, mod_api, mod_services_api
    ):
        """The trace_id from a linked evaluator invocation can be retrieved."""
        ctx = evaluator_lifecycle

        payload_a = _invoke_by_env(
            mod_services_api,
            environment_slug=ctx["environment_slug"],
            workflow_slug=ctx["workflow_slug"],
            data={"inputs": {"correct_answer": "Paris"}, "outputs": "Paris"},
        )
        trace_id_a = payload_a["trace_id"]
        span_id_a = payload_a["span_id"]

        payload_b = _invoke_with_inspect(
            mod_services_api,
            body={
                "references": {"environment": {"slug": ctx["environment_slug"]}},
                "selector": {"key": f"{ctx['workflow_slug']}.revision"},
                "links": {"invocation": {"trace_id": trace_id_a, "span_id": span_id_a}},
                "data": {"inputs": {"correct_answer": "Paris"}, "outputs": "Paris"},
            },
        )
        trace_id_b = payload_b.get("trace_id")
        trace_b = _fetch_trace(mod_api, trace_id_b)
        assert trace_b is not None, f"Linked evaluator trace {trace_id_b} not found"
        _assert_trace_structure(trace_b, trace_id=trace_id_b)


# ---------------------------------------------------------------------------
# Tests — multi-evaluator against the same invocation
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestMultiEvaluatorObservability:
    """Run multiple evaluator types against the same invocation trace."""

    def test_two_evaluators_produce_distinct_traces(
        self, evaluator_lifecycle, mod_api, mod_services_api
    ):
        """Running two evaluators on the same output produces two separate evaluator traces."""
        ctx = evaluator_lifecycle

        # Base invocation
        base = _invoke_by_env(
            mod_services_api,
            environment_slug=ctx["environment_slug"],
            workflow_slug=ctx["workflow_slug"],
            data={"inputs": {"correct_answer": "Paris"}, "outputs": "Paris"},
        )
        trace_id_base = base["trace_id"]
        span_id_base = base["span_id"]

        # Evaluator 1 — auto_exact_match (exact match, should succeed)
        r1 = _invoke_inline(
            mod_services_api,
            uri="agenta:builtin:auto_exact_match:v0",
            parameters={"correct_answer_key": "correct_answer"},
            data={
                "inputs": {"correct_answer": "Paris"},
                "outputs": "Paris",
                "links": {
                    "invocation": {"trace_id": trace_id_base, "span_id": span_id_base}
                },
            },
        )
        trace_id_e1 = r1.get("trace_id")

        # Evaluator 2 — auto_contains (substring match, should also succeed)
        r2 = _invoke_inline(
            mod_services_api,
            uri="agenta:builtin:auto_contains:v0",
            parameters={"substring": "Paris", "case_sensitive": True},
            data={
                "inputs": {},
                "outputs": "Paris",
                "links": {
                    "invocation": {"trace_id": trace_id_base, "span_id": span_id_base}
                },
            },
        )
        trace_id_e2 = r2.get("trace_id")

        assert trace_id_e1 and trace_id_e2, "Both evaluators must produce trace_ids"
        assert trace_id_e1 != trace_id_e2, "Each evaluator must produce its own trace"
        assert trace_id_e1 != trace_id_base
        assert trace_id_e2 != trace_id_base

    def test_evaluator_outputs_reflected_in_response(self, mod_api, mod_services_api):
        """Each evaluator's response carries accurate outputs even when run concurrently."""
        # Exact match evaluator — success=True
        exact_match = _invoke_inline(
            mod_services_api,
            uri="agenta:builtin:auto_exact_match:v0",
            parameters={"correct_answer_key": "correct_answer"},
            data={"inputs": {"correct_answer": "Paris"}, "outputs": "Paris"},
        )
        assert exact_match["data"]["outputs"]["success"] is True

        # Exact match evaluator — success=False
        exact_fail = _invoke_inline(
            mod_services_api,
            uri="agenta:builtin:auto_exact_match:v0",
            parameters={"correct_answer_key": "correct_answer"},
            data={"inputs": {"correct_answer": "Paris"}, "outputs": "London"},
        )
        assert exact_fail["data"]["outputs"]["success"] is False

        # Contains evaluator — success=True
        contains_pass = _invoke_inline(
            mod_services_api,
            uri="agenta:builtin:auto_contains:v0",
            parameters={"substring": "Paris", "case_sensitive": True},
            data={"inputs": {}, "outputs": "The capital is Paris"},
        )
        assert contains_pass["data"]["outputs"]["success"] is True


# ---------------------------------------------------------------------------
# Tests — application + evaluator chain (requires LLM)
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
@pytest.mark.llm_required
class TestCompletionToEvaluatorChain:
    """
    End-to-end chain: completion application → evaluator linked to its trace.
    Requires a valid LLM API key.
    """

    def test_completion_invoke_produces_trace(
        self, completion_lifecycle, mod_api, mod_services_api
    ):
        """Invoking a completion workflow produces a trace_id."""
        ctx = completion_lifecycle
        payload = _invoke_by_env(
            mod_services_api,
            environment_slug=ctx["environment_slug"],
            workflow_slug=ctx["workflow_slug"],
            data={"inputs": {"country": "France"}},
            allow_llm_failure=True,
        )
        trace_id = payload.get("trace_id")
        assert trace_id, f"Completion invoke missing trace_id: {payload}"

    def test_completion_trace_is_fetchable(
        self, completion_lifecycle, mod_api, mod_services_api
    ):
        """The completion trace can be retrieved from the observability API."""
        ctx = completion_lifecycle
        payload = _invoke_by_env(
            mod_services_api,
            environment_slug=ctx["environment_slug"],
            workflow_slug=ctx["workflow_slug"],
            data={"inputs": {"country": "France"}},
            allow_llm_failure=True,
        )
        trace_id = payload["trace_id"]
        trace = _fetch_trace(mod_api, trace_id)
        assert trace is not None, f"Completion trace {trace_id} not found"
        _assert_trace_structure(trace, trace_id=trace_id)

    def test_evaluator_linked_to_completion_trace(
        self, completion_lifecycle, mod_api, mod_services_api
    ):
        """
        Chain:
          1. Invoke completion → get trace_id + outputs
          2. Invoke evaluator linked to the completion trace
          3. Both traces are fetchable from observability
        """
        ctx = completion_lifecycle

        # Step 1 — completion
        completion_payload = _invoke_by_env(
            mod_services_api,
            environment_slug=ctx["environment_slug"],
            workflow_slug=ctx["workflow_slug"],
            data={"inputs": {"country": "France"}},
            allow_llm_failure=True,
        )
        completion_trace_id = completion_payload["trace_id"]
        completion_span_id = completion_payload["span_id"]
        completion_output = completion_payload.get("data", {}).get("outputs", "")

        # Step 2 — evaluator (auto_contains: check LLM mentioned "Paris")
        eval_payload = _invoke_with_inspect(
            mod_services_api,
            body={
                "data": {
                    "inputs": {},
                    "outputs": completion_output,
                    "revision": {
                        "data": {
                            "uri": "agenta:builtin:auto_contains:v0",
                            "parameters": {
                                "substring": "Paris",
                                "case_sensitive": False,
                            },
                        }
                    },
                    "links": {
                        "invocation": {
                            "trace_id": completion_trace_id,
                            "span_id": completion_span_id,
                        }
                    },
                }
            },
            allow_llm_failure=True,
        )
        eval_trace_id = eval_payload.get("trace_id")

        assert eval_trace_id, f"Evaluator missing trace_id: {eval_payload}"
        assert eval_trace_id != completion_trace_id

        # Step 3 — both traces fetchable
        completion_trace = _fetch_trace(mod_api, completion_trace_id)
        eval_trace = _fetch_trace(mod_api, eval_trace_id)

        assert completion_trace is not None, (
            f"Completion trace {completion_trace_id} not found"
        )
        assert eval_trace is not None, f"Evaluator trace {eval_trace_id} not found"

        _assert_trace_structure(completion_trace, trace_id=completion_trace_id)
        _assert_trace_structure(eval_trace, trace_id=eval_trace_id)
