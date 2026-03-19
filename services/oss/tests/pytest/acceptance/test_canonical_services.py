"""
Acceptance tests for canonical workflow handlers exposed via the /services HTTP layer.

Covers:
- GET  /health
- POST /custom/code/v0/invoke   — Python code evaluator (happy path)
- POST /builtin/match/v0/invoke — regex matcher (happy path)
- POST /custom/trace/v0/invoke  — interface-only stub (expect error response)
- POST /custom/hook/v0/invoke   — webhook forwarder without URL (expect error response)

Requires a running services server reachable at AGENTA_SERVICES_URL
(or derived from AGENTA_API_URL).  Auth is supplied via AGENTA_AUTH_KEY.

Run with:
    pytest services/oss/tests/pytest/acceptance/ -v -m acceptance
"""

import re

import pytest

_SENTINEL = object()  # distinct from None for optional parameter detection

pytestmark = [pytest.mark.acceptance]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_EVALUATE_RETURN_ONE = "def evaluate(inputs, output, trace):\n    return 1.0\n"

_EVALUATE_EXACT_MATCH = (
    "def evaluate(inputs, output, trace):\n"
    "    return 1.0 if inputs.get('expected') == output else 0.0\n"
)


def _base_body(**overrides):
    """
    Minimal canonical-service request body.

    The /invoke endpoint accepts a WorkflowServiceRequest envelope; all
    handler-specific fields live under the ``data`` key.  Use empty dicts /
    strings as neutral stand-ins so the handler is actually invoked.  Override
    specific ``data`` sub-fields per test.
    """
    data = {
        "revision": {},
        "inputs": {},
        "parameters": {},
        "outputs": "",
        "trace": {},
        "testcase": {},
    }
    data.update(overrides)
    return {"data": data}


def _assert_base_response(payload: dict) -> None:
    """Assert a successful WorkflowServiceBatchResponse envelope."""
    assert "version" in payload, f"Missing 'version' in response: {payload}"
    assert "data" in payload, f"Missing 'data' in response: {payload}"


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
def test_health(unauthed_services_api):
    """GET /health returns {status: ok}."""
    resp = unauthed_services_api("GET", "/health")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# /custom/code/v0/invoke — Python code evaluator
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestCustomCodeV0:
    """HTTP acceptance tests for the custom/code/v0 canonical service."""

    def test_perfect_score_returns_success(self, services_api):
        """code_v0 with code returning 1.0 yields score=1.0 and success=True."""
        body = _base_body(
            parameters={
                "code": _EVALUATE_RETURN_ONE,
                "runtime": "python",
            }
        )
        resp = services_api("POST", "/custom/code/v0/invoke", json=body)
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        _assert_base_response(payload)
        result = payload["data"]["outputs"]
        assert isinstance(result, dict), f"Expected dict data, got: {result}"
        assert result.get("score") == pytest.approx(1.0)
        assert result.get("success") is True

    def test_exact_match_success(self, services_api):
        """Code comparing inputs['expected']==output passes when they match."""
        body = _base_body(
            parameters={
                "code": _EVALUATE_EXACT_MATCH,
                "runtime": "python",
            },
            inputs={"expected": "Paris"},
            outputs="Paris",
        )
        resp = services_api("POST", "/custom/code/v0/invoke", json=body)
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        _assert_base_response(payload)
        result = payload["data"]["outputs"]
        assert result.get("success") is True
        assert result.get("score") == pytest.approx(1.0)

    def test_exact_match_failure(self, services_api):
        """The same code returns success=False when output doesn't match."""
        body = _base_body(
            parameters={
                "code": _EVALUATE_EXACT_MATCH,
                "runtime": "python",
            },
            inputs={"expected": "Paris"},
            outputs="London",
        )
        resp = services_api("POST", "/custom/code/v0/invoke", json=body)
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        _assert_base_response(payload)
        result = payload["data"]["outputs"]
        assert result.get("success") is False
        assert result.get("score") == pytest.approx(0.0)

    def test_missing_parameters_returns_error(self, services_api):
        """code_v0 with parameters={} (missing 'code' key) returns a non-200 error."""
        body = (
            _base_body()
        )  # parameters={} — handler raises MissingConfigurationParameterV0Error
        resp = services_api("POST", "/custom/code/v0/invoke", json=body)
        assert resp.status_code != 200, (
            f"Expected error for missing parameters, got 200: {resp.text}"
        )

    def test_custom_threshold_applied(self, services_api):
        """A custom threshold of 0.9 causes a 0.8 score to result in success=False."""
        code = "def evaluate(inputs, output, trace):\n    return 0.8\n"
        body = _base_body(
            parameters={
                "code": code,
                "runtime": "python",
                "threshold": 0.9,
            }
        )
        resp = services_api("POST", "/custom/code/v0/invoke", json=body)
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        _assert_base_response(payload)
        result = payload["data"]["outputs"]
        assert result.get("score") == pytest.approx(0.8)
        assert result.get("success") is False

    def test_response_includes_base_response_version(self, services_api):
        """Every successful response carries a version string."""
        body = _base_body(
            parameters={
                "code": _EVALUATE_RETURN_ONE,
                "runtime": "python",
            }
        )
        resp = services_api("POST", "/custom/code/v0/invoke", json=body)
        assert resp.status_code == 200, resp.text
        assert "version" in resp.json()


# ---------------------------------------------------------------------------
# /builtin/match/v0/invoke — rule-based matcher
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestBuiltinMatchV0:
    """HTTP acceptance tests for the builtin/match/v0 canonical service."""

    def _regex_body(self, reference: str, outputs=_SENTINEL, inputs=_SENTINEL):
        path = "$.outputs" if outputs is not _SENTINEL else "$.inputs.answer"
        matchers = [
            {
                "kind": "text",
                "mode": "regex",
                "path": path,
                "reference": reference,
            }
        ]
        overrides = {"parameters": {"matchers": matchers}}
        if outputs is not _SENTINEL:
            overrides["outputs"] = outputs
        if inputs is not _SENTINEL:
            overrides["inputs"] = inputs
        return _base_body(**overrides)

    def test_exact_match_success(self, services_api):
        """An anchored regex matcher passes when output equals the reference."""
        reference = "^" + re.escape("Paris") + "$"
        body = self._regex_body(reference=reference, outputs="Paris")
        resp = services_api("POST", "/builtin/match/v0/invoke", json=body)
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        _assert_base_response(payload)
        result = payload["data"]["outputs"]
        assert "results" in result, f"Missing 'results' key: {result}"
        assert len(result["results"]) == 1
        assert result["results"][0]["success"] is True

    def test_exact_match_failure(self, services_api):
        """The same regex matcher returns success=False for a different output."""
        reference = "^" + re.escape("Paris") + "$"
        body = self._regex_body(reference=reference, outputs="London")
        resp = services_api("POST", "/builtin/match/v0/invoke", json=body)
        assert resp.status_code == 200, resp.text
        result = resp.json()["data"]["outputs"]
        assert result["results"][0]["success"] is False

    def test_substring_match_success(self, services_api):
        """A plain substring regex passes when output contains the substring."""
        body = self._regex_body(reference="Paris", outputs="The capital is Paris.")
        resp = services_api("POST", "/builtin/match/v0/invoke", json=body)
        assert resp.status_code == 200, resp.text
        result = resp.json()["data"]["outputs"]
        assert result["results"][0]["success"] is True

    def test_multiple_matchers(self, services_api):
        """Multiple matchers produce one result per matcher."""
        matchers = [
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
        body = _base_body(
            parameters={"matchers": matchers},
            outputs="yes",
        )
        resp = services_api("POST", "/builtin/match/v0/invoke", json=body)
        assert resp.status_code == 200, resp.text
        result = resp.json()["data"]["outputs"]
        assert len(result["results"]) == 2
        assert result["results"][0]["success"] is True
        assert result["results"][1]["success"] is True

    def test_missing_parameters_returns_error(self, services_api):
        """match_v0 with parameters={} (missing 'matchers' key) returns a non-200 error."""
        body = (
            _base_body()
        )  # parameters={} — handler raises MissingConfigurationParameterV0Error
        resp = services_api("POST", "/builtin/match/v0/invoke", json=body)
        assert resp.status_code != 200, (
            f"Expected error for missing parameters, got 200: {resp.text}"
        )


# ---------------------------------------------------------------------------
# /custom/trace/v0/invoke — interface-only stub (always errors)
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestCustomTraceV0:
    """
    trace_v0 is an interface-only handler — it always raises HookV0Error.
    The service layer converts this to an HTTP error response.
    """

    def test_invocation_returns_error(self, services_api):
        """POST /custom/trace/v0/invoke always returns a non-200 response."""
        body = _base_body(inputs={"question": "What is 2+2?"}, outputs="4")
        resp = services_api("POST", "/custom/trace/v0/invoke", json=body)
        assert resp.status_code != 200, (
            f"Expected error response from trace_v0, got {resp.status_code}: {resp.text}"
        )

    def test_error_detail_references_uri(self, services_api):
        """The error detail mentions the agenta:custom:trace:v0 URI."""
        body = _base_body()
        resp = services_api("POST", "/custom/trace/v0/invoke", json=body)
        assert resp.status_code != 200
        text = resp.text
        assert "agenta:custom:trace:v0" in text, (
            f"Expected URI in error detail, got: {text}"
        )


# ---------------------------------------------------------------------------
# /custom/hook/v0/invoke — webhook forwarder (no URL configured → error)
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestCustomHookV0:
    """
    hook_v0 forwards to a URL stored in RunningContext.interface.url.
    When called via /invoke without a revision that provides a URL, it errors.
    """

    def test_invocation_without_url_returns_error(self, services_api):
        """POST /custom/hook/v0/invoke without a webhook URL returns a non-200 response."""
        body = _base_body(inputs={"question": "What is 2+2?"}, outputs="4")
        resp = services_api("POST", "/custom/hook/v0/invoke", json=body)
        assert resp.status_code != 200, (
            f"Expected error from hook_v0 (no URL), got {resp.status_code}: {resp.text}"
        )
