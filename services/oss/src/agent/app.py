"""Agent workflow app: the ``/invoke`` handler, wired onto the SDK agent runtime.

Mirrors the chat/completion services: an Agenta app exposing ``/invoke`` and ``/inspect``
through ``ag.create_app`` + ``ag.workflow`` + ``ag.route``. The handler parses the request
into a neutral ``AgentConfig`` + ``RunSelection`` (``agenta.sdk.agents``), resolves tools
(``tools``) and provider secrets (``secrets``) server-side, threads the trace context
(``tracing``), then runs one turn through a :class:`Harness` over a backend it picks from
the selection, and records the run's usage.

The backend (rivet over ACP vs the in-process Pi path) and the transport (HTTP sidecar vs
subprocess) are deployment choices; the harness, sandbox, and permission policy are editable
playground config.
"""

import os
from typing import Any, Dict, List, Optional

import agenta as ag

from agenta.sdk.agents import (
    AgentConfig,
    Backend,
    Environment,
    InProcessPiBackend,
    RivetBackend,
    RunSelection,
    SessionConfig,
    make_harness,
    to_messages,
)
from agenta.sdk.agents.adapters.vercel import agent_run_to_vercel_parts

from oss.src.agent.config import load_config, wrapper_dir
from oss.src.agent.schemas import AGENT_SCHEMAS
from oss.src.agent.secrets import resolve_harness_secrets
from oss.src.agent.tools import resolve_agent_resources
from oss.src.agent.tracing import record_usage, trace_context


def _default_agent_config() -> AgentConfig:
    """The service's file defaults (AGENTS.md, model, tools) as a neutral AgentConfig."""
    file_cfg = load_config()
    return AgentConfig(
        instructions=file_cfg.agents_md,
        model=file_cfg.model,
        tools=file_cfg.tools,
    )


def select_backend(selection: RunSelection) -> Backend:
    """Pick the backend for a run.

    The in-process Pi backend runs Pi locally, and the Agenta harness is Pi with an opinion,
    so both ``pi`` and ``agenta`` stay on it. Any other harness, a non-local sandbox, or
    ``AGENTA_AGENT_RUNTIME=rivet`` selects the rivet backend instead of silently dropping the
    choice (``agenta`` is not yet supported on the rivet path, so ``agenta`` + a non-local
    sandbox raises ``UnsupportedHarnessError`` rather than running the wrong thing). The
    transport to the TypeScript runner is a deployment detail each backend takes:
    ``AGENTA_AGENT_PI_URL`` set (docker) -> HTTP to the sidecar; unset (local checkout) ->
    spawn the runner CLI from the wrapper dir.
    """
    runtime = os.getenv("AGENTA_AGENT_RUNTIME", "pi").lower()
    url = os.getenv("AGENTA_AGENT_PI_URL")
    cwd = str(wrapper_dir())
    use_rivet = (
        runtime == "rivet"
        or selection.harness not in ("pi", "agenta")
        or selection.sandbox != "local"
    )
    if use_rivet:
        return RivetBackend(sandbox=selection.sandbox, url=url, cwd=cwd)
    return InProcessPiBackend(url=url, cwd=cwd)


async def _agent(
    inputs: Optional[Dict[str, Any]] = None,
    messages: Optional[List[Any]] = None,
    parameters: Optional[Dict] = None,
    stream: Optional[bool] = None,
    session_id: Optional[str] = None,
):
    params = parameters or {}

    agent_config = AgentConfig.from_params(params, defaults=_default_agent_config())
    selection = RunSelection.from_params(
        params,
        default_harness=os.getenv("AGENTA_AGENT_HARNESS", "pi"),
        default_sandbox=os.getenv("AGENTA_AGENT_SANDBOX", "local"),
    )

    msgs = to_messages(messages or (inputs or {}).get("messages") or [])
    resources = await resolve_agent_resources(
        tools=agent_config.tools,
        mcp_servers=agent_config.mcp_servers,
    )

    session_config = SessionConfig(
        agent=agent_config,
        secrets=await resolve_harness_secrets(),
        permission_policy=selection.permission_policy,
        trace=trace_context(),
        session_id=session_id,
        builtin_names=resources.tools.builtin_names,
        tool_specs=resources.tools.tool_specs,
        tool_callback=resources.tools.tool_callback,
        mcp_servers=resources.mcp_servers,
    )

    # The harness validates that the chosen backend can drive it; select_backend already
    # routes a claude harness or a non-local sandbox to rivet, so this never fails in
    # practice. setup/cleanup own the backend lifecycle; prompt/stream run one cold turn.
    harness = make_harness(selection.harness, Environment(select_backend(selection)))

    # The `/messages` SSE path sets `stream`: return the Vercel UI Message Stream as an async
    # generator (the normalizer turns it into a streaming response). `/invoke` and the
    # `/messages` JSON path leave it unset and take the batch path below.
    if stream:
        return _agent_vercel_stream(harness, session_config, msgs)

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


def create_agent_app():
    app = ag.create_app()
    # No builtin URI yet: registering the agent as a first-class workflow type
    # (`agenta:builtin:agent:v0`) and its interface is WP-6. Here we register the handler
    # directly, so it gets an auto URI (`user:custom:...`) and runs locally.
    routed = ag.workflow(schemas=AGENT_SCHEMAS)(_agent)
    # is_agent gates the agent-only `/messages` + `/load-session` routes (next to /invoke).
    ag.route("/", app=app, flags={"is_chat": True, "is_agent": True})(routed)
    return app


agent_v0_app = create_agent_app()
