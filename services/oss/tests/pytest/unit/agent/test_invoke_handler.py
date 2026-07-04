"""The ``/invoke`` handler (`_agent`) end-to-end in-process.

Runs the real parse -> resolve -> harness -> record path with a ``FakeBackend`` and the
network-touching helpers stubbed. No runner, no LLM, no HTTP. This is where the cross-harness
"byte-identical response body" guarantee is locked at the Python layer.
"""

from __future__ import annotations

import inspect
from itertools import product

import pytest

from agenta.sdk.agents import (
    AgentTemplate,
    AgentResult,
    ConnectionNotFoundError,
    ConnectionResolutionError,
    Event,
    GatewayToolResolutionError,
    MissingProviderError,
    ResolvedConnection,
    ResolvedToolSet,
)
from agenta.sdk.engines.running.errors import ForceNotSupportedV0Error

from agenta.sdk.models.workflows import WorkflowServiceRequest

from oss.src.agent import app


def _request(*, stream=None, session_id=None):
    """Build the request `_agent` reads stream/session_id off of.

    `_agent` now sources the stream decision from `request.flags.stream` and the
    session id from `request.session_id` (both set at the route/normalizer edge),
    instead of receiving them as handler params.
    """
    flags = {"stream": stream} if stream is not None else None
    return WorkflowServiceRequest(flags=flags, session_id=session_id)


def _patch_handler(monkeypatch, backend, *, builtins=(), tool_callback=None):
    """Stub the network-touching helpers and pin one ``backend`` for the run.

    ``builtins`` are the resolved built-in tool names ``resolve_tools`` hands back, so a turn
    can carry a real tool list and the per-harness translation has something to diverge on.
    Returns the ``recorded`` dict the usage hook writes into.
    """
    recorded = {}

    async def _tools(tools, **_kw):
        return ResolvedToolSet(
            builtin_names=list(builtins),
            tool_callback=tool_callback,
        )

    async def _no_mcp(mcp_servers, **_kw):
        return []

    async def _no_connection(*, model, context):
        # a no-credential plan so existing response-body/lifecycle/cross-harness tests run clean
        return ResolvedConnection(
            provider="openai",
            model="m",
            credential_mode="runtime_provided",
            env={},
        )

    monkeypatch.setattr(app, "resolve_tools", _tools)
    monkeypatch.setattr(app, "resolve_mcp_servers", _no_mcp)
    monkeypatch.setattr(app, "resolve_connection", _no_connection)
    monkeypatch.setattr(app, "trace_context", lambda: None)
    monkeypatch.setattr(
        app, "record_usage", lambda usage: recorded.__setitem__("usage", usage)
    )
    monkeypatch.setattr(app, "select_backend", lambda selection: backend)
    monkeypatch.setattr(
        app,
        "_default_agent_template",
        lambda: AgentTemplate(instructions="x", model="m"),
    )
    return recorded


@pytest.fixture
def patched(monkeypatch, fake_backend):
    backend = fake_backend(result=AgentResult(output="echo", usage={"total": 15}))
    recorded = _patch_handler(monkeypatch, backend)
    return backend, recorded


def _template(harness="pi_core", *, model=None, permission_default=None, skills=None):
    """Build the agent-template value from loose kwargs the tests still pass flat.

    Everything lives on the one template (at `parameters.agent`): `model`/`skills` are the
    definition; `harness`/`permission_default` are the nested execution sections
    (`harness.kind` / `runner.permissions.default`)."""
    template: dict = {"harness": {"kind": harness}}
    if model is not None:
        template["llm"] = model if isinstance(model, dict) else {"model": model}
    if skills is not None:
        template["skills"] = skills
    if permission_default is not None:
        template["runner"] = {"permissions": {"default": permission_default}}
    return template


async def _invoke(harness="pi_core", **agent):
    return await app._agent(
        request=_request(),
        messages=[{"role": "user", "content": "hi"}],
        parameters={"agent": _template(harness, **agent)},
    )


async def test_invoke_returns_assistant_message(patched):
    assert await _invoke("pi_core") == {
        "messages": [{"role": "assistant", "content": "echo"}]
    }


async def test_batch_paused_run_surfaces_pending_interaction(monkeypatch, fake_backend):
    # The realistic paused stream: the runner's `done` event carries NO stopReason (the
    # engine settles paused-vs-ended after the event stream closes, onto the terminal
    # result only), so the envelope's pause metadata must come from result.stop_reason.
    interaction = {
        "id": "perm_1",
        "kind": "user_approval",
        "payload": {
            "toolCallId": "call_1",
            "toolCall": {"toolCallId": "call_1", "name": "deleteFile"},
        },
    }
    backend = fake_backend(
        result=AgentResult(
            output="waiting",
            stop_reason="paused",
            events=[
                Event(type="message", data={"text": "waiting"}),
                Event(type="interaction_request", data=interaction),
                Event(type="done", data={}),
            ],
        )
    )
    _patch_handler(monkeypatch, backend)

    body = await _invoke("pi_core")

    assert body == {
        "messages": [{"role": "assistant", "content": "waiting"}],
        "stop_reason": "paused",
        # the raw interaction data (the wire event carries its `type` inline) + derived tool
        "pending_interaction": dict(
            interaction, type="interaction_request", tool="deleteFile"
        ),
    }


async def test_batch_completed_run_omits_pause_metadata(monkeypatch, fake_backend):
    backend = fake_backend(result=AgentResult(output="echo"))
    _patch_handler(monkeypatch, backend)

    body = await _invoke("pi_core")

    assert body == {"messages": [{"role": "assistant", "content": "echo"}]}


async def test_invoke_records_usage(patched):
    _, recorded = patched
    await _invoke("pi_core")
    assert recorded["usage"] == {"total": 15}


async def test_invoke_runs_backend_lifecycle(patched):
    backend, _ = patched
    await _invoke("pi_core")
    assert backend.setup_calls == 1
    assert backend.shutdown_calls == 1


async def test_messages_session_id_reaches_session_config(patched):
    backend, _ = patched

    await app._agent(
        request=_request(session_id="sess_request"),
        messages=[{"role": "user", "content": "hi"}],
        parameters={"agent": {"harness": {"kind": "pi_core"}}},
    )

    assert backend.created_session_ids == ["sess_request"]


async def test_invoke_cross_harness_same_body_divergent_configs(
    monkeypatch, fake_backend
):
    """The real cross-harness guarantee, exercised through the handler — not stubbed.

    The earlier version of this test pinned a single echoing backend and asserted
    ``pi == agenta == claude`` on the echoed constant. That passes no matter how badly the
    per-harness translation diverges, because the translation never ran. Here the same turn
    runs as pi / agenta / claude against a backend that records the *harness-shaped* config it
    receives, so we can assert two distinct things:

      1. the response body is byte-identical across the three harnesses (the response-layer
         guarantee), and
      2. the config that reached the backend boundary diverged exactly as designed — proving
         the handler actually drove ``PiHarness`` / ``ClaudeHarness`` / ``AgentaHarness``,
         each producing its own config.

    The turn carries a built-in tool (``web_search``), a ``deny`` policy, and one author skill
    so the divergence is observable: Claude drops Pi built-ins while all harnesses ship the
    same shared permission plan. The skill rides the neutral config, so every skill-loading
    harness emits it on its own ``wire_skills`` seam (never in the tool wire); there is no
    forced skill-name list anymore.
    """
    backend = fake_backend(result=AgentResult(output="echo", usage={"total": 15}))
    _patch_handler(monkeypatch, backend, builtins=["web_search"])

    skill = {
        "name": "release-notes",
        "description": "Draft release notes.",
        "body": "Read the changelog, then write notes.",
    }
    bodies = [
        await _invoke(harness, permission_default="deny", skills=[skill])
        for harness in ("pi_core", "pi_agenta", "claude")
    ]
    pi_body, agenta_body, claude_body = bodies

    # (1) identical body regardless of harness
    assert (
        pi_body
        == agenta_body
        == claude_body
        == {
            "messages": [
                {
                    "role": "assistant",
                    "content": "echo",
                }
            ]
        }
    )

    # (2) the three harness-shaped configs that reached the backend boundary, in call order
    assert len(backend.created_configs) == 3
    pi_cfg, agenta_cfg, claude_cfg = backend.created_configs
    pi_wire = pi_cfg.wire_tools()
    agenta_wire = agenta_cfg.wire_tools()
    claude_wire = claude_cfg.wire_tools()

    # Pi keeps its built-in tool natively; the runner relay enforces the shared plan.
    # Skills never ride the tool wire.
    assert pi_wire["tools"] == ["web_search"]
    assert pi_wire["permissions"] == {"default": "deny"}
    assert "skills" not in pi_wire

    # Claude has no Pi built-ins (the `web_search` name is dropped) and carries the same plan.
    assert claude_wire["tools"] == []
    assert claude_wire["permissions"] == {"default": "deny"}
    assert "skills" not in claude_wire

    # Agenta is Pi-with-an-opinion: it unions the forced tools onto the author's set. Skills are
    # not tools, so they never appear in the tool wire.
    assert agenta_wire["tools"] == ["web_search", "read", "bash"]
    assert agenta_wire["permissions"] == {"default": "deny"}
    assert "skills" not in agenta_wire

    # skills ride the dedicated wire_skills seam, not the tool wire
    assert pi_cfg.wire_skills()["skills"][0]["name"] == "release-notes"
    assert agenta_cfg.wire_skills()["skills"][0]["name"] == "release-notes"
    assert claude_cfg.wire_skills()["skills"][0]["name"] == "release-notes"

    # configs genuinely differ; the body's sameness is not a tautology
    assert pi_wire != claude_wire
    assert agenta_wire != pi_wire


async def test_stream_tool_resolution_failure_is_raised_before_backend_setup(
    monkeypatch,
):
    async def _failure(tools, **_kw):
        raise GatewayToolResolutionError("gateway unavailable")

    monkeypatch.setattr(app, "resolve_tools", _failure)
    monkeypatch.setattr(
        app,
        "_default_agent_template",
        lambda: AgentTemplate(
            tools=[
                {
                    "type": "gateway",
                    "integration": "github",
                    "action": "GET_USER",
                    "connection": "c1",
                }
            ]
        ),
    )
    monkeypatch.setattr(
        app,
        "select_backend",
        lambda _selection: (_ for _ in ()).throw(
            AssertionError("backend must not be selected")
        ),
    )

    with pytest.raises(GatewayToolResolutionError, match="gateway unavailable"):
        await app._agent(
            request=_request(stream=True),
            messages=[{"role": "user", "content": "hi"}],
            parameters={"agent": {"harness": {"kind": "pi_core"}}},
        )


# Slice 3: the config-stored connection drives resolution
def _patch_resolution(monkeypatch, backend, *, resolve):
    """Like ``_patch_handler`` but with a caller-supplied ``resolve_connection`` stub.

    ``resolve`` is an ``async def(*, model, context) -> ResolvedConnection`` (or one that
    raises), so a Slice 3 test controls exactly what the model's one connection resolves to and
    can inspect the ``ModelRef`` / ``RuntimeAuthContext`` it was called with.

    Returns a list that captures every ``SessionConfig`` the handler builds, so a test can
    assert the resolved connection (and its env) was threaded onto the session. ``resolved_connection``
    rides the ``SessionConfig``, not the harness-shaped config the backend records, so capturing it
    here is the honest observable.
    """
    built: list = []
    real_session_config = app.SessionConfig

    def _capturing_session_config(**kwargs):
        cfg = real_session_config(**kwargs)
        built.append(cfg)
        return cfg

    async def _tools(tools, **_kw):
        return ResolvedToolSet(builtin_names=[], tool_callback=None)

    async def _no_mcp(mcp_servers, **_kw):
        return []

    monkeypatch.setattr(app, "SessionConfig", _capturing_session_config)
    monkeypatch.setattr(app, "resolve_tools", _tools)
    monkeypatch.setattr(app, "resolve_mcp_servers", _no_mcp)
    monkeypatch.setattr(app, "resolve_connection", resolve)
    monkeypatch.setattr(app, "trace_context", lambda: None)
    monkeypatch.setattr(app, "record_usage", lambda usage: None)
    monkeypatch.setattr(app, "select_backend", lambda selection: backend)
    monkeypatch.setattr(
        app,
        "_default_agent_template",
        lambda: AgentTemplate(instructions="x", model="m"),
    )
    return built


_STRUCTURED_MODEL = {
    "provider": "openai",
    "model": "gpt-5.5",
    "connection": {"mode": "agenta", "slug": "openai-prod"},
}


async def test_named_connection_env_reaches_session(monkeypatch, fake_backend):
    """A structured ModelRef with a named connection resolves one key onto the session.

    The resolved ``env`` reaches ``SessionConfig.secrets`` (the wire's credential channel) and
    the ``ResolvedConnection`` is set on the session. The resolver is called with a ``ModelRef``
    carrying the config's connection and a ``RuntimeAuthContext`` for the run.
    """
    backend = fake_backend(result=AgentResult(output="echo", usage={"total": 1}))
    captured = {}

    async def _resolve(*, model, context):
        captured["model"] = model
        captured["context"] = context
        return ResolvedConnection(
            provider="openai",
            model="gpt-5.5",
            credential_mode="env",
            env={"OPENAI_API_KEY": "sk-x"},
        )

    built = _patch_resolution(monkeypatch, backend, resolve=_resolve)

    await _invoke("pi_core", model=_STRUCTURED_MODEL)

    # The ModelRef carried the config's named connection into the resolver.
    assert captured["model"].provider == "openai"
    assert captured["model"].model == "gpt-5.5"
    assert captured["model"].connection.mode == "agenta"
    assert captured["model"].connection.slug == "openai-prod"

    # project_id comes from request state server-side, never the client context.
    assert captured["context"].harness == "pi_core"
    assert captured["context"].project_id is None

    # the resolved key reached the backend boundary as the session's secrets
    assert backend.created_secrets == [{"OPENAI_API_KEY": "sk-x"}]
    session_cfg = built[0]
    assert session_cfg.secrets == {"OPENAI_API_KEY": "sk-x"}
    assert session_cfg.resolved_connection is not None
    assert session_cfg.resolved_connection.provider == "openai"


async def test_runtime_auth_context_harness_matches_selection(
    monkeypatch, fake_backend
):
    """The RuntimeAuthContext.harness tracks the selected harness; project_id stays None."""
    backend = fake_backend(result=AgentResult(output="echo", usage={"total": 1}))
    captured = {}

    async def _resolve(*, model, context):
        captured["context"] = context
        return ResolvedConnection(
            provider="anthropic",
            model="claude-x",
            credential_mode="env",
            env={},
        )

    _patch_resolution(monkeypatch, backend, resolve=_resolve)

    await _invoke("claude", model={"provider": "anthropic", "model": "claude-x"})

    assert captured["context"].harness == "claude"
    assert captured["context"].project_id is None


async def test_named_connection_resolution_failure_fails_loud(
    monkeypatch, fake_backend
):
    """A named connection (mode=agenta) whose slug is missing propagates, not degrades."""
    backend = fake_backend(result=AgentResult(output="echo"))

    async def _resolve(*, model, context):
        raise ConnectionNotFoundError(slug="openai-prod", provider="openai")

    _patch_resolution(monkeypatch, backend, resolve=_resolve)

    with pytest.raises(ConnectionNotFoundError):
        await _invoke("pi_core", model=_STRUCTURED_MODEL)


async def test_default_connection_resolution_failure_degrades(
    monkeypatch, fake_backend
):
    """An unconfigured default-mode run degrades gracefully: no raise, empty secrets.

    This is the common playground case (a default model on every run, no configured
    connection). A resolution failure must NOT crash the run; the harness uses its own login,
    exactly as the old whole-vault dump returned ``{}`` and the run proceeded.
    """
    backend = fake_backend(result=AgentResult(output="echo", usage={"total": 1}))

    async def _resolve(*, model, context):
        raise ConnectionResolutionError("connection resolution request failed")

    built = _patch_resolution(monkeypatch, backend, resolve=_resolve)

    body = await _invoke("pi_core", model={"provider": "openai", "model": "gpt-5.5"})

    assert body == {"messages": [{"role": "assistant", "content": "echo"}]}
    assert backend.created_secrets == [{}]
    assert built[0].secrets == {}
    assert built[0].resolved_connection.credential_mode == "runtime_provided"


async def test_default_connection_missing_provider_fails_loud(
    monkeypatch, fake_backend
):
    """F-017: a bare model id with no provider fails loud even on a default connection.

    A bare ``model`` (no ``provider/`` prefix) that matches nothing in the vault is an
    underspecified config, not a missing credential, so it must NOT degrade to no-credential
    (which surfaced later as a misleading "add your key" auth error). ``MissingProviderError``
    propagates with its actionable message.
    """
    backend = fake_backend(result=AgentResult(output="echo"))

    async def _resolve(*, model, context):
        raise MissingProviderError(model="gpt-4o-mini")

    _patch_resolution(monkeypatch, backend, resolve=_resolve)

    with pytest.raises(MissingProviderError):
        await _invoke("pi_core", model="gpt-4o-mini")


# Agent-layer capability reject (split around the vault resolve)
async def test_claude_unsupported_provider_rejected_pre_resolve(
    monkeypatch, fake_backend
):
    """Claude + a non-anthropic provider fails loud BEFORE the vault resolve runs."""
    from agenta.sdk.agents.connections import UnsupportedProviderError

    backend = fake_backend(result=AgentResult(output="echo"))

    async def _resolve(*, model, context):
        raise AssertionError(
            "vault resolve must not run on a pre-resolve provider reject"
        )

    _patch_resolution(monkeypatch, backend, resolve=_resolve)

    with pytest.raises(UnsupportedProviderError):
        await _invoke("claude", model={"provider": "openai", "model": "gpt-5.5"})


async def test_claude_bedrock_reaches_session(monkeypatch, fake_backend):
    """Claude Bedrock is allowed through so the runner can pass backend env/model to Claude."""
    backend = fake_backend(result=AgentResult(output="echo", usage={"total": 1}))

    async def _resolve(*, model, context):
        return ResolvedConnection(
            provider="anthropic",
            model="anthropic.claude-x",
            deployment="bedrock",
            credential_mode="env",
            env={"AWS_ACCESS_KEY_ID": "AKIA", "AWS_REGION": "us-east-1"},
        )

    built = _patch_resolution(monkeypatch, backend, resolve=_resolve)

    body = await _invoke(
        "claude", model={"provider": "anthropic", "model": "anthropic.claude-x"}
    )

    assert body == {"messages": [{"role": "assistant", "content": "echo"}]}
    assert built[0].resolved_connection.deployment == "bedrock"
    assert built[0].secrets == {"AWS_ACCESS_KEY_ID": "AKIA", "AWS_REGION": "us-east-1"}


async def test_pi_bedrock_rejected_post_resolve(monkeypatch, fake_backend):
    """Pi cloud consumption still stages with model-config, so it fails loud in v1."""
    from agenta.sdk.agents.connections import UnsupportedDeploymentError

    backend = fake_backend(result=AgentResult(output="echo"))

    async def _resolve(*, model, context):
        return ResolvedConnection(
            provider="anthropic",
            model="anthropic.claude-x",
            deployment="bedrock",
            credential_mode="env",
            env={"AWS_ACCESS_KEY_ID": "AKIA"},
        )

    _patch_resolution(monkeypatch, backend, resolve=_resolve)

    with pytest.raises(UnsupportedDeploymentError):
        await _invoke(
            "pi_core", model={"provider": "anthropic", "model": "anthropic.claude-x"}
        )


# Level 1: the 27-combo stream x trim x force cube, `_agent` called directly.
# `_UNSET` marks a key absent from `request.flags` (vs explicit False).

_UNSET = object()
_FLAG_VALUES = (_UNSET, False, True)

# multi-message turn so trim=true (trailing unit) is distinguishable from the full turn
_MULTI_MESSAGE_EVENTS = [
    Event(type="message", data={"text": "let me check"}),
    Event(type="tool_call", data={"id": "t1", "name": "search", "input": {"q": "x"}}),
    Event(type="tool_result", data={"id": "t1", "output": "42"}),
    Event(type="message", data={"text": "the answer is 42"}),
    Event(type="done", data={"stopReason": "stop"}),
]

_FULL_FOLDED_MESSAGES = [
    {"role": "assistant", "content": "let me check"},
    {
        "role": "tool",
        "content": "",
        "tool_call_id": "t1",
        "tool_name": "search",
        "input": {"q": "x"},
    },
    {"role": "tool", "content": "42", "tool_call_id": "t1", "is_error": None},
    {"role": "assistant", "content": "the answer is 42"},
]
_TRIMMED_MESSAGES = [_FULL_FOLDED_MESSAGES[-1]]


def _flags_dict(*, stream, trim, force):
    """The `request.flags` dict for one cube cell; `_UNSET` keys are omitted entirely."""
    flags = {}
    if stream is not _UNSET:
        flags["stream"] = stream
    if trim is not _UNSET:
        flags["trim"] = trim
    if force is not _UNSET:
        flags["force"] = force
    return flags


def _cube_request(*, stream, trim, force):
    flags = _flags_dict(stream=stream, trim=trim, force=force)
    return WorkflowServiceRequest(flags=flags or None)


@pytest.fixture
def multi_message_patched(monkeypatch, fake_backend):
    """Like `patched`, but the fake session streams a multi-message tool-run turn."""
    backend = fake_backend(
        result=AgentResult(
            output="the answer is 42",
            events=_MULTI_MESSAGE_EVENTS,
            usage={"total": 7},
        )
    )
    recorded = _patch_handler(monkeypatch, backend)
    return backend, recorded


@pytest.mark.parametrize(
    "stream,trim,force", list(product(_FLAG_VALUES, _FLAG_VALUES, _FLAG_VALUES))
)
async def test_agent_flag_cube(multi_message_patched, stream, trim, force):
    request = _cube_request(stream=stream, trim=trim, force=force)
    call = app._agent(
        request=request,
        messages=[{"role": "user", "content": "hi"}],
        parameters={"agent": _template("pi_core")},
    )

    # force=true -> 406-mapped error, regardless of other axes
    if force is True:
        with pytest.raises(ForceNotSupportedV0Error):
            await call
        return

    result = await call

    # stream=true (force not true) -> an async generator/stream of events
    if stream is True:
        assert inspect.isasyncgen(result)
        events = [event async for event in result]
        assert events, "the stream must yield at least one event"
        assert all({"type", "data"} <= event.keys() for event in events)
        return

    # else: batch dict; trim=true -> trailing unit, else full turn
    assert isinstance(result, dict)
    assert "messages" in result
    if trim is True:
        assert result["messages"] == _TRIMMED_MESSAGES
    else:
        assert result["messages"] == _FULL_FOLDED_MESSAGES
