"""The small naming call beside a first turn: which model it uses, what it writes, and when."""

from __future__ import annotations

import asyncio
import json
from typing import List

import httpx
import pytest

from agenta.sdk.agents import naming
from agenta.sdk.agents.connections import ResolvedConnection
from agenta.sdk.agents.connections.models import (
    EnvironmentCredentialBinding,
    ResolvedCredential,
)
from agenta.sdk.agents.dtos import SessionContext, to_messages
from agenta.sdk.agents.handler import AgentComposition, make_agent_handler
from agenta.sdk.agents.platform.connection import PlatformConnection
from agenta.sdk.models.workflows import WorkflowServiceRequest

from .test_agent_composition_seam import _FakeBackend, _no_connection

_MESSAGE = "help me put together a smoke-test plan for the billing migration"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for name in (
        naming.UTILITY_MODEL_ENV,
        naming.UTILITY_MODEL_API_URL_ENV,
        naming.UTILITY_MODEL_API_KEY_ENV,
    ):
        monkeypatch.delenv(name, raising=False)


def _gateway_connection(
    base_url="https://cloud.example.com/api/gateways/llms/builtin/agenta/v1",
):
    return ResolvedConnection.model_validate(
        {
            "provider": "openai",
            "model": "google/gemini-3.8-flash",
            "deployment": "custom",
            "credential_mode": "none",
            "endpoint": {"base_url": base_url},
            "gateway_credentials": {"value": "Secret gateway-token"},
        }
    )


def _key_connection(provider="openai", name="OPENAI_API_KEY"):
    return ResolvedConnection(
        provider=provider,
        model="gpt-5.5-nano",
        credential_mode="env",
        credentials=[
            ResolvedCredential(
                binding=EnvironmentCredentialBinding(name=name),
                value="sk-test",
                usage="local_use",
            )
        ],
    )


# --------------------------------------------------------------------------- #
# Which model
# --------------------------------------------------------------------------- #
def test_a_configured_endpoint_wins(monkeypatch):
    monkeypatch.setenv(naming.UTILITY_MODEL_API_URL_ENV, "http://ollama:11434/v1/")
    monkeypatch.setenv(naming.UTILITY_MODEL_ENV, "qwen3:1.7b")
    route = naming.configured_route()
    assert route.base_url == "http://ollama:11434/v1"
    assert route.model == "qwen3:1.7b"
    # A local server may need no key, so none is sent.
    assert route.headers == {}

    monkeypatch.setenv(naming.UTILITY_MODEL_API_KEY_ENV, "sk-local")
    assert naming.configured_route().headers == {"Authorization": "Bearer sk-local"}
    assert naming.builtin_model() is None


def test_an_endpoint_without_a_model_configures_nothing(monkeypatch):
    monkeypatch.setenv(naming.UTILITY_MODEL_API_URL_ENV, "http://ollama:11434/v1")
    assert naming.configured_route() is None
    assert naming.builtin_model() is None


def test_a_model_alone_names_a_builtin_model(monkeypatch):
    monkeypatch.setenv(naming.UTILITY_MODEL_ENV, "google/gemini-3.8-flash")
    assert naming.configured_route() is None
    assert naming.builtin_model() == "google/gemini-3.8-flash"


def test_a_gateway_connection_gives_a_route_on_the_internal_address():
    platform = PlatformConnection(base_url="https://api.internal.example/api")
    route = naming.route_from_connection(
        _gateway_connection(
            "https://api.internal.example/api/gateways/llms/builtin/agenta/v1"
        ),
        platform=platform,
    )
    assert (
        route.base_url
        == "https://api.internal.example/api/gateways/llms/builtin/agenta/v1"
    )
    assert route.headers == {"X-AG-Credentials": "Secret gateway-token"}
    assert route.model == "google/gemini-3.8-flash"


def test_the_public_gateway_address_is_rewritten_to_the_internal_one(monkeypatch):
    monkeypatch.setenv("AGENTA_API_URL", "https://cloud.example.com/api")
    monkeypatch.setattr(
        "agenta.sdk.agents.platform.connection._derive_base_url",
        lambda: "https://api.internal.example/api",
    )
    route = naming.route_from_connection(
        _gateway_connection(), platform=PlatformConnection()
    )
    assert (
        route.base_url
        == "https://api.internal.example/api/gateways/llms/builtin/agenta/v1"
    )


def test_an_openai_key_gives_a_direct_route():
    route = naming.route_from_connection(
        _key_connection(), platform=PlatformConnection(base_url="http://api/api")
    )
    assert route.base_url == naming.OPENAI_BASE_URL
    assert route.headers == {"Authorization": "Bearer sk-test"}


@pytest.mark.parametrize(
    "connection",
    [
        None,
        _key_connection(provider="anthropic", name="ANTHROPIC_API_KEY"),
        ResolvedConnection(
            provider="openai", model="gpt-5.5", credential_mode="runtime_provided"
        ),
    ],
)
def test_a_connection_this_process_cannot_call_gives_no_route(connection):
    assert (
        naming.route_from_connection(
            connection, platform=PlatformConnection(base_url="http://api/api")
        )
        is None
    )


# --------------------------------------------------------------------------- #
# The reply
# --------------------------------------------------------------------------- #
def test_the_names_are_parsed_and_cut():
    names = naming.parse_names(
        "```json\n"
        + json.dumps(
            {
                "session_name": "Billing migration smoke test " + "x" * 80,
                "description": "Plan the  smoke tests\nfor Friday.",
                "agent_name": "Release QA Assistant",
            }
        )
        + "\n```",
        name_agent=True,
    )
    assert len(names.session_name) <= naming.MAX_NAME_CHARS
    assert names.session_name.startswith("Billing migration smoke test")
    assert names.description == "Plan the smoke tests for Friday."
    assert names.agent_name == "Release QA Assistant"


def test_an_agent_name_is_dropped_when_the_agent_has_a_real_name():
    names = naming.parse_names(
        '{"session_name": "Q3 notes", "agent_name": "Other"}', name_agent=False
    )
    assert names.agent_name is None


@pytest.mark.parametrize(
    "content", [None, "", "{}", "not json", '{"session_name": " "}']
)
def test_a_vague_or_unreadable_reply_gives_no_names(content):
    assert naming.parse_names(content, name_agent=True) is None


def test_the_first_user_message_is_the_one_named():
    messages = to_messages(
        [
            {"role": "system", "content": "be brief"},
            {"role": "user", "content": [{"type": "text", "text": _MESSAGE}]},
            {"role": "user", "content": "later"},
        ]
    )
    assert naming.first_user_text(messages) == _MESSAGE


# --------------------------------------------------------------------------- #
# The call and the writes
# --------------------------------------------------------------------------- #
class _Api:
    """Answers the model call and records every request."""

    def __init__(self, reply: dict) -> None:
        self.reply = reply
        self.status = 200
        self.refuse_reasoning = False
        self.requests: List[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path.endswith("/chat/completions"):
            if self.refuse_reasoning and "reasoning_effort" in json.loads(
                request.content
            ):
                return httpx.Response(400, json={"error": "reasoning_effort"})
            return httpx.Response(
                self.status,
                json={"choices": [{"message": {"content": json.dumps(self.reply)}}]},
            )
        return httpx.Response(200, json={})

    def paths(self) -> List[str]:
        return [request.url.path for request in self.requests]


@pytest.fixture
def api(monkeypatch):
    fake = _Api(
        {
            "session_name": "Billing migration smoke tests",
            "description": "Plan the smoke tests for Friday's billing migration.",
            "agent_name": "Release QA Assistant",
        }
    )
    real = httpx.AsyncClient

    def _client(**kwargs):
        return real(transport=httpx.MockTransport(fake), **kwargs)

    monkeypatch.setattr(naming.httpx, "AsyncClient", _client)
    monkeypatch.setattr(
        "agenta.sdk.agents.platform.connection._derive_base_url",
        lambda: "https://api.internal.example/api",
    )
    monkeypatch.setattr(
        "agenta.sdk.agents.platform.connection._derive_authorization",
        lambda: "ApiKey caller",
    )
    monkeypatch.delenv("AGENTA_API_URL", raising=False)
    return fake


def _start(**overrides):
    kwargs = dict(
        messages=to_messages([{"role": "user", "content": _MESSAGE}]),
        session_id="s-1",
        workflow_id="wf-1",
        name_agent=True,
        resolved_connection=_gateway_connection(
            "https://api.internal.example/api/gateways/llms/builtin/agenta/v1"
        ),
        resolve_connection=_no_connection,
    )
    kwargs.update(overrides)
    return naming.start_session_naming(**kwargs)


async def _settle():
    await asyncio.gather(*naming.SessionNaming._running)


async def test_the_names_are_written_only_after_the_runner_frame(api):
    handle = _start()
    for _ in range(20):
        await asyncio.sleep(0)
    assert api.paths() == ["/api/gateways/llms/builtin/agenta/v1/chat/completions"]

    handle.runner_started()
    await _settle()
    model_call, session_write, agent_write = api.requests
    body = json.loads(model_call.content)
    assert body["model"] == "google/gemini-3.8-flash"
    assert body["reasoning_effort"] == "minimal"
    assert body["messages"][-1] == {"role": "user", "content": _MESSAGE}
    assert model_call.headers["X-AG-Credentials"] == "Secret gateway-token"

    assert session_write.method == "POST"
    assert session_write.url.path == "/api/sessions/streams/header"
    assert dict(session_write.url.params) == {
        "session_id": "s-1",
        "name_source": "automatic",
    }
    assert json.loads(session_write.content) == {
        "name": "Billing migration smoke tests",
        "description": "Plan the smoke tests for Friday's billing migration.",
    }
    assert session_write.headers["Authorization"] == "ApiKey caller"

    assert agent_write.method == "PUT"
    assert agent_write.url.path == "/api/workflows/wf-1"
    assert json.loads(agent_write.content) == {
        "workflow": {"id": "wf-1", "name": "Release QA Assistant"}
    }


async def test_a_turn_with_no_runner_frame_writes_nothing(api):
    handle = _start()
    handle.turn_ended()
    await _settle()
    assert len(api.requests) == 1


async def test_a_real_agent_name_is_never_replaced(api):
    handle = _start(name_agent=False)
    handle.runner_started()
    await _settle()
    assert [request.method for request in api.requests] == ["POST", "POST"]
    assert (
        "agent_name"
        not in json.loads(api.requests[0].content)["messages"][0]["content"]
    )


async def test_a_vague_message_writes_nothing(api):
    api.reply = {}
    handle = _start(messages=to_messages([{"role": "user", "content": "hi"}]))
    handle.runner_started()
    await _settle()
    assert len(api.requests) == 1


async def test_a_model_failure_writes_nothing(api):
    api.status = 500
    handle = _start()
    handle.runner_started()
    await _settle()
    assert len(api.requests) == 1


async def test_a_subscription_run_starts_no_call(api):
    assert (
        _start(
            resolved_connection=ResolvedConnection(
                provider="openai", model="gpt-5.5", credential_mode="runtime_provided"
            )
        )
        is None
    )
    assert api.requests == []


async def test_a_builtin_model_resolves_through_the_runs_resolver(api, monkeypatch):
    monkeypatch.setenv(naming.UTILITY_MODEL_ENV, "google/gemini-3.7-flash")
    seen = []

    async def _resolve(*, model, context):
        seen.append((model, context))
        return _gateway_connection(
            "https://api.internal.example/api/gateways/llms/builtin/agenta/v1"
        ).model_copy(update={"model": model.model})

    handle = _start(resolved_connection=None, resolve_connection=_resolve)
    handle.runner_started()
    await _settle()
    [(model, context)] = seen
    assert model.model == "google/gemini-3.7-flash"
    assert (model.connection.slug, model.connection.namespace) == ("agenta", "builtin")
    assert (context.session_id, context.agent_id) == ("s-1", "wf-1")
    assert json.loads(api.requests[0].content)["model"] == "google/gemini-3.7-flash"


# --------------------------------------------------------------------------- #
# The handler starts it on a first turn of an unnamed session only
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "context, expected",
    [
        (SessionContext(agent_name="New agent", first_turn=True), [True]),
        (SessionContext(agent_name="Changelog writer", first_turn=True), [False]),
        (SessionContext(session_name="Q3 notes", first_turn=True), []),
        (SessionContext(first_turn=False), []),
        (None, []),
    ],
)
async def test_the_handler_starts_naming_on_a_new_unnamed_session_only(
    monkeypatch, context, expected
):
    started = []

    def _start_naming(**kwargs):
        started.append(kwargs["name_agent"])
        return None

    monkeypatch.setattr("agenta.sdk.agents.handler.start_session_naming", _start_naming)

    async def _context(*, session_id, workflow_id):
        return context

    handler = make_agent_handler(
        AgentComposition(
            select_backend=lambda template: _FakeBackend(),
            resolve_connection=_no_connection,
            resolve_session_context=_context,
        )
    )
    await handler(
        request=WorkflowServiceRequest(session_id="s-42"),
        messages=[{"role": "user", "content": _MESSAGE}],
        parameters={"agent": {"harness": {"kind": "pi_core"}}},
    )
    assert started == expected


async def test_a_refused_thinking_setting_is_retried_without_it(api):
    api.refuse_reasoning = True
    handle = _start()
    handle.runner_started()
    await _settle()
    first, second = (json.loads(request.content) for request in api.requests[:2])
    assert first["reasoning_effort"] == "minimal"
    assert "reasoning_effort" not in second
    assert api.paths()[-2:] == ["/api/sessions/streams/header", "/api/workflows/wf-1"]
