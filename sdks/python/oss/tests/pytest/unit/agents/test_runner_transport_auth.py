"""The runner HTTP transport sends the optional shared-token header (Codex LOW-5).

The runner's ``/run`` endpoint has an opt-in shared-token gate (``AGENTA_RUNNER_TOKEN``,
default OFF; see ``services/runner/src/server.ts``). When the operator turns it on, an un-tokened
POST from the co-located Python service is rejected with 401. These tests pin the Python side of
that contract: ``deliver_http_result`` / ``deliver_http_stream`` attach ``Authorization: Bearer
<token>`` when the same env var is set, and send no auth header when it is not (loopback default).
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

import httpx

from agenta.sdk.agents.utils.ts_runner import (
    _runner_auth_headers,
    deliver_http_result,
    deliver_http_stream,
)


class _FakeResponse:
    def __init__(self, status_code: int, payload: Any) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self) -> Any:
        return self._payload


def _fake_post_client(capture: Dict[str, Any], *, payload: Any):
    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, json=None, headers=None):
            capture.update(url=url, json=json, headers=headers or {})
            return _FakeResponse(200, payload)

    return _Client


def _fake_stream_client(capture: Dict[str, Any], *, lines: List[str]):
    class _Stream:
        def __init__(self) -> None:
            self.status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def aiter_lines(self):
            for line in lines:
                yield line

        async def aread(self) -> bytes:
            return b""

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url, json=None, headers=None):
            capture.update(method=method, url=url, json=json, headers=headers or {})
            return _Stream()

    return _Client


# --- _runner_auth_headers (pure, env-driven) -------------------------------


def test_auth_headers_absent_by_default(monkeypatch):
    monkeypatch.delenv("AGENTA_RUNNER_TOKEN", raising=False)
    assert _runner_auth_headers() == {}


def test_auth_headers_present_when_token_set(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_TOKEN", "s3cr3t")
    assert _runner_auth_headers() == {"Authorization": "Bearer s3cr3t"}


def test_auth_headers_read_per_call(monkeypatch):
    # Read fresh each call (not cached at import), so a runtime env flip takes effect.
    monkeypatch.delenv("AGENTA_RUNNER_TOKEN", raising=False)
    assert _runner_auth_headers() == {}
    monkeypatch.setenv("AGENTA_RUNNER_TOKEN", "later")
    assert _runner_auth_headers() == {"Authorization": "Bearer later"}


# --- deliver_http_result (one-shot) -----------------------------------------------


async def test_deliver_http_sends_bearer_when_token_set(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_TOKEN", "tok-123")
    capture: Dict[str, Any] = {}
    monkeypatch.setattr(
        httpx, "AsyncClient", _fake_post_client(capture, payload={"ok": True})
    )

    result = await deliver_http_result("http://runner:8765", {"harness": "pi_core"})

    assert result == {"ok": True}
    assert capture["headers"].get("Authorization") == "Bearer tok-123"
    assert capture["url"] == "http://runner:8765/run"


async def test_deliver_http_no_auth_header_when_unset(monkeypatch):
    monkeypatch.delenv("AGENTA_RUNNER_TOKEN", raising=False)
    capture: Dict[str, Any] = {}
    monkeypatch.setattr(
        httpx, "AsyncClient", _fake_post_client(capture, payload={"ok": True})
    )

    await deliver_http_result("http://runner:8765", {"harness": "pi_core"})

    assert "Authorization" not in capture["headers"]


# --- deliver_http_stream (NDJSON) ------------------------------------------


async def test_deliver_http_stream_sends_bearer_and_keeps_accept(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_TOKEN", "tok-stream")
    capture: Dict[str, Any] = {}
    lines = [json.dumps({"kind": "result", "result": {"ok": True}})]
    monkeypatch.setattr(httpx, "AsyncClient", _fake_stream_client(capture, lines=lines))

    records = [
        record
        async for record in deliver_http_stream(
            "http://runner:8765", {"harness": "pi_core"}
        )
    ]

    assert records == [{"kind": "result", "result": {"ok": True}}]
    # The auth header rides alongside the NDJSON Accept header, neither clobbers the other.
    assert capture["headers"].get("Authorization") == "Bearer tok-stream"
    assert capture["headers"].get("Accept") == "application/x-ndjson"


async def test_deliver_http_stream_no_auth_header_when_unset(monkeypatch):
    monkeypatch.delenv("AGENTA_RUNNER_TOKEN", raising=False)
    capture: Dict[str, Any] = {}
    lines = [json.dumps({"kind": "result", "result": {"ok": True}})]
    monkeypatch.setattr(httpx, "AsyncClient", _fake_stream_client(capture, lines=lines))

    _ = [
        record
        async for record in deliver_http_stream(
            "http://runner:8765", {"harness": "pi_core"}
        )
    ]

    assert "Authorization" not in capture["headers"]
    assert capture["headers"].get("Accept") == "application/x-ndjson"
