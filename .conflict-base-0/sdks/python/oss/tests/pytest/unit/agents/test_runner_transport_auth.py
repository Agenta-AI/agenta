"""The runner HTTP transport sends the REQUIRED shared-token header.

``AGENTA_RUNNER_TOKEN`` is required on both sides: the runner refuses to start without it
(``services/runner/src/config/runner-config.ts``) and rejects an un-tokened POST with 401. There is
no unauthenticated mode. These tests pin the Python side: ``deliver_http_result`` /
``deliver_http_stream`` attach ``Authorization: Bearer <token>`` when the env var is set, and RAISE
when it is not — surfacing one clear message instead of an opaque 401 from the sidecar.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

import httpx
import pytest

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


def test_auth_headers_raise_when_token_unset(monkeypatch):
    # The token is required, so a missing one is a configuration error we surface here — not a
    # silent un-tokened request that the runner would answer with an opaque 401.
    monkeypatch.delenv("AGENTA_RUNNER_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="AGENTA_RUNNER_TOKEN is required"):
        _runner_auth_headers()


def test_auth_headers_raise_when_token_blank(monkeypatch):
    # An empty/whitespace value is "unset" at this boundary (compose renders an unset var as "").
    monkeypatch.setenv("AGENTA_RUNNER_TOKEN", "   ")
    with pytest.raises(RuntimeError, match="AGENTA_RUNNER_TOKEN is required"):
        _runner_auth_headers()


def test_auth_headers_present_when_token_set(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_TOKEN", "s3cr3t")
    assert _runner_auth_headers() == {"Authorization": "Bearer s3cr3t"}


def test_auth_headers_read_per_call(monkeypatch):
    # Read fresh each call (not cached at import), so a runtime env flip takes effect.
    monkeypatch.setenv("AGENTA_RUNNER_TOKEN", "first")
    assert _runner_auth_headers() == {"Authorization": "Bearer first"}
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


async def test_deliver_http_raises_when_token_unset(monkeypatch):
    # Fails before the request is issued: `capture` stays empty, so we never send an un-tokened
    # POST the runner would only answer with 401.
    monkeypatch.delenv("AGENTA_RUNNER_TOKEN", raising=False)
    capture: Dict[str, Any] = {}
    monkeypatch.setattr(
        httpx, "AsyncClient", _fake_post_client(capture, payload={"ok": True})
    )

    with pytest.raises(RuntimeError, match="AGENTA_RUNNER_TOKEN is required"):
        await deliver_http_result("http://runner:8765", {"harness": "pi_core"})

    assert capture == {}


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


async def test_deliver_http_stream_raises_when_token_unset(monkeypatch):
    # Same contract on the streaming transport: raise before opening the stream.
    monkeypatch.delenv("AGENTA_RUNNER_TOKEN", raising=False)
    capture: Dict[str, Any] = {}
    lines = [json.dumps({"kind": "result", "result": {"ok": True}})]
    monkeypatch.setattr(httpx, "AsyncClient", _fake_stream_client(capture, lines=lines))

    with pytest.raises(RuntimeError, match="AGENTA_RUNNER_TOKEN is required"):
        _ = [
            record
            async for record in deliver_http_stream(
                "http://runner:8765", {"harness": "pi_core"}
            )
        ]

    assert capture == {}
