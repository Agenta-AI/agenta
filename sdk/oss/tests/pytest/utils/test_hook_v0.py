"""
Unit tests for the hook_v0 handler (agenta:builtin:hook:v0).

Tests are organised into:

1. URL resolution — missing URL, URL from RunningContext revision data.
2. URL validation — blocked IP ranges, invalid schemes, valid http/https.
3. Payload construction — which fields appear in the JSON body based on arguments.
4. Response parsing — JSON response, plain-text fallback.
5. Error handling — non-200 status codes, client-side network errors, oversized response.

async handlers are called via asyncio.run() so no pytest-asyncio marker is needed.
The @instrument() decorator is bypassed via __wrapped__.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agenta.sdk.contexts.running import RunningContext, running_context_manager
from agenta.sdk.models.workflows import WorkflowRevisionData
from agenta.sdk.workflows.errors import (
    InvalidConfigurationParameterV0Error,
    MissingConfigurationParameterV0Error,
    WebhookClientV0Error,
    WebhookServerV0Error,
)
from agenta.sdk.workflows.handlers import hook_v0

_hook_v0 = hook_v0.__wrapped__


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def make_revision(url: str) -> dict:
    return WorkflowRevisionData(
        uri="user:custom:test:latest",
        url=url,
    ).model_dump(mode="json", exclude_none=True)


def make_response(body, *, status_code: int = 200):
    """Build a minimal mock httpx.Response."""
    if isinstance(body, (dict, list)):
        raw = json.dumps(body).encode()
        content_type = "application/json"
    else:
        raw = str(body).encode()
        content_type = "text/plain"

    mock = MagicMock()
    mock.status_code = status_code
    mock.content = raw
    mock.text = raw.decode()
    mock.headers = {"content-type": content_type}
    mock.json.return_value = (
        json.loads(raw) if content_type == "application/json" else None
    )
    return mock


def with_url(url: str):
    """Context manager that injects a RunningContext with the given revision URL."""
    ctx = RunningContext(revision=make_revision(url))
    return running_context_manager(ctx)


def call_with_url(
    url: str, *, inputs=None, parameters=None, outputs=None, trace=None, testcase=None
):
    with with_url(url):
        return run(
            _hook_v0(
                inputs=inputs,
                parameters=parameters,
                outputs=outputs,
                trace=trace,
                testcase=testcase,
            )
        )


def patched_post(response_mock):
    """Patch httpx.AsyncClient so .post() returns response_mock."""
    client_instance = AsyncMock()
    client_instance.__aenter__ = AsyncMock(return_value=client_instance)
    client_instance.__aexit__ = AsyncMock(return_value=False)
    client_instance.post = AsyncMock(return_value=response_mock)
    return patch("httpx.AsyncClient", return_value=client_instance), client_instance


# ---------------------------------------------------------------------------
# 1. URL resolution
# ---------------------------------------------------------------------------


class TestHookV0UrlResolution:
    def test_no_context_raises_missing_url(self):
        """No RunningContext at all → MissingConfigurationParameterV0Error."""
        with pytest.raises(MissingConfigurationParameterV0Error):
            run(_hook_v0())

    def test_context_without_interface_raises_missing_url(self):
        ctx = RunningContext(revision=None)
        with running_context_manager(ctx):
            with pytest.raises(MissingConfigurationParameterV0Error):
                run(_hook_v0())

    def test_context_with_url_proceeds(self):
        resp = make_response({"score": 1.0})
        p, client = patched_post(resp)
        with p:
            result = call_with_url("http://example.com/hook")
        assert result == {"score": 1.0}
        client.post.assert_awaited_once()


# ---------------------------------------------------------------------------
# 2. URL validation
# ---------------------------------------------------------------------------


class TestHookV0UrlValidation:
    def test_http_url_accepted(self):
        resp = make_response({"ok": True})
        p, _ = patched_post(resp)
        with p:
            result = call_with_url("http://example.com/eval")
        assert result == {"ok": True}

    def test_https_url_accepted(self):
        # Mock DNS resolution so the test is environment-independent.
        resp = make_response({"ok": True})
        p, _ = patched_post(resp)
        dns_mock = patch(
            "socket.getaddrinfo",
            return_value=[(2, 1, 6, "", ("93.184.216.34", 0))],
        )
        with dns_mock, p:
            result = call_with_url("https://secure.example.com/eval")
        assert result == {"ok": True}

    def test_blocked_localhost_rejected(self):
        # Disable insecure mode so private-IP / loopback blocking is enforced.
        with patch("agenta.sdk.workflows.handlers._WEBHOOK_ALLOW_INSECURE", False):
            with pytest.raises(InvalidConfigurationParameterV0Error):
                call_with_url("https://127.0.0.1/hook")

    def test_blocked_loopback_name_rejected(self):
        with patch("agenta.sdk.workflows.handlers._WEBHOOK_ALLOW_INSECURE", False):
            with pytest.raises(InvalidConfigurationParameterV0Error):
                call_with_url("https://localhost/hook")


# ---------------------------------------------------------------------------
# 3. Payload construction
# ---------------------------------------------------------------------------


class TestHookV0Payload:
    def _capture_payload(self, url="http://example.com/hook", **kwargs):
        """Call hook_v0 with patched POST and return the JSON payload sent."""
        resp = make_response({"ok": True})
        p, client = patched_post(resp)
        with p:
            call_with_url(url, **kwargs)
        _, call_kwargs = client.post.call_args
        return (
            call_kwargs.get("json")
            or client.post.call_args[1].get("json")
            or client.post.call_args.kwargs.get("json")
        )

    def test_minimal_payload_always_has_inputs_and_parameters(self):
        payload = self._capture_payload()
        assert "inputs" in payload
        assert "parameters" in payload

    def test_inputs_forwarded(self):
        payload = self._capture_payload(inputs={"q": "hello"})
        assert payload["inputs"] == {"q": "hello"}

    def test_parameters_forwarded(self):
        payload = self._capture_payload(parameters={"threshold": 0.7})
        assert payload["parameters"] == {"threshold": 0.7}

    def test_outputs_included_when_provided(self):
        payload = self._capture_payload(outputs={"answer": "Paris"})
        assert "outputs" in payload
        assert payload["outputs"] == {"answer": "Paris"}

    def test_outputs_omitted_when_none(self):
        payload = self._capture_payload(outputs=None)
        assert "outputs" not in payload

    def test_trace_included_when_provided(self):
        payload = self._capture_payload(trace={"latency_ms": 42})
        assert "trace" in payload
        assert payload["trace"] == {"latency_ms": 42}

    def test_trace_omitted_when_none(self):
        payload = self._capture_payload(trace=None)
        assert "trace" not in payload

    def test_testcase_included_when_provided(self):
        payload = self._capture_payload(testcase={"correct_answer": "42"})
        assert "testcase" in payload
        assert payload["testcase"] == {"correct_answer": "42"}

    def test_testcase_omitted_when_none(self):
        payload = self._capture_payload(testcase=None)
        assert "testcase" not in payload

    def test_full_evaluator_payload(self):
        payload = self._capture_payload(
            inputs={"q": "What is 2+2?"},
            parameters={"threshold": 0.5},
            outputs="4",
            trace={"latency_ms": 10},
            testcase={"correct_answer": "4"},
        )
        assert payload["inputs"] == {"q": "What is 2+2?"}
        assert payload["parameters"] == {"threshold": 0.5}
        assert payload["outputs"] == "4"
        assert payload["trace"] == {"latency_ms": 10}
        assert payload["testcase"] == {"correct_answer": "4"}

    def test_none_inputs_sent_as_empty_dict(self):
        payload = self._capture_payload(inputs=None)
        assert payload["inputs"] == {}

    def test_none_parameters_sent_as_empty_dict(self):
        payload = self._capture_payload(parameters=None)
        assert payload["parameters"] == {}


# ---------------------------------------------------------------------------
# 4. Response parsing
# ---------------------------------------------------------------------------


class TestHookV0ResponseParsing:
    def test_json_dict_returned_as_dict(self):
        resp = make_response({"score": 0.8, "success": True})
        p, _ = patched_post(resp)
        with p:
            result = call_with_url("http://example.com/hook")
        assert result == {"score": 0.8, "success": True}

    def test_json_list_returned_as_list(self):
        resp = make_response([1, 2, 3])
        p, _ = patched_post(resp)
        with p:
            result = call_with_url("http://example.com/hook")
        assert result == [1, 2, 3]

    def test_json_number_returned_as_number(self):
        raw = b"0.9"
        mock = MagicMock()
        mock.status_code = 200
        mock.content = raw
        mock.headers = {}
        p, _ = patched_post(mock)
        with p:
            result = call_with_url("http://example.com/hook")
        assert result == pytest.approx(0.9)

    def test_plain_text_returned_as_string(self):
        raw = b"some text response"
        mock = MagicMock()
        mock.status_code = 200
        mock.content = raw
        mock.headers = {}
        p, _ = patched_post(mock)
        with p:
            result = call_with_url("http://example.com/hook")
        assert result == "some text response"


# ---------------------------------------------------------------------------
# 5. Error handling
# ---------------------------------------------------------------------------


class TestHookV0ErrorHandling:
    def test_non_200_status_raises_server_error(self):
        resp = make_response({"error": "not found"}, status_code=404)
        p, _ = patched_post(resp)
        with p:
            with pytest.raises(WebhookServerV0Error) as exc_info:
                call_with_url("http://example.com/hook")
        assert exc_info.value.code == 404

    def test_500_status_raises_server_error(self):
        resp = make_response("internal server error", status_code=500)
        p, _ = patched_post(resp)
        with p:
            with pytest.raises(WebhookServerV0Error) as exc_info:
                call_with_url("http://example.com/hook")
        assert exc_info.value.code == 500

    def test_network_error_raises_client_error(self):
        client_instance = AsyncMock()
        client_instance.__aenter__ = AsyncMock(return_value=client_instance)
        client_instance.__aexit__ = AsyncMock(return_value=False)
        client_instance.post = AsyncMock(side_effect=ConnectionError("refused"))

        with patch("httpx.AsyncClient", return_value=client_instance):
            with pytest.raises(WebhookClientV0Error):
                call_with_url("http://example.com/hook")

    def test_timeout_error_raises_client_error(self):
        import httpx as _httpx

        client_instance = AsyncMock()
        client_instance.__aenter__ = AsyncMock(return_value=client_instance)
        client_instance.__aexit__ = AsyncMock(return_value=False)
        client_instance.post = AsyncMock(
            side_effect=_httpx.TimeoutException("timed out")
        )

        with patch("httpx.AsyncClient", return_value=client_instance):
            with pytest.raises(WebhookClientV0Error):
                call_with_url("http://example.com/hook")

    def test_oversized_response_raises_client_error(self):
        from agenta.sdk.workflows.handlers import _WEBHOOK_RESPONSE_MAX_BYTES

        raw = b"x" * (int(_WEBHOOK_RESPONSE_MAX_BYTES) + 1)
        mock = MagicMock()
        mock.status_code = 200
        mock.content = raw
        mock.headers = {}
        p, _ = patched_post(mock)
        with p:
            with pytest.raises(WebhookClientV0Error):
                call_with_url("http://example.com/hook")

    def test_oversized_via_content_length_header_raises(self):
        from agenta.sdk.workflows.handlers import _WEBHOOK_RESPONSE_MAX_BYTES

        raw = b"tiny body"
        mock = MagicMock()
        mock.status_code = 200
        mock.content = raw
        mock.headers = {"content-length": str(int(_WEBHOOK_RESPONSE_MAX_BYTES) + 1)}
        p, _ = patched_post(mock)
        with p:
            with pytest.raises(WebhookClientV0Error):
                call_with_url("http://example.com/hook")
