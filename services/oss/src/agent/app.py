"""Agent workflow app: the ``/invoke`` handler, wired onto the SDK agent runtime.

Mirrors the chat/completion services: an Agenta app exposing ``/invoke`` and ``/inspect``
through ``ag.create_app`` + ``ag.workflow`` + ``ag.route``. The handler parses the request
into a neutral ``AgentConfig`` + ``RunSelection`` (``agenta.sdk.agents``), resolves tools
(``tools``) and one least-privilege model connection (``resolve_connection``) server-side,
threads the trace context (``tracing``), then runs one turn through a :class:`Harness` over a
backend it picks from the selection, and records the run's usage.

The sandbox-agent-backed backend is the production path. The transport is a deployment
choice: HTTP to `AGENTA_AGENT_RUNNER_URL`, or a local runner CLI in a source checkout.
The harness, sandbox, and permission policy are editable playground config.
"""

from typing import Any, Dict, List, Optional

import agenta as ag

from agenta.sdk.agents import (
    AgentConfig,
    Backend,
    ConnectionResolutionError,
    Environment,
    ModelRef,
    ResolvedConnection,
    RuntimeAuthContext,
    SandboxAgentBackend,
    RunSelection,
    SessionConfig,
    make_harness,
    to_messages,
)
from agenta.sdk.agents.adapters.vercel import agent_run_to_vercel_parts

from agenta.sdk.agents.capabilities import (
    harness_allows_deployment,
    harness_allows_mode,
    harness_allows_provider,
    harness_capabilities_document,
)
from agenta.sdk.agents.connections import (
    UnsupportedConnectionModeError,
    UnsupportedDeploymentError,
    UnsupportedProviderError,
)

from agenta.sdk.agents.platform import resolve_connection

from agenta.sdk.decorators.tracing import auto_instrument
from agenta.sdk.engines.running.utils import (
    register_handler,
    register_interface,
    register_meta,
)
from agenta.sdk.models.workflows import WorkflowRevisionData

from agenta.sdk.utils.logging import get_module_logger

from oss.src.agent.config import load_config, runner_dir, runner_url
from oss.src.agent.schemas import AGENT_SCHEMAS
from oss.src.agent.tools import resolve_mcp_servers, resolve_tools
from oss.src.agent.tracing import record_usage, trace_context

log = get_module_logger(__name__)


def _default_agent_config() -> AgentConfig:
    """The service's file defaults (AGENTS.md, model, tools) as a neutral AgentConfig."""
    file_cfg = load_config()
    return AgentConfig(
        instructions=file_cfg.agents_md,
        model=file_cfg.model,
        tools=file_cfg.tools,
    )


def _agent_model_ref(agent_config: AgentConfig) -> Optional[ModelRef]:
    """The structured model ref for the run, or ``None`` when no model is configured.

    Prefer the parsed ``model_ref`` (populated only when the config's ``model`` arrived as a
    dict/object carrying a connection); otherwise coerce the back-compat plain ``model`` string.
    ``None`` means no model at all, in which case the harness uses its own default/login and no
    connection is resolved.
    """
    if agent_config.model_ref is not None:
        return agent_config.model_ref
    if isinstance(agent_config.model, str) and agent_config.model.strip():
        return ModelRef.coerce(agent_config.model)
    return None


def _check_harness_pre_resolve(model_ref: ModelRef, harness: Optional[str]) -> None:
    """The PRE-resolve half of the agent-layer capability check (design Concern 3b).

    The provider and connection mode are known from the config alone, so reject them before the
    vault resolve runs. The vault resolve itself is harness-agnostic; this guard (and the
    post-resolve deployment guard) is the only place the harness gates a credential, and it is
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
    secret, so the deployment reject runs after the resolve returns (e.g. Claude resolving to
    ``bedrock`` fails loud here; a Pi run resolving to a cloud deployment fails loud the same
    way, since Pi cloud consumption stages with model-config in v1).
    """
    if not harness:
        return
    if not harness_allows_deployment(harness, resolved.deployment):
        raise UnsupportedDeploymentError(
            deployment=resolved.deployment, harness=harness
        )


async def _resolve_session_connection(
    model_ref: ModelRef,
    context: RuntimeAuthContext,
) -> ResolvedConnection:
    """Resolve exactly one least-privilege connection for the run, with graceful degradation.

    The agent-layer capability check is split around the vault resolve: provider + mode are
    rejected BEFORE the resolve (known from the config), the resolved deployment is rejected
    AFTER (only known once the vault picks the secret). Both run here, against the SDK capability
    table; the vault resolve stays harness-agnostic.

    An EXPLICIT named ``agenta`` connection (``slug`` set) fails loud on a resolution failure: the
    user named a connection, so a missing/ambiguous one is a real error they must fix.

    A project-default connection (``agenta`` with no slug, the common unconfigured case the
    playground hits on every run) or a ``self_managed`` connection is TOLERANT of a resolution
    failure: most projects have no configured connection for the default model and rely on the
    harness's own login / a self-managed sidecar. There a failed resolve (including a network/HTTP
    error) degrades to an empty ``runtime_provided`` plan so the run still works, exactly as the
    old whole-vault dump returned ``{}`` and the run proceeded. (A capability reject is NOT
    tolerated — it is a misconfiguration the user must fix, not a missing credential.)

    The tolerant default is intentional: the model-config staged rollout says NOT to flip
    strict-fail on by default. When model-config lands its ``AGENTA_AGENT_MODEL_STRICT`` flag, a
    default-connection resolution failure becomes fail-loud too; that flag is owned by
    model-config, so no flag is added here.
    """
    # PRE-resolve capability reject (fail loud regardless of mode; not a missing-credential case).
    _check_harness_pre_resolve(model_ref, context.harness)

    connection = model_ref.connection
    is_named = connection.mode == "agenta" and bool(
        connection.slug and connection.slug.strip()
    )
    if is_named:
        # Named connection: propagate ConnectionNotFoundError / AmbiguousConnectionError / any
        # ConnectionResolutionError so the user sees the misconfiguration.
        resolved = await resolve_connection(model=model_ref, context=context)
        _check_harness_post_resolve(resolved, context.harness)
        return resolved
    try:
        resolved = await resolve_connection(model=model_ref, context=context)
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


def select_backend(selection: RunSelection) -> Backend:
    """Pick the backend for a run.

    The service always uses the sandbox-agent-backed runner. `AGENTA_AGENT_RUNNER_URL`
    selects HTTP transport in deployed containers. When it is unset, local development
    spawns the TypeScript runner CLI from the runner dir.
    """
    return SandboxAgentBackend(
        sandbox=selection.sandbox,
        url=runner_url(),
        cwd=str(runner_dir()),
    )


async def _agent(
    inputs: Optional[Dict[str, Any]] = None,
    messages: Optional[List[Any]] = None,
    parameters: Optional[Dict] = None,
    stream: Optional[bool] = None,
    session_id: Optional[str] = None,
):
    params = parameters or {}

    agent_config = AgentConfig.from_params(params, defaults=_default_agent_config())
    selection = RunSelection.from_params(params)

    msgs = to_messages(messages or (inputs or {}).get("messages") or [])
    # Three independent resolutions (tools, MCP, the model's one connection), not one aggregate:
    # the boundary resolves; the backend later decides how each tool executes.
    resolved_tools = await resolve_tools(agent_config.tools)
    resolved_mcp = await resolve_mcp_servers(agent_config.mcp_servers)

    # One least-privilege connection for the configured model. The connection rides the config
    # (inside `parameters`/`agent.model`); there is no new request field and no project id from
    # the body. project_id is filled server-side from the caller's auth on the resolve call, so
    # the client-side context leaves it None.
    model_ref = _agent_model_ref(agent_config)
    resolved_connection: Optional[ResolvedConnection] = None
    secrets: Dict[str, str] = {}
    if model_ref is not None:
        ctx = RuntimeAuthContext(harness=selection.harness, backend=selection.sandbox)
        resolved_connection = await _resolve_session_connection(model_ref, ctx)
        secrets = resolved_connection.env

    session_config = SessionConfig(
        agent=agent_config,
        secrets=secrets,  # the env compat alias the wire still reads
        resolved_connection=resolved_connection,
        permission_policy=selection.permission_policy,
        trace=trace_context(),
        session_id=session_id,
        builtin_names=resolved_tools.builtin_names,
        tool_specs=resolved_tools.tool_specs,
        tool_callback=resolved_tools.tool_callback,
        mcp_servers=resolved_mcp,
    )

    # The harness validates that the chosen backend can drive it. An unknown harness value fails
    # here instead of silently changing runtime behavior. The sandbox-agent backend supports all
    # three harnesses (pi_core, pi_agenta, claude). setup/cleanup own the backend lifecycle;
    # prompt/stream run one cold turn.
    harness = make_harness(selection.harness, Environment(select_backend(selection)))

    # Both paths hand off to a helper that owns the environment lifecycle (setup/cleanup).
    # They differ only in shape, as they must: the `/messages` SSE path (`stream` set) returns
    # the Vercel UI Message Stream as an async generator the normalizer turns into a streaming
    # response; `/invoke` and the `/messages` JSON path return the batch assistant message.
    if stream:
        return _agent_vercel_stream(harness, session_config, msgs)
    return await _agent_batch(harness, session_config, msgs)


async def _agent_batch(harness, session_config, msgs):
    """Run one batch turn and return the assistant message. Owns the environment lifecycle."""
    await harness.setup()
    try:
        result = await harness.prompt(session_config, msgs)
    finally:
        await harness.cleanup()
    record_usage(result.usage)
    return {"role": "assistant", "content": result.output}


async def _agent_vercel_stream(harness, session_config, msgs):
    """Run one streaming turn and yield Vercel UI Message Stream parts.

    Owns the environment lifecycle (``setup`` / ``cleanup``); the per-turn session is torn
    down by the ``AgentRun``'s own cleanup hook when the stream drains. The ``session_id`` is
    stamped onto the stream's ``start`` part by the endpoint, so it is not threaded here.
    """
    await harness.setup()
    try:
        run = await harness.stream(session_config, msgs)
        async for part in agent_run_to_vercel_parts(run):
            yield part
        try:
            record_usage(run.result().usage)
        except Exception:  # result unavailable on a failed/aborted stream
            pass
    finally:
        await harness.cleanup()


AGENT_URI = "agenta:builtin:agent:v0"


def create_agent_app():
    app = ag.create_app()
    # Bind the live `_agent` handler to the builtin URI `agenta:builtin:agent:v0` (issue 2: one
    # canonical identity for the agent workflow). The SDK seeds the registries for this URI with a
    # minimal default interface; the service is the authoritative live owner in its own process, so:
    #
    # 1. Instrument `_agent`, then register THAT under the builtin URI. Order matters: `ag.workflow`
    #    only instruments inside `_register_handler`, which it skips once a handler exists in the
    #    registry. Registering the raw `_agent` would lose tracing instrumentation; registering the
    #    instrumented one keeps it (mirrors chat.py, whose registry handler is pre-instrumented).
    # 2. OVERRIDE the interface registry with the service interface (AGENT_SCHEMAS), so
    #    `retrieve_interface(AGENT_URI)` returns the SAME schemas `/inspect` advertises.
    #    `register_interface` replaces (not setdefault), unlike the SDK's minimal seed. It carries
    #    only `WorkflowRevisionData` (schemas), which has no `meta` field — so the inspect `meta`
    #    goes through `register_meta` (step 3), not here.
    # 3. Register the inspect `meta` for the URI. The request-driven `/inspect` path builds a fresh
    #    workflow from the request (which has no `meta`), so the routed instance's `meta=` below
    #    would not survive; the meta registry is what `workflow.inspect()` reads to emit it.
    # 4. Build the workflow against the URI. `ag.workflow.__init__` resolves the (instrumented)
    #    handler and merges the registered interface; the passed `schemas`/`meta` still win.
    #
    # The per-harness connection capability rides the inspect response `meta`, NOT a fourth
    # `AGENT_SCHEMAS` schema key (`JsonSchemas` allows only inputs/parameters/outputs). The frontend
    # reads `meta.harness_capabilities` and intersects it with the existing `/secrets/` payload
    # projected as connections; the agent service imports the SAME SDK table (above) for its
    # server-side reject, never calling its own `/inspect`.
    meta = {"harness_capabilities": harness_capabilities_document()}
    register_handler(auto_instrument(_agent), uri=AGENT_URI)
    register_interface(
        WorkflowRevisionData(uri=AGENT_URI, schemas=AGENT_SCHEMAS),
        uri=AGENT_URI,
    )
    register_meta(meta, uri=AGENT_URI)
    routed = ag.workflow(uri=AGENT_URI, schemas=AGENT_SCHEMAS, meta=meta)(_agent)
    # is_agent gates the agent-only `/messages` route (next to /invoke).
    ag.route("/", app=app, flags={"is_chat": True, "is_agent": True})(routed)
    return app


agent_v0_app = create_agent_app()
