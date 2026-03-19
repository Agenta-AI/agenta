"""
Acceptance tests for the canonical workflow handler URIs.

Tests cover end-to-end happy paths for:
- agenta:custom:trace:v0  — interface-only, raises HookV0Error on invocation
- agenta:custom:hook:v0   — webhook forwarder (POST to a URL in RunningContext)
- agenta:custom:code:v0   — Python code evaluator
- agenta:builtin:match:v0 — rule-based matcher
- agenta:builtin:llm:v0   — unified LLM builtin surface

These tests do NOT require a running Agenta server — they exercise the handler
logic directly by bypassing @instrument() via __wrapped__.  They are acceptance
tests in the sense that they validate complete, realistic scenarios end-to-end
within the SDK layer.

No agenta_init fixture is needed: all handlers are pure-Python coroutines.
"""

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import pytest

from agenta.sdk.contexts.running import RunningContext, running_context_manager
from agenta.sdk.models.workflows import WorkflowRevisionData
from agenta.sdk.workflows.errors import HookV0Error
from agenta.sdk.workflows.handlers import (
    code_v0,
    hook_v0,
    llm_v0,
    match_v0,
    trace_v0,
)
from agenta.sdk.workflows.utils import retrieve_handler, retrieve_interface

pytestmark = [pytest.mark.acceptance]


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def run(coro):
    """Run an async coroutine synchronously in the current event loop."""
    return asyncio.get_event_loop().run_until_complete(coro)


def evaluate(body: str) -> str:
    """Wrap a one-liner body in a v2-compatible evaluate() function."""
    return f"def evaluate(inputs, output, trace):\n    {body}\n"


# ---------------------------------------------------------------------------
# TestTraceV0Acceptance
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestTraceV0Acceptance:
    """Happy-path acceptance tests for agenta:custom:trace:v0."""

    def test_registry_lookup_returns_callable(self):
        """retrieve_handler('agenta:custom:trace:v0') resolves to a callable."""
        handler = retrieve_handler("agenta:custom:trace:v0")
        assert handler is not None
        assert callable(handler)

    def test_interface_registry_lookup_returns_interface(self):
        """retrieve_interface('agenta:custom:trace:v0') resolves to revision data."""
        revision = retrieve_interface("agenta:custom:trace:v0")
        assert revision is not None

    def test_calling_trace_v0_raises_hook_error(self):
        """Direct invocation of trace_v0 raises HookV0Error (interface-only contract)."""
        _trace_v0 = trace_v0.__wrapped__
        with pytest.raises(HookV0Error):
            run(_trace_v0())

    def test_calling_trace_v0_with_inputs_raises_hook_error(self):
        """Even when called with realistic arguments, trace_v0 raises HookV0Error."""
        _trace_v0 = trace_v0.__wrapped__
        with pytest.raises(HookV0Error):
            run(_trace_v0(inputs={"question": "What is 2+2?"}, outputs="4"))

    def test_hook_error_message_references_uri(self):
        """The raised HookV0Error message identifies the agenta:custom:trace:v0 URI."""
        _trace_v0 = trace_v0.__wrapped__
        with pytest.raises(HookV0Error) as exc_info:
            run(_trace_v0())
        assert "agenta:custom:trace:v0" in exc_info.value.message


# ---------------------------------------------------------------------------
# TestHookV0Acceptance — real local HTTP server
# ---------------------------------------------------------------------------


def _start_webhook_server(response_body: dict, port: int = 0):
    """
    Start a local HTTP server on a random port that returns response_body as JSON.

    Returns (server, thread, actual_port).
    """
    body_bytes = json.dumps(response_body).encode()

    class _Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            # Drain the request body so the client does not hang.
            length = int(self.headers.get("Content-Length", 0))
            self.rfile.read(length)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body_bytes)))
            self.end_headers()
            self.wfile.write(body_bytes)

        def log_message(self, *args):  # suppress server output during tests
            pass

    server = HTTPServer(("127.0.0.1", port), _Handler)
    actual_port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, actual_port


@pytest.mark.acceptance
class TestHookV0Acceptance:
    """Happy-path acceptance tests for agenta:custom:hook:v0."""

    def test_registry_lookup_returns_callable(self):
        """retrieve_handler('agenta:custom:hook:v0') resolves to a callable."""
        handler = retrieve_handler("agenta:custom:hook:v0")
        assert handler is not None
        assert callable(handler)

    def test_hook_calls_local_server_and_returns_json(self):
        """
        hook_v0 POSTs to the URL in RunningContext.interface.url and returns the
        JSON body from the local webhook server.
        """
        expected = {"score": 1.0, "success": True}
        server, _thread, port = _start_webhook_server(expected)
        url = f"http://127.0.0.1:{port}/eval"

        try:
            _hook_v0 = hook_v0.__wrapped__
            revision = WorkflowRevisionData(uri="agenta:custom:hook:v0", url=url)
            ctx = RunningContext(revision=revision.model_dump(mode="json"))

            with running_context_manager(ctx):
                result = run(_hook_v0(inputs={"question": "Paris?"}, outputs="Paris"))
        finally:
            server.shutdown()

        assert result == expected

    def test_hook_forwards_inputs_to_webhook(self):
        """
        The payload sent to the webhook contains 'inputs' matching what was passed
        to hook_v0.  We capture it via a custom handler that echoes the payload.
        """
        received_payload = {}
        ready = threading.Event()
        body_bytes = json.dumps({"score": 0.9}).encode()

        class _CapturingHandler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length", 0))
                data = self.rfile.read(length)
                received_payload.update(json.loads(data))
                ready.set()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body_bytes)))
                self.end_headers()
                self.wfile.write(body_bytes)

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), _CapturingHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{port}/eval"

        try:
            _hook_v0 = hook_v0.__wrapped__
            revision = WorkflowRevisionData(uri="agenta:custom:hook:v0", url=url)
            ctx = RunningContext(revision=revision.model_dump(mode="json"))

            with running_context_manager(ctx):
                run(_hook_v0(inputs={"city": "Paris"}, outputs="correct"))

            ready.wait(timeout=2)
        finally:
            server.shutdown()

        assert received_payload.get("inputs") == {"city": "Paris"}

    def test_hook_with_testcase_forwarded(self):
        """
        The testcase field is included in the webhook payload when provided.
        """
        received_payload = {}
        body_bytes = json.dumps({"score": 1.0}).encode()

        class _CapturingHandler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length", 0))
                data = self.rfile.read(length)
                received_payload.update(json.loads(data))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body_bytes)))
                self.end_headers()
                self.wfile.write(body_bytes)

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), _CapturingHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{port}/eval"

        try:
            _hook_v0 = hook_v0.__wrapped__
            revision = WorkflowRevisionData(uri="agenta:custom:hook:v0", url=url)
            ctx = RunningContext(revision=revision.model_dump(mode="json"))

            with running_context_manager(ctx):
                run(
                    _hook_v0(
                        inputs={"q": "What is 2+2?"},
                        outputs="4",
                        testcase={"correct_answer": "4"},
                    )
                )
        finally:
            server.shutdown()

        assert "testcase" in received_payload
        assert received_payload["testcase"] == {"correct_answer": "4"}


# ---------------------------------------------------------------------------
# TestCodeV0Acceptance
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestCodeV0Acceptance:
    """Happy-path acceptance tests for agenta:custom:code:v0."""

    def test_registry_lookup_returns_callable(self):
        """retrieve_handler('agenta:custom:code:v0') resolves to a callable."""
        handler = retrieve_handler("agenta:custom:code:v0")
        assert handler is not None
        assert callable(handler)

    def test_simple_perfect_score_returns_success(self):
        """Python code that returns 1.0 produces score=1.0 and success=True."""
        _code_v0 = code_v0.__wrapped__
        result = run(
            _code_v0(
                parameters={"code": evaluate("return 1.0"), "runtime": "python"},
            )
        )
        assert result == {"score": 1.0, "success": True}

    def test_exact_match_logic_in_code(self):
        """Code that compares inputs['expected'] == output gives a realistic result."""
        _code_v0 = code_v0.__wrapped__
        code = evaluate("return 1.0 if inputs.get('expected') == output else 0.0")
        result = run(
            _code_v0(
                parameters={"code": code, "runtime": "python"},
                inputs={"expected": "Paris"},
                outputs="Paris",
            )
        )
        assert result["success"] is True
        assert result["score"] == pytest.approx(1.0)

    def test_exact_match_logic_fails_on_mismatch(self):
        """The same code returns success=False when output doesn't match expected."""
        _code_v0 = code_v0.__wrapped__
        code = evaluate("return 1.0 if inputs.get('expected') == output else 0.0")
        result = run(
            _code_v0(
                parameters={"code": code, "runtime": "python"},
                inputs={"expected": "Paris"},
                outputs="London",
            )
        )
        assert result["success"] is False
        assert result["score"] == pytest.approx(0.0)

    def test_custom_threshold_applied(self):
        """A custom threshold of 0.9 causes a 0.8 score to fail."""
        _code_v0 = code_v0.__wrapped__
        result = run(
            _code_v0(
                parameters={
                    "code": evaluate("return 0.8"),
                    "runtime": "python",
                    "threshold": 0.9,
                },
            )
        )
        assert result["score"] == pytest.approx(0.8)
        assert result["success"] is False

    def test_trace_data_accessible_in_code(self):
        """Trace dict is forwarded to evaluate() and accessible inside user code."""
        _code_v0 = code_v0.__wrapped__
        code = evaluate(
            "return 1.0 if (trace or {}).get('latency_ms', 0) < 500 else 0.0"
        )
        result = run(
            _code_v0(
                parameters={"code": code, "runtime": "python"},
                trace={"latency_ms": 120},
            )
        )
        assert result["success"] is True

    def test_result_dict_has_expected_keys(self):
        """Result always contains 'score' and 'success' keys."""
        _code_v0 = code_v0.__wrapped__
        result = run(
            _code_v0(
                parameters={"code": evaluate("return 0.7"), "runtime": "python"},
            )
        )
        assert "score" in result
        assert "success" in result


# ---------------------------------------------------------------------------
# TestMatchV0Acceptance
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestMatchV0Acceptance:
    """Happy-path acceptance tests for agenta:builtin:match:v0."""

    def test_registry_lookup_returns_callable(self):
        """retrieve_handler('agenta:builtin:match:v0') resolves to a callable."""
        handler = retrieve_handler("agenta:builtin:match:v0")
        assert handler is not None
        assert callable(handler)

    def test_exact_match_success(self):
        """
        An exact-match regex matcher (anchored, escaped) passes when output matches.
        """
        import re

        _match_v0 = match_v0.__wrapped__
        reference = "^" + re.escape("Paris") + "$"
        params = {
            "matchers": [
                {
                    "kind": "text",
                    "mode": "regex",
                    "path": "$.outputs",
                    "reference": reference,
                }
            ]
        }
        result = run(_match_v0(parameters=params, outputs="Paris"))
        assert "results" in result
        assert len(result["results"]) == 1
        assert result["results"][0]["success"] is True

    def test_exact_match_failure(self):
        """The same exact-match matcher returns success=False for a wrong output."""
        import re

        _match_v0 = match_v0.__wrapped__
        reference = "^" + re.escape("Paris") + "$"
        params = {
            "matchers": [
                {
                    "kind": "text",
                    "mode": "regex",
                    "path": "$.outputs",
                    "reference": reference,
                }
            ]
        }
        result = run(_match_v0(parameters=params, outputs="London"))
        assert result["results"][0]["success"] is False

    def test_contains_matcher(self):
        """A substring regex matcher passes when output contains the substring."""
        _match_v0 = match_v0.__wrapped__
        params = {
            "matchers": [
                {
                    "kind": "text",
                    "mode": "regex",
                    "path": "$.outputs",
                    "reference": "Paris",
                }
            ]
        }
        result = run(
            _match_v0(parameters=params, outputs="The answer is Paris, France.")
        )
        assert result["results"][0]["success"] is True

    def test_multiple_matchers_return_multiple_results(self):
        """Multiple matchers in the list produce one result entry each."""
        import re

        _match_v0 = match_v0.__wrapped__
        params = {
            "matchers": [
                {
                    "kind": "text",
                    "mode": "regex",
                    "path": "$.outputs",
                    "reference": "^" + re.escape("yes") + "$",
                },
                {
                    "kind": "text",
                    "mode": "regex",
                    "path": "$.outputs",
                    "reference": "yes",
                },
            ]
        }
        result = run(_match_v0(parameters=params, outputs="yes"))
        assert len(result["results"]) == 2
        assert result["results"][0]["success"] is True
        assert result["results"][1]["success"] is True

    def test_input_field_path_matcher(self):
        """A path of $.inputs.answer allows matching against a specific input field."""
        import re

        _match_v0 = match_v0.__wrapped__
        params = {
            "matchers": [
                {
                    "kind": "text",
                    "mode": "regex",
                    "path": "$.inputs.answer",
                    "reference": "^" + re.escape("42") + "$",
                }
            ]
        }
        result = run(_match_v0(parameters=params, inputs={"answer": "42"}))
        assert result["results"][0]["success"] is True


# ---------------------------------------------------------------------------
# TestPromptV0Acceptance
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestLlmV0Acceptance:
    """Registry coverage for the single unified agenta:builtin:llm:v0 surface."""

    def test_registry_lookup_returns_callable(self):
        handler = retrieve_handler("agenta:builtin:llm:v0")
        assert handler is not None
        assert callable(handler)
        assert handler == llm_v0

    def test_interface_registry_lookup_returns_interface(self):
        revision = retrieve_interface("agenta:builtin:llm:v0")
        assert isinstance(revision, WorkflowRevisionData)
        assert revision.uri == "agenta:builtin:llm:v0"

    def test_prompt_alias_is_not_registered(self):
        assert retrieve_handler("agenta:builtin:prompt:v0") is None
        assert retrieve_interface("agenta:builtin:prompt:v0") is None

    def test_agent_alias_is_not_registered(self):
        assert retrieve_handler("agenta:builtin:agent:v0") is None
        assert retrieve_interface("agenta:builtin:agent:v0") is None
