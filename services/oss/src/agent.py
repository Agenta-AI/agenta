"""Agent workflow service (WP-2 + WP-7).

Mirrors the chat/completion services: an Agenta app exposing ``/invoke`` and
``/inspect`` through ``ag.create_app`` + ``ag.workflow`` + ``ag.route``, so the
backend and playground treat an agent like the other workflow types. The handler
builds the user turn from the request and runs it through the Harness port, whose Pi
adapter drives the TypeScript wrapper in ``services/agent``.

Config is a ``prompt-template`` (system message as AGENTS.md, model, and tools): the
playground renders the same prompt control as chat/completion, including the tool
picker. Runnable tools (WP-7) are resolved in the backend (``/tools/resolve``) and
executed back through ``/tools/call`` while Pi drives the loop. Streaming,
multi-message output, and the Daytona sandbox are later work packages.
"""

import os
from typing import Any, Dict, List, Optional, Tuple

import httpx

import agenta as ag
from agenta.sdk.engines.tracing.propagation import inject
from agenta.sdk.utils.logging import get_module_logger

from oss.src.agent_pi.config import load_config, wrapper_dir
from oss.src.agent_pi.local_runtime import LocalRuntime
from oss.src.agent_pi.pi_harness import PiHarness
from oss.src.agent_pi.pi_http_harness import PiHttpHarness
from oss.src.agent_pi.ports import Harness, HarnessRequest, ToolCallback, TraceContext
from oss.src.agent_pi.schemas import AGENT_SCHEMAS

log = get_module_logger(__name__)

_CAPTURE_CONTENT = os.getenv("AGENTA_AGENT_CAPTURE_CONTENT", "true").lower() not in (
    "0",
    "false",
    "no",
)

# Budget for the backend tool-resolution round-trip (catalog + connection check).
_TOOLS_RESOLVE_TIMEOUT = float(os.getenv("AGENTA_AGENT_TOOLS_TIMEOUT", "30"))


def _build_harness() -> Harness:
    """Pick the harness adapter for the current deployment.

    - ``AGENTA_AGENT_PI_URL`` set (docker): call the Pi sidecar over HTTP.
    - otherwise (local): spawn the TS wrapper as a subprocess.
    """
    pi_url = os.getenv("AGENTA_AGENT_PI_URL")
    if pi_url:
        return PiHttpHarness(pi_url)
    return PiHarness(LocalRuntime(), wrapper_dir=str(wrapper_dir()))


def _system_text(messages: Optional[List[Any]]) -> str:
    """Join the system-message content of a prompt-template into AGENTS.md text."""
    parts: List[str] = []
    for message in messages or []:
        if not isinstance(message, dict) or message.get("role") != "system":
            continue
        content = message.get("content")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            parts.extend(
                block.get("text", "")
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            )
    return "\n\n".join(part for part in parts if part)


def _resolve_run_config(
    params: Dict[str, Any],
    config: Any,
) -> Tuple[str, str, Any]:
    """Pull model, instructions, and raw tools from the request parameters.

    Accepts both shapes: the playground's ``prompt`` (a ``prompt-template`` whose
    system message is the AGENTS.md and whose ``llm_config`` carries model + picker
    tools) and the flat ``{model, agents_md, tools}`` an API caller may send. Falls
    back to the service file config for any unset field.
    """
    prompt_cfg = params.get("prompt")
    if isinstance(prompt_cfg, dict):
        llm_config = prompt_cfg.get("llm_config") or {}
        model = llm_config.get("model") or config.model
        agents_md = _system_text(prompt_cfg.get("messages")) or config.agents_md
        raw_tools = llm_config.get("tools")
        if raw_tools is None:
            raw_tools = prompt_cfg.get("tools")
    else:
        model = params.get("model") or config.model
        agents_md = params.get("agents_md") or config.agents_md
        raw_tools = params.get("tools")

    if raw_tools is None:
        raw_tools = config.tools
    return model, agents_md, raw_tools


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


def _agenta_api_base() -> Optional[str]:
    """Resolve the Agenta backend base URL (``.../api``) for tool calls.

    Prefers an explicit override, then derives it from the OTLP endpoint the SDK is
    configured with (``{host}/api/otlp/v1/traces``), then falls back to env. Returns
    ``None`` when nothing is configured; callers only need this when tools are set.
    """
    override = os.getenv("AGENTA_AGENT_TOOLS_API_URL")
    if override:
        return override.rstrip("/")

    try:
        otlp_url = ag.tracing.otlp_url
    except Exception:  # pylint: disable=broad-except
        otlp_url = None
    if otlp_url and "/otlp/" in otlp_url:
        return otlp_url.split("/otlp/", 1)[0].rstrip("/")

    api_url = os.getenv("AGENTA_API_URL")
    if api_url:
        return api_url.rstrip("/")

    return None


def _request_authorization() -> Optional[str]:
    """The project-scoped credential to call ``/tools/resolve`` and ``/tools/call``.

    Reuses the same propagation the OTLP credential rides on (the caller's
    Authorization), falling back to the service's own API key the way the tracing
    sidecar does. Scoping to the caller keeps an agent run from invoking tools the
    user could not (see WP-7 risk: RUN_TOOLS scoping).
    """
    try:
        authorization = inject({}).get("Authorization")
    except Exception:  # pylint: disable=broad-except
        authorization = None
    if authorization:
        return authorization

    api_key = os.getenv("AGENTA_API_KEY")
    if api_key:
        return f"ApiKey {api_key}"

    return None


def _parse_gateway_slug(slug: Any) -> Optional[Dict[str, Any]]:
    """Parse a gateway tool slug into a Composio reference, or ``None``.

    The playground tool picker encodes a Composio action as a function name like
    ``tools__composio__github__GET_THE_AUTHENTICATED_USER__github-tvn`` (the same
    5-segment slug ``/tools/call`` parses; ``__`` or ``.`` separated). Anything that
    is not a 5-segment ``tools.composio.*`` slug returns ``None`` so the caller can
    skip it.
    """
    if not isinstance(slug, str):
        return None
    parts = slug.replace("__", ".").split(".")
    if len(parts) == 5 and parts[0] == "tools" and parts[1] == "composio":
        return {
            "type": "composio",
            "integration": parts[2],
            "action": parts[3],
            "connection": parts[4],
        }
    return None


def _normalize_tool_ref(ref: Any) -> Optional[Dict[str, Any]]:
    """Coerce a config entry into a discriminated tool reference the resolver parses.

    Handles three shapes: a bare string (or single-key ``{"name": ...}``) is the
    existing built-in tool name; a dict already carrying ``type`` passes through; and
    the playground picker's gateway entry (``{"function": {"name":
    "tools__composio__..."}}``) is parsed into a ``composio`` ref. Unsupported picker
    entries (provider built-ins, inline custom functions) return ``None`` and are
    skipped rather than failing the run.
    """
    if isinstance(ref, str):
        return {"type": "builtin", "name": ref}
    if isinstance(ref, dict):
        if ref.get("type") in ("builtin", "composio"):
            return ref
        function = ref.get("function") if isinstance(ref.get("function"), dict) else {}
        gateway = _parse_gateway_slug(function.get("name") or ref.get("name"))
        if gateway:
            return gateway
        if "type" not in ref and isinstance(ref.get("name"), str):
            return {"type": "builtin", "name": ref["name"]}
        return None
    return None


async def _resolve_tools(
    tools: List[Any],
) -> Tuple[List[str], List[Dict[str, Any]], Optional[ToolCallback]]:
    """Resolve config tool references into builtins + Pi customTool specs.

    Calls the backend resolver (``POST /tools/resolve``), which validates Composio
    connections up front and enriches each action from the catalog. Returns the
    built-in tool names, the camelCase customTool specs for the wire, and the
    ``/tools/call`` callback. Raises on resolution failure so the invoke fails early
    with a clear message rather than the model hitting a runtime tool error.
    """
    refs = [ref for ref in (_normalize_tool_ref(t) for t in tools if t) if ref]
    if not refs:
        return [], [], None

    api_base = _agenta_api_base()
    if not api_base:
        raise RuntimeError(
            "Agent has tools configured but the Agenta API base URL is unknown. "
            "Set AGENTA_AGENT_TOOLS_API_URL or AGENTA_API_URL."
        )

    authorization = _request_authorization()
    headers = {"Content-Type": "application/json"}
    if authorization:
        headers["Authorization"] = authorization

    async with httpx.AsyncClient(timeout=_TOOLS_RESOLVE_TIMEOUT) as client:
        response = await client.post(
            f"{api_base}/tools/resolve",
            json={"tools": refs},
            headers=headers,
        )

    if response.status_code >= 400:
        raise RuntimeError(
            f"Tool resolution failed (HTTP {response.status_code}): "
            f"{response.text[:500]}"
        )

    data = response.json()
    builtins = data.get("builtins") or []
    custom = data.get("custom") or []

    custom_tools = [
        {
            "name": spec["name"],
            "description": spec.get("description"),
            "inputSchema": spec.get("input_schema"),
            "callRef": spec["call_ref"],
        }
        for spec in custom
    ]

    callback = ToolCallback(
        endpoint=f"{api_base}/tools/call",
        authorization=authorization,
    )

    return builtins, custom_tools, callback


async def _agent(
    inputs: Optional[Dict[str, Any]] = None,
    messages: Optional[List[Any]] = None,
    parameters: Optional[Dict] = None,
):
    config = load_config()

    # Config comes from parameters when the playground/caller sets it, falling back
    # to the service file config. Accepts both the playground prompt-template shape
    # and a flat {model, agents_md, tools} (see _resolve_run_config).
    params = parameters or {}
    model, agents_md, tools_config = _resolve_run_config(params, config)

    if isinstance(tools_config, dict):
        tools_config = [tools_config]
    elif not isinstance(tools_config, list):
        tools_config = []

    msgs = messages or (inputs or {}).get("messages") or []
    prompt = _latest_user_message(msgs)

    builtins, custom_tools, tool_callback = await _resolve_tools(tools_config)

    harness = _build_harness()

    await harness.setup()
    try:
        result = await harness.invoke(
            HarnessRequest(
                agents_md=agents_md,
                model=model,
                prompt=prompt,
                messages=msgs,
                tools=builtins,
                custom_tools=custom_tools,
                tool_callback=tool_callback,
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
