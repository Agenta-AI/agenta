"""the unified composition seam (`agenta.sdk.agents.handler.AgentComposition` /
`make_agent_handler`) owns the five drifts that used to differ between the SDK's bare
default and the agent service's re-implementation. Each test below drives the seam
directly (no HTTP routing -- that cube is covered by
`test_invoke_real_handlers_negotiation_routing.py`) and proves the DEFAULT composition
now carries the safe behavior, and that a composition can still override it.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List, Optional

import pytest

from agenta.sdk.agents import AgentResult, HarnessKind
from agenta.sdk.agents.connections import (
    ConnectionResolutionError,
    ResolvedConnection,
    UnsupportedDeploymentError,
    UnsupportedProviderError,
)
from agenta.sdk.agents.handler import AgentComposition, make_agent_handler
from agenta.sdk.agents.interfaces import Backend, Sandbox, Session
from agenta.sdk.agents.streaming import AgentStream
from agenta.sdk.models.workflows import WorkflowServiceRequest


# --------------------------------------------------------------------------- #
# Fakes (mirrors services/oss/tests/pytest/unit/agent/conftest.py's shape)
# --------------------------------------------------------------------------- #
class _FakeSandbox(Sandbox):
    async def add_files(self, files) -> None:
        return None

    async def destroy(self) -> None:
        return None


class _FakeSession(Session):
    def __init__(self, result: AgentResult) -> None:
        self._result = result

    @property
    def id(self) -> Optional[str]:
        return self._result.session_id

    async def prompt(self, messages, *, on_event=None) -> AgentResult:
        return self._result

    def stream(self, messages) -> AgentStream:
        result = self._result

        async def _records() -> AsyncIterator[Dict[str, Any]]:
            if result.events:
                for event in result.events:
                    yield {"kind": "event", "event": {"type": event.type, **event.data}}
            elif result.output:
                yield {
                    "kind": "event",
                    "event": {"type": "message", "text": result.output},
                }
            yield {
                "kind": "result",
                "result": {
                    "ok": True,
                    "output": result.output,
                    "usage": result.usage,
                    "sessionId": result.session_id,
                },
            }

        return AgentStream(_records())

    async def destroy(self) -> None:
        return None


class _FakeBackend(Backend):
    supported_harnesses = frozenset(
        {HarnessKind.PI, HarnessKind.CLAUDE, HarnessKind.AGENTA}
    )

    def __init__(self, *, output: str = "hi") -> None:
        self._output = output
        self.created_run_contexts: List[Any] = []

    async def create_sandbox(self) -> _FakeSandbox:
        return _FakeSandbox()

    async def create_session(
        self,
        sandbox,
        config,
        *,
        harness,
        secrets=None,
        trace=None,
        run_context=None,
        session_id=None,
    ) -> _FakeSession:
        self.created_run_contexts.append(run_context)
        return _FakeSession(AgentResult(output=self._output, events=[], usage={}))


def _no_connection_result() -> ResolvedConnection:
    return ResolvedConnection(
        provider="openai", model="m", credential_mode="runtime_provided", env={}
    )


async def _no_connection(*, model, context) -> ResolvedConnection:
    return _no_connection_result()


def _request(*, meta=None) -> WorkflowServiceRequest:
    return WorkflowServiceRequest(meta=meta)


def _params(harness="pi_core", *, model=None):
    template: Dict[str, Any] = {"harness": {"kind": harness}}
    if model is not None:
        template["llm"] = model
    return {"agent": template}


# --------------------------------------------------------------------------- #
# Drift 4: run_kind from `request.meta` must reach RunContext (not silently dropped)
# --------------------------------------------------------------------------- #
async def test_run_kind_from_wire_reaches_run_context():
    backend = _FakeBackend()
    comp = AgentComposition(
        select_backend=lambda template: backend,
        resolve_connection=_no_connection,
    )
    handler = make_agent_handler(comp)

    await handler(
        request=_request(meta={"run_kind": "eval"}),
        messages=[{"role": "user", "content": "hi"}],
        parameters=_params(),
    )

    ctx = backend.created_run_contexts[0]
    assert ctx is not None
    assert ctx.to_wire() == {"run": {"kind": "eval"}}


async def test_absent_run_kind_leaves_composition_run_context_untouched():
    from agenta.sdk.agents.dtos import RunContext, RunContextTrace

    backend = _FakeBackend()
    base = RunContext(trace=RunContextTrace(trace_id="trace-1"))
    comp = AgentComposition(
        select_backend=lambda template: backend,
        resolve_connection=_no_connection,
        run_context=lambda: base,
    )
    handler = make_agent_handler(comp)

    await handler(
        request=_request(meta={}),
        messages=[{"role": "user", "content": "hi"}],
        parameters=_params(),
    )

    ctx = backend.created_run_contexts[0]
    assert ctx is base
    assert ctx.to_wire() == {"trace": {"trace_id": "trace-1"}}


# --------------------------------------------------------------------------- #
# Drift 1 + 2: capability gating and degradation policy are the SEAM DEFAULT now
# (previously a bare fallback in handler.py with neither).
# --------------------------------------------------------------------------- #
async def test_default_composition_rejects_unsupported_provider_pre_resolve():
    """Claude + a non-anthropic provider must fail loud even with NO composition override."""
    backend = _FakeBackend()

    async def _must_not_run(*, model, context):
        raise AssertionError("vault resolve must not run on a pre-resolve reject")

    comp = AgentComposition(
        select_backend=lambda template: backend,
        resolve_connection=_must_not_run,
    )
    handler = make_agent_handler(comp)

    with pytest.raises(UnsupportedProviderError):
        await handler(
            request=_request(),
            messages=[{"role": "user", "content": "hi"}],
            parameters=_params(
                "claude", model={"provider": "openai", "model": "gpt-5.5"}
            ),
        )


async def test_default_composition_rejects_unconsumable_deployment_post_resolve():
    """Pi resolving to bedrock must fail loud even with NO composition override."""
    backend = _FakeBackend()

    async def _resolve(*, model, context):
        return ResolvedConnection(
            provider="anthropic",
            model="anthropic.claude-x",
            deployment="bedrock",
            credential_mode="env",
            env={"AWS_ACCESS_KEY_ID": "AKIA"},
        )

    comp = AgentComposition(
        select_backend=lambda template: backend,
        resolve_connection=_resolve,
    )
    handler = make_agent_handler(comp)

    with pytest.raises(UnsupportedDeploymentError):
        await handler(
            request=_request(),
            messages=[{"role": "user", "content": "hi"}],
            parameters=_params(
                "pi_core",
                model={"provider": "anthropic", "model": "anthropic.claude-x"},
            ),
        )


async def test_default_composition_degrades_default_connection_failure():
    """An unconfigured default-mode connection degrades to runtime_provided, no raise --
    even with NO composition override (the SDK default now has the degradation policy
    the old bare fallback lacked)."""
    backend = _FakeBackend(output="echo")

    async def _resolve(*, model, context):
        raise ConnectionResolutionError("network unreachable")

    comp = AgentComposition(
        select_backend=lambda template: backend,
        resolve_connection=_resolve,
    )
    handler = make_agent_handler(comp)

    result = await handler(
        request=_request(),
        messages=[{"role": "user", "content": "hi"}],
        parameters=_params("pi_core", model={"provider": "openai", "model": "gpt-5.5"}),
    )

    assert result == {"messages": [{"role": "assistant", "content": "echo"}]}


async def test_composition_override_replaces_default_gating():
    """A composition MAY still fully replace resolve_session_connection (bare passthrough),
    proving the seam stays injectable rather than hardcoding the gate."""
    backend = _FakeBackend()
    calls = []

    async def _bare(model_ref, context):
        calls.append((model_ref, context))
        return _no_connection_result()

    comp = AgentComposition(
        select_backend=lambda template: backend,
        resolve_session_connection=_bare,
    )
    handler = make_agent_handler(comp)

    # Claude + openai would be rejected by the default gate; the override bypasses it.
    await handler(
        request=_request(),
        messages=[{"role": "user", "content": "hi"}],
        parameters=_params("claude", model={"provider": "openai", "model": "gpt-5.5"}),
    )

    assert len(calls) == 1


# --------------------------------------------------------------------------- #
# Drift 5: backend/template defaults are per-composition (deployment-specific),
# proving the seam is request/composition-aware rather than hardcoding one source.
# --------------------------------------------------------------------------- #
async def test_composition_default_template_overrides_bare_sdk_default():
    from agenta.sdk.agents.dtos import AgentTemplate

    backend = _FakeBackend(output="echo")
    seen_templates = []

    def _select_backend(template):
        seen_templates.append(template)
        return backend

    comp = AgentComposition(
        default_template=lambda: AgentTemplate(
            instructions="deployment-specific", model="openai/gpt-5.5"
        ),
        select_backend=_select_backend,
        resolve_connection=_no_connection,
    )
    handler = make_agent_handler(comp)

    await handler(
        request=_request(),
        messages=[{"role": "user", "content": "hi"}],
        parameters=None,
    )

    assert seen_templates[0].instructions == "deployment-specific"
    assert seen_templates[0].model == "openai/gpt-5.5"


async def test_composition_select_backend_is_deployment_specific():
    """`select_backend` is a per-composition field; two compositions can pick different
    backends for the identical template, proving the seam does not hardcode one source."""
    backend_a = _FakeBackend(output="a")
    backend_b = _FakeBackend(output="b")

    comp_a = AgentComposition(
        select_backend=lambda template: backend_a, resolve_connection=_no_connection
    )
    comp_b = AgentComposition(
        select_backend=lambda template: backend_b, resolve_connection=_no_connection
    )

    result_a = await make_agent_handler(comp_a)(
        request=_request(),
        messages=[{"role": "user", "content": "hi"}],
        parameters=_params(),
    )
    result_b = await make_agent_handler(comp_b)(
        request=_request(),
        messages=[{"role": "user", "content": "hi"}],
        parameters=_params(),
    )

    assert result_a["messages"][0]["content"] == "a"
    assert result_b["messages"][0]["content"] == "b"


# --------------------------------------------------------------------------- #
# Local-sandbox gate is the bare SDK default too (a composition-free `agent_v0` gets
# this protocol-level safety behavior for free, same as capability/MCP gating above).
# --------------------------------------------------------------------------- #
async def test_default_select_backend_refuses_local_sandbox_when_not_enabled(
    monkeypatch,
):
    from agenta.sdk.agents import LocalSandboxNotAllowedError
    from agenta.sdk.agents.dtos import AgentTemplate

    monkeypatch.setenv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "daytona")
    comp = AgentComposition(resolve_connection=_no_connection)
    handler = make_agent_handler(comp)

    with pytest.raises(LocalSandboxNotAllowedError):
        await handler(
            request=_request(),
            messages=[{"role": "user", "content": "hi"}],
            parameters={
                "agent": {"harness": {"kind": "pi_core"}, "sandbox": {"kind": "local"}}
            },
        )

    # sanity: the template really did carry "local" through to select_backend's input.
    assert AgentTemplate(sandbox="local").sandbox == "local"


async def test_default_select_backend_allows_local_sandbox_by_default(monkeypatch):
    from agenta.sdk.agents.errors import AgentRunnerConfigurationError

    monkeypatch.delenv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", raising=False)
    monkeypatch.delenv("AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER", raising=False)
    comp = AgentComposition(resolve_connection=_no_connection)
    handler = make_agent_handler(comp)

    # Past the gate, it hits the real SandboxAgentBackend construction, which fails on
    # missing runner assets in this sandboxed test env -- proving the gate itself passed.
    with pytest.raises(AgentRunnerConfigurationError):
        await handler(
            request=_request(),
            messages=[{"role": "user", "content": "hi"}],
            parameters={
                "agent": {"harness": {"kind": "pi_core"}, "sandbox": {"kind": "local"}}
            },
        )


async def test_default_select_backend_allows_daytona_sandbox_with_custom_backend(
    monkeypatch,
):
    monkeypatch.delenv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", raising=False)
    monkeypatch.delenv("AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER", raising=False)
    backend = _FakeBackend()
    comp = AgentComposition(
        select_backend=lambda template: backend,
        resolve_connection=_no_connection,
    )
    handler = make_agent_handler(comp)

    result = await handler(
        request=_request(),
        messages=[{"role": "user", "content": "hi"}],
        parameters={
            "agent": {"harness": {"kind": "pi_core"}, "sandbox": {"kind": "daytona"}}
        },
    )
    assert isinstance(result, dict)


# --------------------------------------------------------------------------- #
# SVC-1: the backend gate must fire BEFORE the expensive resolves
# --------------------------------------------------------------------------- #
async def test_backend_gate_fires_before_tool_mcp_and_vault_resolution():
    """A rejected run must not first pay for tools, MCP servers, and the vault round trip.

    `select_backend` carries the local-sandbox gate. It used to run AFTER resolve_tools /
    resolve_mcp_servers / resolve_connection, so a doomed request did all that work first.
    """
    ran: List[str] = []

    async def _spy_tools(tools, **kwargs):
        ran.append("tools")
        raise AssertionError("resolve_tools ran despite a rejected backend")

    async def _spy_mcp(servers, **kwargs):
        ran.append("mcp")
        raise AssertionError("resolve_mcp_servers ran despite a rejected backend")

    async def _spy_connection(*, model, context):
        ran.append("connection")
        raise AssertionError("resolve_connection ran despite a rejected backend")

    def _rejecting_backend(template):
        raise RuntimeError("sandbox 'local' is not allowed")

    comp = AgentComposition(
        select_backend=_rejecting_backend,
        resolve_tools=_spy_tools,
        resolve_mcp_servers=_spy_mcp,
        resolve_connection=_spy_connection,
    )
    handler = make_agent_handler(comp)

    with pytest.raises(RuntimeError, match="not allowed"):
        await handler(
            request=_request(),
            messages=[{"role": "user", "content": "hi"}],
            parameters=_params(model="openai/gpt-5.5"),
        )

    assert ran == []


if __name__ == "__main__":
    pytest.main([__file__, "-q"])
