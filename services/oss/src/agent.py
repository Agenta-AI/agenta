"""Agent workflow service (WP-2).

Mirrors the chat/completion services: an Agenta app exposing ``/invoke`` and
``/inspect`` through ``ag.create_app`` + ``ag.workflow`` + ``ag.route``, so the
backend and playground treat an agent like the other workflow types. The handler
builds the user turn from the request and runs it through the Harness port, whose Pi
adapter drives the TypeScript wrapper in ``services/agent``.

MVP: hardcoded config (AGENTS.md text, model) read from files, a single
non-streaming reply, no tools. Streaming, multi-message output, tools, and Daytona
are later work packages.
"""

import os
from typing import Any, Dict, List, Optional

import agenta as ag
from agenta.sdk.engines.tracing.propagation import inject
from agenta.sdk.utils.logging import get_module_logger

from oss.src.agent_pi.config import load_config, wrapper_dir
from oss.src.agent_pi.local_runtime import LocalRuntime
from oss.src.agent_pi.pi_harness import PiHarness
from oss.src.agent_pi.pi_http_harness import PiHttpHarness
from oss.src.agent_pi.ports import Harness, HarnessRequest, TraceContext
from oss.src.agent_pi.schemas import AGENT_SCHEMAS

log = get_module_logger(__name__)

_CAPTURE_CONTENT = os.getenv("AGENTA_AGENT_CAPTURE_CONTENT", "true").lower() not in (
    "0",
    "false",
    "no",
)


def _build_harness() -> Harness:
    """Pick the harness adapter for the current deployment.

    - ``AGENTA_AGENT_PI_URL`` set (docker): call the Pi sidecar over HTTP.
    - otherwise (local): spawn the TS wrapper as a subprocess.
    """
    pi_url = os.getenv("AGENTA_AGENT_PI_URL")
    if pi_url:
        return PiHttpHarness(pi_url)
    return PiHarness(LocalRuntime(), wrapper_dir=str(wrapper_dir()))


def _latest_user_message(messages: Optional[List[Any]]) -> str:
    for message in reversed(messages or []):
        if not isinstance(message, dict):
            continue
        if message.get("role") == "user" and message.get("content"):
            content = message["content"]
            return content if isinstance(content, str) else str(content)
    return ""


def _trace_context() -> Optional[TraceContext]:
    """Capture the active workflow span's trace context for the harness.

    This runs inside the instrumented handler, so the current OTel span is the
    ``/invoke`` workflow span. Threading its ``traceparent`` into the Pi run makes
    the agent's spans children of that span, in the same trace, so the agent's
    whole run shows up under the response's ``trace_id`` the way completion/chat
    nest their LLM spans. Best-effort: any failure returns ``None`` and the run is
    simply traced standalone (or not at all) using the wrapper's env config.
    """
    try:
        headers = inject({})

        traceparent = headers.get("traceparent")
        if not traceparent:
            return None

        endpoint = None
        try:
            endpoint = ag.tracing.otlp_url
        except Exception:  # pylint: disable=broad-except
            endpoint = None

        return TraceContext(
            traceparent=traceparent,
            baggage=headers.get("baggage"),
            endpoint=endpoint,
            authorization=headers.get("Authorization"),
            capture_content=_CAPTURE_CONTENT,
        )
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: failed to capture trace context", exc_info=True)
        return None


async def _agent(
    inputs: Optional[Dict[str, Any]] = None,
    messages: Optional[List[Any]] = None,
    parameters: Optional[Dict] = None,
):
    config = load_config()

    # Config (model + AGENTS.md instructions) comes from parameters when the
    # playground/caller sets it, falling back to the service's file config.
    params = parameters or {}
    model = params.get("model") or config.model
    agents_md = params.get("agents_md") or config.agents_md

    msgs = messages or (inputs or {}).get("messages") or []
    prompt = _latest_user_message(msgs)

    harness = _build_harness()

    await harness.setup()
    try:
        result = await harness.invoke(
            HarnessRequest(
                agents_md=agents_md,
                model=model,
                prompt=prompt,
                messages=msgs,
                tools=config.tools,
                trace=_trace_context(),
            )
        )
    finally:
        await harness.shutdown()

    return {"role": "assistant", "content": result.output}


def create_agent_app():
    app = ag.create_app()
    # No builtin URI yet: registering the agent as a first-class workflow type
    # (`agenta:builtin:agent:v0`) and its interface is WP-6. Here we register the
    # handler directly, so it gets an auto URI (`user:custom:...`) and runs locally.
    routed = ag.workflow(schemas=AGENT_SCHEMAS)(_agent)
    ag.route("/", app=app, flags={"is_chat": True})(routed)
    return app


agent_v0_app = create_agent_app()
