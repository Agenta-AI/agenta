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
from opentelemetry import trace as otel_trace

import agenta as ag
from agenta.sdk.engines.tracing.propagation import inject
from agenta.sdk.utils.logging import get_module_logger

from oss.src.agent_pi.config import load_config, wrapper_dir
from oss.src.agent_pi.environment import LocalEnvironment
from oss.src.agent_pi.harness import HttpHarness, SubprocessHarness
from oss.src.agent_pi.ports import (
    Harness,
    Message,
    SessionConfig,
    ToolCallback,
    TraceContext,
)
from oss.src.agent_pi.schemas import AGENT_SCHEMAS

log = get_module_logger(__name__)

_CAPTURE_CONTENT = os.getenv("AGENTA_AGENT_CAPTURE_CONTENT", "true").lower() not in (
    "0",
    "false",
    "no",
)

# Budget for the backend tool-resolution round-trip (catalog + connection check).
_TOOLS_RESOLVE_TIMEOUT = float(os.getenv("AGENTA_AGENT_TOOLS_TIMEOUT", "30"))


def _select_backend(harness_id: str, sandbox_id: str) -> str:
    """Choose the engine (``rivet`` or ``pi``) for a run.

    ``rivet`` drives a harness over ACP via a rivet daemon; ``pi`` is the legacy
    in-process Pi path. The legacy path only runs the ``pi`` harness locally, so any other
    harness or sandbox forces ``rivet`` rather than silently dropping the selection.
    ``AGENTA_AGENT_RUNTIME=rivet`` forces rivet for everything.
    """
    runtime = os.getenv("AGENTA_AGENT_RUNTIME", "pi").lower()
    if runtime == "rivet" or harness_id != "pi" or sandbox_id != "local":
        return "rivet"
    return "pi"


def _build_harness(backend: str) -> Harness:
    """Pick the transport to the TypeScript runner for the current deployment.

    The ``backend`` (engine) is chosen by :func:`_select_backend`. The transport is
    env-driven: ``AGENTA_AGENT_PI_URL`` set (docker) -> call the sidecar over HTTP; unset
    (local) -> spawn the runner as a subprocess.
    """
    pi_url = os.getenv("AGENTA_AGENT_PI_URL")
    if pi_url:
        return HttpHarness(pi_url, backend=backend)
    return SubprocessHarness(
        LocalEnvironment(),
        wrapper_dir=str(wrapper_dir()),
        backend=backend,
    )


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


def _to_messages(raw: Optional[List[Any]]) -> List[Message]:
    """Coerce the playground's loose message dicts into :class:`Message` objects.

    The runner picks the latest user turn and replays the rest as context, so we hand it
    the whole conversation rather than pre-extracting a single prompt.
    """
    messages: List[Message] = []
    for item in raw or []:
        message = Message.from_raw(item)
        if message is not None:
            messages.append(message)
    return messages


# Map a vault standard-provider kind to the env var the harness (Pi/Claude/litellm)
# reads. Only providers an agent harness can use are listed.
_PROVIDER_ENV_VARS = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "mistralai": "MISTRAL_API_KEY",
    "groq": "GROQ_API_KEY",
    "together_ai": "TOGETHERAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


async def _resolve_harness_secrets() -> Dict[str, str]:
    """Resolve provider API keys from the project vault into harness env vars.

    The agent authenticates the harness with the same provider keys the project
    configured for LLM access. We fetch the project's vault ``provider_key`` secrets
    from the backend directly (same backend + caller credential the tool resolver uses)
    and inject each as its standard env var, so the harness uses whichever its model
    needs. The SDK's per-request secret context does not propagate to this custom route,
    so we resolve here rather than reading it. Empty when the vault has none (the harness
    then falls back to its own login / OAuth — see ``runRivet``). Best-effort.
    """
    api_base = _agenta_api_base()
    if not api_base:
        return {}
    headers = {"Content-Type": "application/json"}
    authorization = _request_authorization()
    if authorization:
        headers["Authorization"] = authorization

    try:
        async with httpx.AsyncClient(timeout=_TOOLS_RESOLVE_TIMEOUT) as client:
            response = await client.get(f"{api_base}/secrets/", headers=headers)
        if response.status_code >= 400:
            log.warning("agent: vault secrets fetch HTTP %s", response.status_code)
            return {}
        secrets = response.json() or []
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: vault secrets fetch failed", exc_info=True)
        return {}

    env: Dict[str, str] = {}
    for secret in secrets:
        if not isinstance(secret, dict) or secret.get("kind") != "provider_key":
            continue
        data = secret.get("data") or {}
        env_var = _PROVIDER_ENV_VARS.get(str(data.get("kind", "")).lower())
        key = (data.get("provider") or {}).get("key")
        if env_var and key:
            env.setdefault(env_var, key)
    return env


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

    msgs = _to_messages(messages or (inputs or {}).get("messages") or [])

    builtins, custom_tools, tool_callback = await _resolve_tools(tools_config)

    # Harness (pi/claude), sandbox (local/daytona), and permission policy are editable
    # config (see schemas.py), so a playground run can switch engine or environment;
    # unset falls back to the env defaults. They ride on the per-run SessionConfig.
    harness_id = (
        params.get("harness") or os.getenv("AGENTA_AGENT_HARNESS", "pi")
    ).lower()
    sandbox_id = (
        params.get("sandbox") or os.getenv("AGENTA_AGENT_SANDBOX", "local")
    ).lower()
    session_config = SessionConfig(
        instructions=agents_md,
        model=model,
        harness=harness_id,
        sandbox=sandbox_id,
        secrets=await _resolve_harness_secrets(),
        builtin_tools=builtins,
        custom_tools=custom_tools,
        tool_callback=tool_callback,
        permission_policy=(params.get("permission_policy") or "auto").lower(),
        trace=_trace_context(),
    )

    # The engine follows the selected harness/sandbox: a claude harness or a daytona
    # sandbox needs rivet, so the legacy pi path never silently swallows the selection.
    harness = _build_harness(_select_backend(harness_id, sandbox_id))
    await harness.setup()
    try:
        session = harness.create_session(session_config)
        result = await session.prompt(msgs)
        await session.destroy()
    finally:
        await harness.shutdown()

    _record_usage(result.usage)

    return {"role": "assistant", "content": result.output}


def _record_usage(usage: Optional[Dict[str, Any]]) -> None:
    """Stamp the agent's token/cost totals onto the active ``/invoke`` workflow span.

    The harness emits its own span tree (turns, LLM, tools) in a separate OTLP batch, so
    Agenta's per-batch cumulative roll-up cannot bridge the totals onto the workflow
    span. Setting ``gen_ai.usage.*`` here records them directly on that span (the root of
    its batch), so the trace shows the run's tokens and cost. Best-effort.
    """
    if not usage or not usage.get("total"):
        return
    try:
        span = otel_trace.get_current_span()
        input_tokens = int(usage.get("input") or 0)
        output_tokens = int(usage.get("output") or 0)
        span.set_attribute("gen_ai.usage.input_tokens", input_tokens)
        span.set_attribute("gen_ai.usage.output_tokens", output_tokens)
        span.set_attribute("gen_ai.usage.prompt_tokens", input_tokens)
        span.set_attribute("gen_ai.usage.completion_tokens", output_tokens)
        span.set_attribute("gen_ai.usage.total_tokens", int(usage.get("total") or 0))
        cost = usage.get("cost")
        if cost:
            span.set_attribute("gen_ai.usage.cost", float(cost))
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: failed to record usage on workflow span", exc_info=True)


def create_agent_app():
    app = ag.create_app()
    # No builtin URI yet: registering the agent as a first-class workflow type
    # (`agenta:builtin:agent:v0`) and its interface is WP-6. Here we register the
    # handler directly, so it gets an auto URI (`user:custom:...`) and runs locally.
    routed = ag.workflow(schemas=AGENT_SCHEMAS)(_agent)
    ag.route("/", app=app, flags={"is_chat": True})(routed)
    return app


agent_v0_app = create_agent_app()
