"""``agent_v0``: the canonical agent handler, composition-injectable (specs.md `agent_v0`).

Owns stream/trim/force; composition (template, tool/MCP/connection resolvers, backend
selector) is injectable via `AgentComposition`, defaulting to env-driven SDK behavior. The
default composition also owns capability gating, degradation policy, and MCP gating:
these are protocol-level safety behaviors, not service-specific, so a bare `agent_v0` (no
composition override) gets them for free instead of a permissive fallback.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

from agenta.sdk.agents.dtos import AgentTemplate, SessionConfig, to_messages
from agenta.sdk.agents.interfaces import Backend, Environment
from agenta.sdk.agents.capabilities import (
    harness_allows_deployment,
    harness_allows_mode,
    harness_allows_provider,
)
from agenta.sdk.agents.connections import (
    ConnectionResolutionError,
    MissingProviderError,
    ModelRef,
    ResolvedConnection,
    RuntimeAuthContext,
    UnsupportedConnectionModeError,
    UnsupportedDeploymentError,
    UnsupportedProviderError,
)
from agenta.sdk.agents.tools import ResolvedToolSet
from agenta.sdk.agents.adapters import SandboxAgentBackend, make_harness
from agenta.sdk.agents.mcp import MCPDisabledError, ResolvedMCPServer
from agenta.sdk.agents.mcp.parsing import parse_mcp_server_configs
from agenta.sdk.agents.platform import (
    resolve_connection as _platform_resolve_connection,
)
from agenta.sdk.agents.platform import resolve_mcp as _platform_resolve_mcp
from agenta.sdk.agents.platform import resolve_tools as _platform_resolve_tools

from agenta.sdk.agents.fold import fold, trim_to_trailing_unit
from agenta.sdk.agents.tracing import (
    record_usage as ambient_record_usage,
    run_context as ambient_run_context,
    trace_context as ambient_trace_context,
)
from agenta.sdk.agents.dtos import RunContext, RunContextRun

from agenta.sdk.engines.running.errors import ForceNotSupportedV0Error
from agenta.sdk.models.workflows import (
    WorkflowInvokeRequestFlags,
    WorkflowServiceRequest,
)
from agenta.sdk.utils.constants import TRUTHY
from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)

ResolveToolsFn = Callable[..., Awaitable[ResolvedToolSet]]
ResolveMCPFn = Callable[..., Awaitable[List[ResolvedMCPServer]]]
ResolveConnectionFn = Callable[..., Awaitable[ResolvedConnection]]
ResolveSessionConnectionFn = Callable[
    [ModelRef, RuntimeAuthContext], Awaitable[ResolvedConnection]
]
DefaultTemplateFn = Callable[[], AgentTemplate]
SelectBackendFn = Callable[[AgentTemplate], Backend]
TraceContextFn = Callable[[], Any]
RunContextFn = Callable[[], Any]
RecordUsageFn = Callable[[Optional[Dict[str, Any]]], None]


def _default_template() -> AgentTemplate:
    return AgentTemplate()


def _default_select_backend(agent_template: AgentTemplate) -> Backend:
    """Env-driven default: `AGENTA_RUNNER_INTERNAL_URL` picks HTTP transport; else local cwd."""
    url = os.getenv("AGENTA_RUNNER_INTERNAL_URL", "").strip() or None
    return SandboxAgentBackend(sandbox=agent_template.sandbox, url=url, cwd=os.getcwd())


async def _default_resolve_tools(tools, **kwargs) -> ResolvedToolSet:
    return await _platform_resolve_tools(tools, **kwargs)


def _mcp_enabled() -> bool:
    # MCP gating: off by default, deployment opts in via AGENTA_AGENT_MCPS_ENABLED.
    return os.getenv("AGENTA_AGENT_MCPS_ENABLED", "").strip().lower() in TRUTHY


async def _default_resolve_mcp_servers(
    mcp_servers, **kwargs
) -> List[ResolvedMCPServer]:
    """Resolve MCP servers, gated by ``AGENTA_AGENT_MCPS_ENABLED`` (off by default).

    Disabled + no servers declared -> ``[]`` (the common case, unchanged). Disabled + servers
    declared -> :class:`MCPDisabledError`, so a caller's ignored MCP config fails loud instead
    of silently running with none.
    """
    if not _mcp_enabled():
        if not mcp_servers:
            return []
        names = [config.name for config in parse_mcp_server_configs(mcp_servers)]
        raise MCPDisabledError(server_names=names)
    return await _platform_resolve_mcp(mcp_servers, **kwargs)


async def _default_resolve_connection(*, model, context) -> ResolvedConnection:
    return await _platform_resolve_connection(model=model, context=context)


def _check_harness_pre_resolve(model_ref: ModelRef, harness: Optional[str]) -> None:
    """The PRE-resolve half of the agent-layer capability check (design Concern 3b).

    The provider and connection mode are known from the config alone, so reject them before the
    vault resolve runs. The vault resolve itself is harness-agnostic; this guard (and the
    post-resolve deployment guard) is the only place the harness gates a credential, and it runs
    server-side so a direct API caller is checked too. An unset harness skips the check.
    """
    if not harness:
        return
    provider = model_ref.provider
    if provider and not harness_allows_provider(harness, provider):
        raise UnsupportedProviderError(provider=provider, harness=harness)
    mode = model_ref.connection.mode
    if not harness_allows_mode(harness, mode):
        raise UnsupportedConnectionModeError(mode=mode, harness=harness)


def _check_harness_post_resolve(
    resolved: ResolvedConnection, harness: Optional[str]
) -> None:
    """The POST-resolve half of the capability check: reject an unconsumable deployment.

    A slug-less ``agenta`` connection only reveals its deployment once the vault selects the
    secret, so the deployment reject runs after the resolve returns.
    """
    if not harness:
        return
    if not harness_allows_deployment(harness, resolved.deployment):
        raise UnsupportedDeploymentError(
            deployment=resolved.deployment, harness=harness
        )


async def _default_resolve_session_connection(
    model_ref: ModelRef,
    context: RuntimeAuthContext,
    *,
    resolve_connection: ResolveConnectionFn = _default_resolve_connection,
) -> ResolvedConnection:
    """Resolve one least-privilege connection for the run, with graceful degradation.

    Provider + mode are rejected BEFORE the vault resolve (known from the config), the resolved
    deployment is rejected AFTER (only known once the vault picks the secret).

    An EXPLICIT named ``agenta`` connection (``slug`` set) fails loud on a resolution failure: the
    user named a connection, so a missing/ambiguous one is a real error they must fix.

    A project-default connection (``agenta`` with no slug) or a ``self_managed`` connection is
    TOLERANT of a resolution failure: most projects have no configured connection for the default
    model and rely on the harness's own login / a self-managed sidecar, so a failed resolve
    (including a network/HTTP error) degrades to an empty ``runtime_provided`` plan and the run
    still works. A capability reject is NEVER tolerated — it is a misconfiguration the user must
    fix, not a missing credential.
    """
    _check_harness_pre_resolve(model_ref, context.harness)

    connection = model_ref.connection
    is_named = connection.mode == "agenta" and bool(
        connection.slug and connection.slug.strip()
    )
    if is_named:
        resolved = await resolve_connection(model=model_ref, context=context)
        _check_harness_post_resolve(resolved, context.harness)
        return resolved
    try:
        resolved = await resolve_connection(model=model_ref, context=context)
    except MissingProviderError:
        # A bare model id with no provider is an underspecified config, not a missing
        # credential, so it fails loud even on a default connection.
        raise
    except ConnectionResolutionError:
        log.warning(
            "agent: no connection resolved for provider %r (mode=%s); "
            "running with no injected credential (harness login / self-managed)",
            model_ref.provider,
            connection.mode,
        )
        return ResolvedConnection(
            provider=model_ref.provider or "",
            model=model_ref.model,
            credential_mode="runtime_provided",
            env={},
        )
    _check_harness_post_resolve(resolved, context.harness)
    return resolved


@dataclass
class AgentComposition:
    """Injectable composition seam; every field defaults to env/ambient-driven SDK behavior.

    The tracing-shaped fields (``trace_context`` / ``run_context`` / ``record_usage``) default
    to the ambient runtime captures in ``agents/tracing.py``: they read SDK-owned per-request
    state (the active span, the ``TracingContext`` ContextVar) at CALL time and degrade to
    ``None``/no-op when a run has no such state, so a bare ``agent_v0`` behaves correctly in
    any process without composition.

    ``resolve_session_connection`` / ``resolve_mcp_servers`` default to the SAFE behavior
    (capability-gated + degrading connection resolve; MCP-gated server resolve) rather than
    a bare fallback, so a composition-free ``agent_v0`` is not the permissive copy."""

    default_template: DefaultTemplateFn = field(default=_default_template)
    resolve_tools: ResolveToolsFn = field(default=_default_resolve_tools)
    resolve_mcp_servers: ResolveMCPFn = field(default=_default_resolve_mcp_servers)
    resolve_connection: ResolveConnectionFn = field(default=_default_resolve_connection)
    # capability gating + degradation policy; override to replace, not just add to.
    resolve_session_connection: Optional[ResolveSessionConnectionFn] = field(
        default=None
    )
    select_backend: SelectBackendFn = field(default=_default_select_backend)
    trace_context: TraceContextFn = field(default=ambient_trace_context)
    run_context: RunContextFn = field(default=ambient_run_context)
    record_usage: RecordUsageFn = field(default=ambient_record_usage)


def _agent_model_ref(agent_template: AgentTemplate) -> Optional[ModelRef]:
    if agent_template.model_ref is not None:
        return agent_template.model_ref
    if isinstance(agent_template.model, str) and agent_template.model.strip():
        return ModelRef.coerce(agent_template.model)
    return None


def make_agent_handler(composition: Optional[AgentComposition] = None):
    """Build the `agent_v0`-shaped handler bound to `composition` (defaults if omitted)."""

    comp = composition or AgentComposition()

    async def _agent(
        request: WorkflowServiceRequest,
        inputs: Optional[Dict[str, Any]] = None,
        messages: Optional[List[Any]] = None,
        parameters: Optional[Dict] = None,
    ):
        flags = WorkflowInvokeRequestFlags(**(request.flags or {}))
        if flags.force:
            raise ForceNotSupportedV0Error()
        stream = flags.stream
        session_id = request.session_id

        params = parameters or {}
        agent_template = AgentTemplate.from_params(
            params, defaults=comp.default_template()
        )

        msgs = to_messages(messages or (inputs or {}).get("messages") or [])
        resolved_tools = await comp.resolve_tools(agent_template.tools)
        resolved_mcp = await comp.resolve_mcp_servers(agent_template.mcp_servers)

        model_ref = _agent_model_ref(agent_template)
        resolved_connection: Optional[ResolvedConnection] = None
        secrets: Dict[str, str] = {}
        if model_ref is not None:
            ctx = RuntimeAuthContext(
                harness=agent_template.harness, backend=agent_template.sandbox
            )
            # Default is the gated+degrading resolve, bound to comp.resolve_connection
            # so an override of the plain resolver still flows through the capability check.
            resolve_session_connection = comp.resolve_session_connection or (
                lambda m, c: _default_resolve_session_connection(
                    m, c, resolve_connection=comp.resolve_connection
                )
            )
            resolved_connection = await resolve_session_connection(model_ref, ctx)
            secrets = resolved_connection.env

        # run_kind rides the wire on `request.meta`: a wire-supplied run_kind must not
        # be silently dropped, so it layers onto whatever run_context composition supplies.
        # Copy before setting so a shared/cached RunContext can't leak run_kind across requests.
        rc = comp.run_context()
        run_kind = (request.meta or {}).get("run_kind")
        if isinstance(run_kind, str) and run_kind:
            base = rc or RunContext()
            rc = base.model_copy(update={"run": RunContextRun(kind=run_kind)})

        session_config = SessionConfig(
            agent=agent_template,
            secrets=secrets,
            resolved_connection=resolved_connection,
            permission_default=agent_template.permission_default,
            trace=comp.trace_context(),
            run_context=rc,
            session_id=session_id,
            builtin_names=resolved_tools.builtin_names,
            tool_specs=resolved_tools.tool_specs,
            tool_callback=resolved_tools.tool_callback,
            mcp_servers=resolved_mcp,
        )

        harness = make_harness(
            agent_template.harness, Environment(comp.select_backend(agent_template))
        )

        if stream:
            return agent_event_stream(
                harness, session_config, msgs, record_usage=comp.record_usage
            )
        return await agent_batch(
            harness,
            session_config,
            msgs,
            trim=flags.trim,
            record_usage=comp.record_usage,
        )

    return _agent


async def agent_event_stream(
    harness, session_config, msgs, *, record_usage: RecordUsageFn = ambient_record_usage
):
    """Run one streaming turn, yielding the live `{type, data}` agenta event wire."""
    await harness.setup()
    run = await harness.stream(session_config, msgs)
    try:
        event_stop_reason: Optional[str] = None
        async for event in run:
            if event.type == "done":
                event_stop_reason = (event.data or {}).get("stopReason")
            yield {"type": event.type, "data": event.data}
        # The terminal result's stop_reason is authoritative: the runner's `done` event carries
        # no stopReason for a HITL pause (the engine settles paused-vs-ended after the event
        # stream closes, onto the terminal result only). When it disagrees with the streamed
        # `done`, append a corrective terminal `done` so the egress finish frame can prefer it —
        # the streaming analogue of agent_batch's `fold(events, stop_reason=result.stop_reason)`.
        try:
            terminal_stop_reason = run.result().stop_reason
        except Exception:  # result unavailable on a failed/aborted stream
            terminal_stop_reason = None
        if (
            terminal_stop_reason is not None
            and terminal_stop_reason != event_stop_reason
        ):
            yield {"type": "done", "data": {"stopReason": terminal_stop_reason}}
    finally:
        try:
            record_usage(run.result().usage)
        except Exception:  # result unavailable on a failed/aborted stream
            pass
        await harness.cleanup()


async def agent_batch(
    harness,
    session_config,
    msgs,
    *,
    trim: Optional[bool] = None,
    record_usage: RecordUsageFn = ambient_record_usage,
) -> Dict[str, Any]:
    """Drain the same stream, fold it into the real turn, trim when asked."""
    await harness.setup()
    events: List[Dict[str, Any]] = []
    try:
        run = await harness.stream(session_config, msgs)
        async for event in run:
            events.append({"type": event.type, "data": event.data})
        result = run.result()
    finally:
        await harness.cleanup()
    record_usage(result.usage)

    # The terminal result's stop_reason is authoritative: the runner's `done` event carries
    # no stopReason (the engine settles paused-vs-ended after the event stream closes).
    folded = fold(events, stop_reason=result.stop_reason)
    out_messages = folded["messages"]
    if trim:
        out_messages = trim_to_trailing_unit(out_messages)

    output: Dict[str, Any] = {"messages": out_messages}
    if folded.get("stop_reason") is not None:
        output["stop_reason"] = folded["stop_reason"]
    if folded.get("pending_interaction") is not None:
        output["pending_interaction"] = folded["pending_interaction"]
    return output


agent_v0 = make_agent_handler()
