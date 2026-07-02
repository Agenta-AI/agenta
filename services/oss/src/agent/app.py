"""Agent workflow app: the ``/invoke`` handler, wired onto the SDK agent runtime.

Mirrors the chat/completion services: an Agenta app exposing ``/invoke`` and ``/inspect``
through ``ag.create_app`` + ``ag.workflow`` + ``ag.route``. The handler parses the request
into one neutral ``AgentTemplate`` (``agenta.sdk.agents``), resolves tools (``tools``) and one
least-privilege model connection (``resolve_connection``) server-side, threads the trace
context (``tracing``), then runs one turn through a :class:`Harness` over a backend it picks
from the config's run-selection fields, and records the run's usage.

The sandbox-agent-backed backend is the production path. The transport is a deployment
choice: HTTP to `AGENTA_RUNNER_URL`, or a local runner CLI in a source checkout.
The harness, sandbox, and permission policy are editable fields on the agent config.
"""

from typing import Any, Dict, List, Optional

import agenta as ag

from agenta.sdk.agents import (
    AgentTemplate,
    Backend,
    ConnectionResolutionError,
    Environment,
    MissingProviderError,
    ModelRef,
    ResolvedConnection,
    RuntimeAuthContext,
    SandboxAgentBackend,
    SessionConfig,
    make_harness,
    to_messages,
)
from agenta.sdk.agents.capabilities import (
    harness_allows_deployment,
    harness_allows_mode,
    harness_allows_provider,
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
)
from agenta.sdk.models.workflows import (
    WorkflowInvokeRequestFlags,
    WorkflowRevisionData,
    WorkflowServiceRequest,
)

from agenta.sdk.utils.logging import get_module_logger

from oss.src.agent.config import load_config, runner_dir, runner_url
from oss.src.agent.schemas import AGENT_SCHEMAS
from oss.src.agent.tools import resolve_mcp_servers, resolve_tools
from oss.src.agent.tracing import record_usage, run_context, trace_context

log = get_module_logger(__name__)


def _default_agent_template() -> AgentTemplate:
    """The service's file defaults (AGENTS.md, model, tools) as a neutral AgentTemplate."""
    file_cfg = load_config()
    return AgentTemplate(
        instructions=file_cfg.agents_md,
        model=file_cfg.model,
        tools=file_cfg.tools,
    )


def _agent_model_ref(agent_template: AgentTemplate) -> Optional[ModelRef]:
    """The structured model ref for the run, or ``None`` when no model is configured.

    Prefer the parsed ``model_ref`` (populated only when the config's ``model`` arrived as a
    dict/object carrying a connection); otherwise coerce the back-compat plain ``model`` string.
    ``None`` means no model at all, in which case the harness uses its own default/login and no
    connection is resolved.
    """
    if agent_template.model_ref is not None:
        return agent_template.model_ref
    if isinstance(agent_template.model, str) and agent_template.model.strip():
        return ModelRef.coerce(agent_template.model)
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
    except MissingProviderError:
        # A bare model id with no provider is an underspecified config, not a missing
        # credential, so it fails loud even on a default connection (the user sees the clear
        # "needs a provider prefix" message instead of a misleading "add your key" auth error).
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


def select_backend(agent_template: AgentTemplate) -> Backend:
    """Pick the backend for a run from the agent config's run-selection fields.

    The service always uses the sandbox-agent-backed runner. `AGENTA_RUNNER_URL`
    selects HTTP transport in deployed containers. When it is unset, local development
    spawns the TypeScript runner CLI from the runner dir. Only ``sandbox`` is read here;
    it is a backend/environment concern that never enters ``SessionConfig``.
    """
    return SandboxAgentBackend(
        sandbox=agent_template.sandbox,
        url=runner_url(),
        cwd=str(runner_dir()),
    )


async def _agent(
    request: WorkflowServiceRequest,
    inputs: Optional[Dict[str, Any]] = None,
    messages: Optional[List[Any]] = None,
    parameters: Optional[Dict] = None,
):
    # The stream decision is a flag, negotiated from Accept at the HTTP edge.
    stream = WorkflowInvokeRequestFlags(**(request.flags or {})).stream
    # session_id is resolved (echoed/minted) by the normalizer onto the request.
    session_id = request.session_id

    params = parameters or {}

    agent_template = AgentTemplate.from_params(
        params, defaults=_default_agent_template()
    )

    msgs = to_messages(messages or (inputs or {}).get("messages") or [])
    # Three independent resolutions (tools, MCP, the model's one connection), not one aggregate:
    # the boundary resolves; the backend later decides how each tool executes.
    resolved_tools = await resolve_tools(agent_template.tools)
    resolved_mcp = await resolve_mcp_servers(agent_template.mcp_servers)

    # One least-privilege connection for the configured model. The connection rides the template
    # (inside `parameters.agent` -> `agent.llm.connection`); there is no new request field and no
    # project id from the body. project_id is filled server-side from the caller's auth on the
    # resolve call, so the client-side context leaves it None.
    model_ref = _agent_model_ref(agent_template)
    resolved_connection: Optional[ResolvedConnection] = None
    secrets: Dict[str, str] = {}
    if model_ref is not None:
        ctx = RuntimeAuthContext(
            harness=agent_template.harness, backend=agent_template.sandbox
        )
        resolved_connection = await _resolve_session_connection(model_ref, ctx)
        secrets = resolved_connection.env

    session_config = SessionConfig(
        agent=agent_template,
        secrets=secrets,  # the env compat alias the wire still reads
        resolved_connection=resolved_connection,
        permission_policy=agent_template.permission_policy,
        trace=trace_context(),
        # The run's own context (trace + workflow identity), refreshed each turn and consumed only
        # by a tool's `call.context` binding at dispatch (direct-call tools, Phase 3a). The
        # conversation id is threaded separately as `session_id` below, not duplicated in here.
        run_context=run_context(),
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
    harness = make_harness(
        agent_template.harness, Environment(select_backend(agent_template))
    )

    # ONE path: always stream. The agent only ever runs the streaming transport; the per-call
    # `stream` flag (negotiated from Accept) decides the SHAPE we hand the running layer:
    #   - stream -> yield the live agenta event stream (the AgentStream's AgentEvents as
    #     `{type, data}`). Routing projects these to vercel/sse per `x-ag-messages-format`.
    #   - batch  -> drain the same stream and coalesce the `{messages: [...]}` envelope from the
    #     terminal AgentResult. Agent v0 output is `outputs.messages`, mirroring `inputs.messages`.
    # The one-shot `prompt()` transport is DEV-ONLY and never used here. Coalescing is agent-owned
    # (it needs the AgentStream's terminal result), so the generic normalizer stays shape-agnostic.
    if stream:
        return _agent_event_stream(harness, session_config, msgs)
    return await _agent_batch(harness, session_config, msgs)


async def _agent_event_stream(harness, session_config, msgs):
    """Run one streaming turn and yield the live agenta event stream.

    Yields each ``Event`` as a neutral ``{type, data}`` dict (the agenta wire). Routing
    projects them to vercel/sse when the caller asks; the handler never emits vercel. Usage is
    recorded in the ``finally`` once the stream fully drains (guarded: a failed/aborted stream
    has no terminal result). Owns the environment lifecycle (``setup`` / ``cleanup``).
    """
    await harness.setup()
    run = await harness.stream(session_config, msgs)
    try:
        async for event in run:
            yield {"type": event.type, "data": event.data}
    finally:
        try:
            record_usage(run.result().usage)
        except Exception:  # result unavailable on a failed/aborted stream
            pass
        await harness.cleanup()


async def _agent_batch(harness, session_config, msgs):
    """Drain the streaming turn and return the ``{messages: [...]}`` output envelope.

    Always uses the streaming transport (``stream()``), draining it to the terminal
    ``AgentResult`` — the same coalesced result the dev-only one-shot path would return.
    Agent v0's output is ``outputs.messages`` (an object with a ``messages`` field of type
    ``messages``), unlike chat/completion whose ``outputs`` IS the single message. The
    normalizer's full-vs-last (`flags.history`) trims the inner list. Owns the lifecycle.
    """
    await harness.setup()
    try:
        run = await harness.stream(session_config, msgs)
        async for _ in run:  # drain to the terminal result
            pass
        result = run.result()
    finally:
        await harness.cleanup()
    record_usage(result.usage)
    return {"messages": [{"role": "assistant", "content": result.output}]}


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
    #    `register_interface` replaces (not setdefault), unlike the SDK's minimal seed.
    # 3. Build the workflow against the URI. `ag.workflow.__init__` resolves the (instrumented)
    #    handler and merges the registered interface; the passed `schemas` still win.
    #
    # `/inspect` carries NO behavior-changing `meta`: it must not differ for agent vs non-agent.
    # Harness connection capabilities live in the `harnesses` catalog
    # (`GET /catalog/harnesses/{ag_harness}`, built from the SDK's `harness_catalog_document`) and
    # are resolved by the frontend via `x-ag-harness-ref` on the agent-config harness field — the
    # same catalog/ref mechanism as every other type. The agent service still imports the SDK
    # capability table directly for its server-side reject; it never publishes it on inspect.
    register_handler(auto_instrument(_agent), uri=AGENT_URI)
    register_interface(
        WorkflowRevisionData(uri=AGENT_URI, schemas=AGENT_SCHEMAS),
        uri=AGENT_URI,
    )
    routed = ag.workflow(uri=AGENT_URI, schemas=AGENT_SCHEMAS)(_agent)
    ag.route("/", app=app, flags={"is_chat": True})(routed)
    return app


agent_v0_app = create_agent_app()
