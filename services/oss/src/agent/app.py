"""Agent workflow app: the ``/invoke`` handler and how it wires a harness run.

Mirrors the chat/completion services: an Agenta app exposing ``/invoke`` and ``/inspect``
through ``ag.create_app`` + ``ag.workflow`` + ``ag.route``. The handler parses the request
(``inputs``), resolves tools (``tools``) and provider secrets (``secrets``), threads the
trace context (``tracing``), runs one turn through an :class:`AgentSession` on the
engine-agnostic runtime (``oss.src.harness``), and records the run's usage.

The engine (rivet over ACP vs the legacy in-process Pi path) and the transport (HTTP
sidecar vs subprocess) are deployment choices; the harness, sandbox, and permission policy
are editable playground config.
"""

import os
from typing import Any, Dict, List, Optional

import agenta as ag

from oss.src.agent.config import load_config, wrapper_dir
from oss.src.agent.inputs import resolve_agent_config, to_messages
from oss.src.agent.schemas import AGENT_SCHEMAS
from oss.src.agent.secrets import resolve_harness_secrets
from oss.src.agent.tools import resolve_tools
from oss.src.agent.tracing import record_usage, trace_context
from oss.src.harness import (
    Harness,
    HttpHarness,
    LocalEnvironment,
    SessionConfig,
    SubprocessHarness,
)


def select_backend(harness_id: str, sandbox_id: str) -> str:
    """Choose the engine (``rivet`` or ``pi``) for a run.

    ``rivet`` drives a harness over ACP via a rivet daemon; ``pi`` is the legacy in-process
    Pi path. The legacy path only runs the ``pi`` harness locally, so any other harness or
    sandbox forces ``rivet`` rather than silently dropping the selection.
    ``AGENTA_AGENT_RUNTIME=rivet`` forces rivet for everything.
    """
    runtime = os.getenv("AGENTA_AGENT_RUNTIME", "pi").lower()
    if runtime == "rivet" or harness_id != "pi" or sandbox_id != "local":
        return "rivet"
    return "pi"


def build_harness(backend: str) -> Harness:
    """Pick the transport to the TypeScript runner for the current deployment.

    ``AGENTA_AGENT_PI_URL`` set (docker) -> call the sidecar over HTTP; unset (local) ->
    spawn the runner as a subprocess. ``backend`` (the engine) is chosen by
    :func:`select_backend`.
    """
    pi_url = os.getenv("AGENTA_AGENT_PI_URL")
    if pi_url:
        return HttpHarness(pi_url, backend=backend)
    return SubprocessHarness(
        LocalEnvironment(),
        wrapper_dir=str(wrapper_dir()),
        backend=backend,
    )


async def _agent(
    inputs: Optional[Dict[str, Any]] = None,
    messages: Optional[List[Any]] = None,
    parameters: Optional[Dict] = None,
):
    params = parameters or {}
    cfg = resolve_agent_config(params, load_config())

    msgs = to_messages(messages or (inputs or {}).get("messages") or [])
    builtins, custom_tools, tool_callback = await resolve_tools(cfg.tools)

    session_config = SessionConfig(
        instructions=cfg.instructions,
        model=cfg.model,
        harness=cfg.harness,
        sandbox=cfg.sandbox,
        secrets=await resolve_harness_secrets(),
        builtin_tools=builtins,
        custom_tools=custom_tools,
        tool_callback=tool_callback,
        permission_policy=cfg.permission_policy,
        trace=trace_context(),
    )

    # The engine follows the selected harness/sandbox: a claude harness or a daytona
    # sandbox needs rivet, so the legacy pi path never silently swallows the selection.
    harness = build_harness(select_backend(cfg.harness, cfg.sandbox))
    await harness.setup()
    try:
        session = harness.create_session(session_config)
        result = await session.prompt(msgs)
        await session.destroy()
    finally:
        await harness.shutdown()

    record_usage(result.usage)
    return {"role": "assistant", "content": result.output}


def create_agent_app():
    app = ag.create_app()
    # No builtin URI yet: registering the agent as a first-class workflow type
    # (`agenta:builtin:agent:v0`) and its interface is WP-6. Here we register the handler
    # directly, so it gets an auto URI (`user:custom:...`) and runs locally.
    routed = ag.workflow(schemas=AGENT_SCHEMAS)(_agent)
    ag.route("/", app=app, flags={"is_chat": True})(routed)
    return app


agent_v0_app = create_agent_app()
