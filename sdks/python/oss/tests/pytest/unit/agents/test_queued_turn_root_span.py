"""A fresh `on_busy` turn's workflow span carries the turn id the runner runs under.

The `/m` chat sends every message with `on_busy`. On an idle session the platform's admission
answers `{"action": "execute"}` with no execution id, so nothing names the turn before the
handler writes the workflow span. These tests go through the real `/invoke` route: admission,
`wf.invoke`, then the agent handler, with only the platform call and the backend faked.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry.sdk.trace import TracerProvider

from agenta.sdk.agents import AgentResult
from agenta.sdk.agents.handler import AgentComposition, make_agent_handler
from agenta.sdk.decorators.routing import route
from agenta.sdk.models.workflows import WorkflowServiceRequest

from oss.tests.pytest.unit.test_invoke_dispatch_parity_routing import (
    _offline_tracing,
)

_backend: Any = None


async def _agent(
    request: WorkflowServiceRequest,
    inputs: Optional[Dict[str, Any]] = None,
    messages: Optional[List[Any]] = None,
    parameters: Optional[Dict] = None,
):
    handler = make_agent_handler(
        AgentComposition(select_backend=lambda template: _backend)
    )
    return await handler(
        request=request, inputs=inputs, messages=messages, parameters=parameters
    )


class _AdmissionClient:
    def __init__(self, body: Dict[str, Any]):
        self.body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, url, **kwargs):
        return SimpleNamespace(status_code=200, json=lambda: self.body)


def _app() -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {"credentials": "ApiKey caller"}
        return await call_next(request)

    route("/", app=app)(_agent)
    return app


def _invoke_with_admission(make_backend, admission: Dict[str, Any]):
    global _backend
    _backend = make_backend(result=AgentResult(output="ok"))
    platform = MagicMock()
    platform.base_url.return_value = "https://platform.example/api"
    platform.headers.return_value = {}
    platform.timeout = 3
    span = TracerProvider().get_tracer("agenta.tests").start_span("_agent")
    body = {
        "session_id": "s-queue",
        "on_busy": "queue",
        "data": {
            "inputs": {"messages": [{"role": "user", "content": "hi"}]},
            "parameters": {"agent": {"harness": {"kind": "pi_core"}}},
        },
    }

    with (
        _offline_tracing(),
        patch(
            "agenta.sdk.decorators.routing.PlatformConnection",
            return_value=platform,
        ),
        patch(
            "agenta.sdk.decorators.routing.httpx.AsyncClient",
            return_value=_AdmissionClient(admission),
        ),
        patch(
            "agenta.sdk.agents.handler.current_product_span",
            return_value=span,
        ),
    ):
        response = TestClient(_app()).post(
            "/invoke",
            json=body,
            headers={"accept": "application/json", "Idempotency-Key": "m-1"},
        )

    assert response.status_code == 200, response.text
    (created,) = _backend.created_sessions
    return dict(span.attributes or {}), created["turn_id"]


def test_idle_admission_gives_the_workflow_span_the_runner_turn(make_backend):
    # The idle answer of the real admission endpoint carries no execution id.
    attributes, runner_turn_id = _invoke_with_admission(
        make_backend, {"action": "execute"}
    )
    assert runner_turn_id
    assert attributes["ag.session.id"] == "s-queue"
    assert attributes["ag.turn.id"] == runner_turn_id


def test_admitted_execution_id_is_the_turn_of_the_span_and_the_runner(make_backend):
    attributes, runner_turn_id = _invoke_with_admission(
        make_backend, {"action": "execute", "execution_id": "execution-2"}
    )
    assert runner_turn_id == "execution-2"
    assert attributes["ag.turn.id"] == "execution-2"
