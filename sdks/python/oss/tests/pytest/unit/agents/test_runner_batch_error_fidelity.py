"""The batch HTTP transport surfaces the runner's actionable error, not a generic HTTP 500.

F-038: a run failure comes back from the runner as HTTP 500 with a *result* body
(``{"ok": false, "error": <concise message>}``; see ``services/agent/src/server.ts``). That
``error`` is the actionable, already-sanitized provider message and is the SAME body the
streaming path surfaces. The batch path (``/invoke`` + the ``/messages`` JSON path) used to
discard the body and raise a generic "Agent runner HTTP 500", losing the actionable text.

These tests pin that ``deliver_http`` now returns a runner result body (success OR failure) so
``result_from_wire`` raises with the concise message, while a genuine non-result error body
(no ``ok`` key, e.g. a proxy error) still falls through to the generic transport error.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from agenta.sdk.agents.utils.ts_runner import deliver_http
from agenta.sdk.agents.utils.wire import result_from_wire


class _FakeResponse:
    def __init__(self, status_code: int, payload: Any, *, text: Any = None) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else json.dumps(payload)

    def json(self) -> Any:
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


def _fake_client(*, response: _FakeResponse):
    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, json=None, headers=None):
            return response

    return _Client


CONCISE = (
    "pi_core: the model provider account has insufficient credit "
    "(check the project's Anthropic key)."
)


async def test_failure_500_returns_result_body_with_concise_error(monkeypatch):
    monkeypatch.delenv("AGENTA_AGENT_RUNNER_TOKEN", raising=False)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _fake_client(response=_FakeResponse(500, {"ok": False, "error": CONCISE})),
    )

    body = await deliver_http("http://runner:8765", {"harness": "pi_core"})

    # The body survives the >=400 status instead of being swallowed as a transport failure.
    assert body == {"ok": False, "error": CONCISE}


async def test_failure_500_surfaces_concise_error_through_result_from_wire(monkeypatch):
    # End-to-end of the batch boundary: the concise provider message reaches the caller,
    # matching what SSE already surfaces, not a generic "HTTP 500".
    monkeypatch.delenv("AGENTA_AGENT_RUNNER_TOKEN", raising=False)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _fake_client(response=_FakeResponse(500, {"ok": False, "error": CONCISE})),
    )

    body = await deliver_http("http://runner:8765", {"harness": "pi_core"})
    with pytest.raises(RuntimeError) as excinfo:
        result_from_wire(body)

    message = str(excinfo.value)
    assert "insufficient credit" in message
    assert "Anthropic key" in message
    assert "HTTP 500" not in message


async def test_success_2xx_still_returns_body(monkeypatch):
    monkeypatch.delenv("AGENTA_AGENT_RUNNER_TOKEN", raising=False)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _fake_client(response=_FakeResponse(200, {"ok": True, "output": "hi"})),
    )

    body = await deliver_http("http://runner:8765", {"harness": "pi_core"})

    assert body == {"ok": True, "output": "hi"}


async def test_non_result_error_body_falls_through_to_transport_error(monkeypatch):
    # A genuine transport failure (no ``ok`` key, e.g. a proxy/gateway error page) stays a
    # generic transport error; we do not mistake an arbitrary 4xx/5xx body for a run result.
    monkeypatch.delenv("AGENTA_AGENT_RUNNER_TOKEN", raising=False)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _fake_client(
            response=_FakeResponse(502, {"detail": "bad gateway"}, text="bad gateway")
        ),
    )

    with pytest.raises(RuntimeError) as excinfo:
        await deliver_http("http://runner:8765", {"harness": "pi_core"})

    assert "Agent runner HTTP 502" in str(excinfo.value)


async def test_non_json_error_body_falls_through_to_transport_error(monkeypatch):
    # A 500 whose body is not JSON at all (e.g. an HTML error page) is a transport failure.
    monkeypatch.delenv("AGENTA_AGENT_RUNNER_TOKEN", raising=False)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _fake_client(
            response=_FakeResponse(
                500, ValueError("not json"), text="<html>boom</html>"
            )
        ),
    )

    with pytest.raises(RuntimeError) as excinfo:
        await deliver_http("http://runner:8765", {"harness": "pi_core"})

    assert "Agent runner HTTP 500" in str(excinfo.value)
