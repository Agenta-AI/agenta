"""Agent workflow app: the ``/invoke`` handler, wired onto the SDK agent runtime.

Mirrors the chat/completion services: an Agenta app exposing ``/invoke`` and ``/inspect``
through ``ag.create_app`` + ``ag.workflow`` + ``ag.route``. The handler parses the request
into a neutral ``AgentConfig`` + ``RunSelection`` (``agenta.sdk.agents``), resolves tools
(``tools``) and provider secrets (``secrets``) server-side, threads the trace context
(``tracing``), then runs one turn through a :class:`Harness` over a backend it picks from
the selection, and records the run's usage.

The sandbox-agent-backed backend is the production path. The transport is a deployment
choice: HTTP to `AGENTA_AGENT_RUNNER_URL`, or a local runner CLI in a source checkout.
The harness, sandbox, and permission policy are editable playground config.
"""

from typing import Any, Dict, List, Optional

import agenta as ag

from agenta.sdk.agents import (
    AgentConfig,
    Backend,
    Environment,
    SandboxAgentBackend,
    RunSelection,
    SessionConfig,
    make_harness,
    to_messages,
)
from agenta.sdk.agents.adapters.vercel import agent_run_to_vercel_parts

from agenta.sdk.agents.platform import resolve_secrets

from oss.src.agent.config import load_config, runner_dir, runner_url
from oss.src.agent.schemas import AGENT_SCHEMAS
from oss.src.agent.tools import resolve_mcp_servers, resolve_tools
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
    # Three independent resolutions (tools, MCP, provider-key secrets), not one aggregate:
    # the boundary resolves; the backend later decides how each tool executes.
    resolved_tools = await resolve_tools(agent_config.tools)
    resolved_mcp = await resolve_mcp_servers(agent_config.mcp_servers)

    session_config = SessionConfig(
        agent=agent_config,
        secrets=await resolve_secrets(),
        permission_policy=selection.permission_policy,
        trace=trace_context(),
        session_id=session_id,
        builtin_names=resolved_tools.builtin_names,
        tool_specs=resolved_tools.tool_specs,
        tool_callback=resolved_tools.tool_callback,
        mcp_servers=resolved_mcp,
    )

    # The harness validates that the chosen backend can drive it. Unsupported combinations
    # such as `agenta` on sandbox-agent fail here instead of silently changing runtime behavior.
    # setup/cleanup own the backend lifecycle; prompt/stream run one cold turn.
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


def create_agent_app():
    app = ag.create_app()
    # The builtin agent workflow interface (`agenta:builtin:agent:v0`, `agent_v0_interface`
    # in the SDK) now exists, but this service still registers the handler directly, so it
    # gets an auto URI (`user:custom:...`) and runs locally. Binding the handler to the
    # builtin URI is the remaining step.
    routed = ag.workflow(schemas=AGENT_SCHEMAS)(_agent)
    # is_agent gates the agent-only `/messages` + `/load-session` routes (next to /invoke).
    ag.route("/", app=app, flags={"is_chat": True, "is_agent": True})(routed)
    return app


agent_v0_app = create_agent_app()
