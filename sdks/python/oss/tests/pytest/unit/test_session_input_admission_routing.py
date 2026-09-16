"""Durable Queue/Steer admission at the two shared invoke entrypoints."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
import pytest
from starlette.requests import Request

from agenta.sdk.decorators.routing import admit_session_input
from agenta.sdk.models.workflows import WorkflowInvokeRequest


def _request(*, idempotency_key: str = "input-1") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/invoke",
            "headers": [(b"idempotency-key", idempotency_key.encode())],
            "query_string": b"",
        }
    )


class _Client:
    def __init__(self, response, captured):
        self.response = response
        self.captured = captured

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, url, **kwargs):
        self.captured.update({"url": url, **kwargs})
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def _platform():
    connection = MagicMock()
    connection.base_url.return_value = "https://platform.example/api"
    connection.headers.return_value = {"Authorization": "opaque-test-value"}
    connection.timeout = 3
    return connection


@pytest.mark.asyncio
async def test_queue_admission_forwards_the_stable_key_and_returns_202():
    captured = {}
    upstream = SimpleNamespace(
        status_code=202,
        json=lambda: {
            "action": "pending",
            "input": {"id": "00000000-0000-0000-0000-000000000001"},
        },
    )
    request = WorkflowInvokeRequest(
        session_id="session-1",
        on_busy="queue",
        data={"inputs": {"messages": [{"role": "user", "content": "later"}]}},
    )

    with (
        patch(
            "agenta.sdk.decorators.routing.PlatformConnection",
            return_value=_platform(),
        ),
        patch(
            "agenta.sdk.decorators.routing.httpx.AsyncClient",
            return_value=_Client(upstream, captured),
        ),
    ):
        response = await admit_session_input(_request(), request, "ApiKey caller")

    assert response.status_code == 202
    assert json.loads(response.body)["action"] == "pending"
    assert (
        captured["url"] == "https://platform.example/api/sessions/control/inputs/admit"
    )
    assert captured["headers"]["Idempotency-Key"] == "input-1"
    assert captured["json"]["on_busy"] == "queue"
    assert captured["json"]["content"]["session_id"] == "session-1"


@pytest.mark.asyncio
async def test_idle_admission_continues_invoke_with_the_server_execution_id():
    captured = {}
    upstream = SimpleNamespace(
        status_code=200,
        json=lambda: {"action": "execute", "execution_id": "execution-2"},
    )
    request = WorkflowInvokeRequest(
        session_id="session-1",
        on_busy="queue",
        data={"inputs": {"value": "now"}},
    )

    with (
        patch(
            "agenta.sdk.decorators.routing.PlatformConnection",
            return_value=_platform(),
        ),
        patch(
            "agenta.sdk.decorators.routing.httpx.AsyncClient",
            return_value=_Client(upstream, captured),
        ),
    ):
        response = await admit_session_input(_request(), request, "ApiKey caller")

    assert response is None
    assert request.meta["run_id"] == "execution-2"


@pytest.mark.asyncio
async def test_promoted_input_skips_admission_to_avoid_recursive_queueing():
    request = WorkflowInvokeRequest(
        session_id="session-1",
        on_busy="queue",
        meta={"promoted_input_id": "00000000-0000-0000-0000-000000000001"},
        data={"inputs": {"value": "promoted"}},
    )

    with patch("agenta.sdk.decorators.routing.httpx.AsyncClient") as client:
        response = await admit_session_input(_request(), request, "ApiKey caller")

    assert response is None
    client.assert_not_called()


@pytest.mark.asyncio
async def test_precommit_transport_failure_returns_a_retryable_503():
    request = WorkflowInvokeRequest(
        session_id="session-1",
        on_busy="steer",
        data={"inputs": {"value": "urgent"}},
    )
    transport_error = httpx.ConnectError("unreachable")

    with (
        patch(
            "agenta.sdk.decorators.routing.PlatformConnection",
            return_value=_platform(),
        ),
        patch(
            "agenta.sdk.decorators.routing.httpx.AsyncClient",
            return_value=_Client(transport_error, {}),
        ),
    ):
        response = await admit_session_input(_request(), request, "ApiKey caller")

    body = json.loads(response.body)
    assert response.status_code == 503
    assert body["retryable"] is True
    assert body["next_step"] == "Retry with the same idempotency key."
