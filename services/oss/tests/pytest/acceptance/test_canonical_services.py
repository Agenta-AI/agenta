"""
Acceptance tests for canonical workflow handlers exposed via the /services HTTP layer.

Covers:
- GET  /health
- POST /code/v0/invoke   — Python code evaluator (happy path)
- POST /match/v0/invoke  — regex matcher (happy path)
- POST /trace/v0/invoke  — interface-only stub (expect error response)
- POST /hook/v0/invoke   — webhook forwarder without URL (expect error response)

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


def _inspect_body(body: dict) -> dict:
    inspect: dict = {}

    for key in ("version", "references", "selector", "flags", "tags", "meta"):
        if key in body:
            inspect[key] = body[key]

    data = body.get("data")
    if isinstance(data, dict) and "revision" in data:
        inspect["revision"] = data["revision"]

    return inspect


def _direct_invoke_inspect(path: str, body: dict) -> dict | None:
    uri_by_prefix = {
        "/code/v0/invoke": "agenta:custom:code:v0",
        "/hook/v0/invoke": "agenta:custom:hook:v0",
        "/match/v0/invoke": "agenta:builtin:match:v0",
    }
    uri = uri_by_prefix.get(path)
    if uri is None:
        return None

    parameters = {}
    data = body.get("data")
    if isinstance(data, dict) and isinstance(data.get("parameters"), dict):
        parameters = data["parameters"]

    return {"revision": {"data": {"uri": uri, "parameters": parameters}}}


def _invoke_with_inspect(services_api, path: str, *, body: dict):
    inspect_body = _direct_invoke_inspect(path, body) or _inspect_body(body)
    inspect_path = "/inspect" if path != "/invoke" else "/inspect"
    inspect_resp = services_api(
        "POST",
        inspect_path,
        json=inspect_body,
    )
    assert inspect_resp.status_code == 200, (
        f"Inspect failed for {path}: {inspect_resp.text[:500]}"
    )
    return services_api("POST", path, json=body)


def _assert_direct_inspect_uri(services_api, path: str, *, expected_uri: str) -> None:
    resp = services_api("POST", path, json={})
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["data"]["revision"]["data"]["uri"] == expected_uri


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
def test_health(unauthed_services_api):
    """GET /health returns {status: ok}."""
    resp = unauthed_services_api("GET", "/health")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"status": "ok"}


@pytest.mark.acceptance
def test_match_direct_inspect_returns_canonical_uri(services_api):
    _assert_direct_inspect_uri(
        services_api,
        "/match/v0/inspect",
        expected_uri="agenta:builtin:match:v0",
    )


# ---------------------------------------------------------------------------
# /code/v0/invoke — Python code evaluator
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestCustomCodeV0:
    """HTTP acceptance tests for the /code/v0 canonical service."""

    def test_perfect_score_returns_success(self, services_api):
        """code_v0 with code returning 1.0 yields score=1.0 and success=True."""
        body = _base_body(
            parameters={
                "code": _EVALUATE_RETURN_ONE,
                "runtime": "python",
            }
        )
        resp = _invoke_with_inspect(
            services_api,
            "/code/v0/invoke",
            body=body,
        )
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
        resp = _invoke_with_inspect(
            services_api,
            "/code/v0/invoke",
            body=body,
        )
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
        resp = _invoke_with_inspect(
            services_api,
            "/code/v0/invoke",
            body=body,
        )
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
        resp = _invoke_with_inspect(
            services_api,
            "/code/v0/invoke",
            body=body,
        )
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
        resp = _invoke_with_inspect(
            services_api,
            "/code/v0/invoke",
            body=body,
        )
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
        resp = _invoke_with_inspect(
            services_api,
            "/code/v0/invoke",
            body=body,
        )
        assert resp.status_code == 200, resp.text
        assert "version" in resp.json()


# ---------------------------------------------------------------------------
# /match/v0/invoke — rule-based matcher
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestBuiltinMatchV0:
    """HTTP acceptance tests for the /match/v0 canonical service."""

    def _regex_body(self, reference: str, outputs=_SENTINEL, inputs=_SENTINEL):
        target = "$.outputs" if outputs is not _SENTINEL else "$.inputs.answer"
        matchers = [
            {
                "key": "m0",
                "mode": "text",
                "match": "regex",
                "target": target,
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
        resp = _invoke_with_inspect(
            services_api,
            "/match/v0/invoke",
            body=body,
        )
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        _assert_base_response(payload)
        result = payload["data"]["outputs"]
        assert "m0" in result, f"Missing 'm0' key: {result}"
        assert result["m0"]["success"] is True
        assert result["success"] is True

    def test_exact_match_failure(self, services_api):
        """The same regex matcher returns success=False for a different output."""
        reference = "^" + re.escape("Paris") + "$"
        body = self._regex_body(reference=reference, outputs="London")
        resp = _invoke_with_inspect(
            services_api,
            "/match/v0/invoke",
            body=body,
        )
        assert resp.status_code == 200, resp.text
        result = resp.json()["data"]["outputs"]
        assert result["m0"]["success"] is False
        assert result["success"] is False

    def test_substring_match_success(self, services_api):
        """A plain substring regex passes when output contains the substring."""
        body = self._regex_body(reference="Paris", outputs="The capital is Paris.")
        resp = _invoke_with_inspect(
            services_api,
            "/match/v0/invoke",
            body=body,
        )
        assert resp.status_code == 200, resp.text
        result = resp.json()["data"]["outputs"]
        assert result["m0"]["success"] is True

    def test_multiple_matchers(self, services_api):
        """Multiple matchers produce one result per matcher."""
        matchers = [
            {
                "key": "m0",
                "mode": "text",
                "match": "regex",
                "target": "$.outputs",
                "reference": "^" + re.escape("yes") + "$",
            },
            {
                "key": "m1",
                "mode": "text",
                "match": "regex",
                "target": "$.outputs",
                "reference": "yes",
            },
        ]
        body = _base_body(
            parameters={"matchers": matchers},
            outputs="yes",
        )
        resp = _invoke_with_inspect(
            services_api,
            "/match/v0/invoke",
            body=body,
        )
        assert resp.status_code == 200, resp.text
        result = resp.json()["data"]["outputs"]
        assert "m0" in result and "m1" in result
        assert result["m0"]["success"] is True
        assert result["m1"]["success"] is True

    def test_missing_parameters_returns_error(self, services_api):
        """match_v0 with parameters={} (missing 'matchers' key) returns a non-200 error."""
        body = (
            _base_body()
        )  # parameters={} — handler raises MissingConfigurationParameterV0Error
        resp = _invoke_with_inspect(
            services_api,
            "/match/v0/invoke",
            body=body,
        )
        assert resp.status_code != 200, (
            f"Expected error for missing parameters, got 200: {resp.text}"
        )


# ---------------------------------------------------------------------------
# /hook/v0/invoke — webhook forwarder (no URL configured → error)
# ---------------------------------------------------------------------------


@pytest.mark.acceptance
class TestCustomHookV0:
    """
    hook_v0 forwards to a URL stored in RunningContext.interface.url.
    When called via /invoke without a revision that provides a URL, it errors.
    """

    def test_invocation_without_url_returns_error(self, services_api):
        """POST /hook/v0/invoke without a webhook URL returns a non-200 response."""
        body = _base_body(inputs={"question": "What is 2+2?"}, outputs="4")
        resp = _invoke_with_inspect(
            services_api,
            "/hook/v0/invoke",
            body=body,
        )
        assert resp.status_code != 200, (
            f"Expected error from hook_v0 (no URL), got {resp.status_code}: {resp.text}"
        )
