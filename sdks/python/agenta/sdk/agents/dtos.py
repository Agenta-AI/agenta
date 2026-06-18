"""Data contracts for the agent runtime (the DTO layer).

Everything the ports and adapters pass around: harness identity, capabilities, content
blocks, messages, run events, the run result, trace/tool-callback plumbing, the neutral
``AgentConfig``, the per-harness configs a backend plumbs, and the ``SessionConfig`` bundle.

These are Pydantic models (the SDK already depends on Pydantic), kept neutral: an adapter
translates them to and from its engine's own shapes at its edge.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Callable, ClassVar, Dict, List, Optional, Tuple, Union

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Harness identity
# ---------------------------------------------------------------------------


class HarnessType(str, Enum):
    """The coding agent program a run drives. A backend declares which it supports."""

    PI = "pi"
    CLAUDE = "claude"
    AGENTA = "agenta"

    @classmethod
    def coerce(cls, value: "HarnessType | str") -> "HarnessType":
        """Accept either an enum or a loose string (the playground sends a string)."""
        if isinstance(value, cls):
            return value
        return cls(str(value).lower())


# Permission policy for harness tool use in a headless run. ``auto`` approves (tools are
# backend-resolved and trusted, no human to prompt); ``deny`` rejects.
PermissionPolicy = str  # "auto" | "deny"


# ---------------------------------------------------------------------------
# Capabilities
# ---------------------------------------------------------------------------


class HarnessCapabilities(BaseModel):
    """What a harness can do, probed by the backend (rivet ``AgentCapabilities``).

    Adapters branch on these flags rather than the harness name (no ``if pi``): deliver
    tools over MCP only when ``mcp_tools`` is set, skip image blocks without ``images``.
    """

    text_messages: bool = True
    images: bool = False
    file_attachments: bool = False
    mcp_tools: bool = False
    tool_calls: bool = False
    reasoning: bool = False
    plan_mode: bool = False
    permissions: bool = False
    usage: bool = False
    streaming_deltas: bool = False
    session_lifecycle: bool = False

    @classmethod
    def from_wire(
        cls, data: Optional[Dict[str, Any]]
    ) -> Optional["HarnessCapabilities"]:
        """Parse the camelCase capability object an adapter returns. ``None`` passes through."""
        if not isinstance(data, dict):
            return None
        return cls(
            text_messages=bool(data.get("textMessages", True)),
            images=bool(data.get("images", False)),
            file_attachments=bool(data.get("fileAttachments", False)),
            mcp_tools=bool(data.get("mcpTools", False)),
            tool_calls=bool(data.get("toolCalls", False)),
            reasoning=bool(data.get("reasoning", False)),
            plan_mode=bool(data.get("planMode", False)),
            permissions=bool(data.get("permissions", False)),
            usage=bool(data.get("usage", False)),
            streaming_deltas=bool(data.get("streamingDeltas", False)),
            session_lifecycle=bool(data.get("sessionLifecycle", False)),
        )


# ---------------------------------------------------------------------------
# Turn input: content blocks and messages
# ---------------------------------------------------------------------------


class ContentBlock(BaseModel):
    """One piece of a message, mirroring the ACP content-block kinds.

    ``text`` is the only kind callers send today; ``image`` and ``resource`` are plumbed so
    an image-capable harness can take them. A bare string normalizes to a single ``text``
    block on the wire.
    """

    type: str  # "text" | "image" | "resource"
    text: Optional[str] = None
    data: Optional[str] = None  # base64 payload, used when type != "text"
    mime_type: Optional[str] = None
    uri: Optional[str] = None

    def to_wire(self) -> Dict[str, Any]:
        block: Dict[str, Any] = {"type": self.type}
        if self.text is not None:
            block["text"] = self.text
        if self.data is not None:
            block["data"] = self.data
        if self.mime_type is not None:
            block["mimeType"] = self.mime_type
        if self.uri is not None:
            block["uri"] = self.uri
        return block

    @classmethod
    def from_raw(cls, raw: Any) -> "ContentBlock":
        """Coerce a loose block (string or dict) into a ContentBlock."""
        if isinstance(raw, ContentBlock):
            return raw
        if isinstance(raw, str):
            return cls(type="text", text=raw)
        if isinstance(raw, dict):
            return cls(
                type=str(raw.get("type", "text")),
                text=raw.get("text"),
                data=raw.get("data"),
                mime_type=raw.get("mimeType") or raw.get("mime_type"),
                uri=raw.get("uri"),
            )
        return cls(type="text", text=str(raw))


# A message's content is either a plain string or a list of content blocks.
MessageContent = Union[str, List[ContentBlock]]


class Message(BaseModel):
    """A chat message in the conversation. ``content`` is text or content blocks.

    This is the runtime's own message type, distinct from the SDK's prompt ``Message``
    (``agenta.Message``); the two serve different layers.
    """

    role: str
    content: MessageContent = ""

    def to_wire(self) -> Dict[str, Any]:
        if isinstance(self.content, str):
            content: Any = self.content
        else:
            content = [block.to_wire() for block in self.content]
        return {"role": self.role, "content": content}

    @classmethod
    def from_raw(cls, raw: Any) -> Optional["Message"]:
        """Coerce a loose dict (the playground's message shape) into a Message."""
        if isinstance(raw, Message):
            return raw
        if not isinstance(raw, dict) or "role" not in raw:
            return None
        content = raw.get("content", "")
        if isinstance(content, list):
            content = [ContentBlock.from_raw(block) for block in content]
        return cls(role=str(raw["role"]), content=content)


def to_messages(raw: Optional[List[Any]]) -> List[Message]:
    """Coerce a list of loose message dicts into :class:`Message` objects."""
    messages: List[Message] = []
    for item in raw or []:
        message = Message.from_raw(item)
        if message is not None:
            messages.append(message)
    return messages


# ---------------------------------------------------------------------------
# Run events
# ---------------------------------------------------------------------------


class AgentEvent(BaseModel):
    """One structured event from a run, mapped from an ACP ``session/update``.

    ``type`` is one of ``message``, ``thought``, ``tool_call``, ``tool_result``, ``usage``,
    ``error``, ``done``. ``data`` carries the rest verbatim.
    """

    type: str
    data: Dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def from_wire(cls, raw: Any) -> Optional["AgentEvent"]:
        if not isinstance(raw, dict) or not raw.get("type"):
            return None
        return cls(type=str(raw["type"]), data=raw)


# A live event sink. Synchronous: adapters invoke it as events arrive (or as a batch).
EventSink = Callable[[AgentEvent], None]


# ---------------------------------------------------------------------------
# Cross-boundary plumbing
# ---------------------------------------------------------------------------


class TraceContext(BaseModel):
    """Agenta trace context threaded into a harness run, so it nests under the caller's
    workflow span. All fields optional; with none set the run traces standalone (or not at
    all), the standalone-SDK case."""

    traceparent: Optional[str] = None
    baggage: Optional[str] = None
    endpoint: Optional[str] = None  # OTLP traces URL
    authorization: Optional[str] = None  # full Authorization header value
    capture_content: bool = True

    def to_wire(self) -> Dict[str, Any]:
        return {
            "traceparent": self.traceparent,
            "baggage": self.baggage,
            "endpoint": self.endpoint,
            "authorization": self.authorization,
            "captureContent": self.capture_content,
        }


class ToolCallback(BaseModel):
    """How a harness routes a tool call back through Agenta's ``/tools/call``. The provider
    key and connection auth stay server-side. Empty for a standalone run with no
    Agenta-resolved tools."""

    endpoint: str  # full ``/tools/call`` URL
    authorization: Optional[str] = None

    def to_wire(self) -> Dict[str, Any]:
        return {"endpoint": self.endpoint, "authorization": self.authorization}


# ---------------------------------------------------------------------------
# Run result
# ---------------------------------------------------------------------------


class AgentResult(BaseModel):
    """A run's reply plus structured metadata. ``output`` is the final assistant text;
    ``usage`` rolls token/cost onto a workflow span; ``capabilities`` is what the harness
    was probed to support."""

    output: str = ""
    messages: List[Message] = Field(default_factory=list)
    events: List[AgentEvent] = Field(default_factory=list)
    usage: Optional[Dict[str, Any]] = None
    stop_reason: Optional[str] = None
    capabilities: Optional[HarnessCapabilities] = None
    session_id: Optional[str] = None
    model: Optional[str] = None
    trace_id: Optional[str] = None


# ---------------------------------------------------------------------------
# The neutral agent definition + run selection
# ---------------------------------------------------------------------------


class AgentConfig(BaseModel):
    """What an agent IS, independent of where or how it runs. ``instructions`` becomes
    ``AGENTS.md``. ``tools`` are provider-agnostic references; resolving them into runnable
    specs is the caller's job (the Agenta service does it server-side).

    ``harness_options`` is the neutral config's one escape hatch: a map keyed by harness
    name (``"pi"``, ``"claude"``) whose value is a free-form bag of knobs only that harness
    understands, for example Pi's ``system`` / ``append_system`` prompt overrides. The
    config stays harness-agnostic because each Harness adapter reads only its own slice and
    ignores the rest; a key for a harness that is not running is simply never looked at.
    """

    instructions: Optional[str] = None
    model: Optional[str] = None
    tools: List[Any] = Field(default_factory=list)
    harness_options: Dict[str, Dict[str, Any]] = Field(default_factory=dict)

    @classmethod
    def from_params(
        cls,
        params: Dict[str, Any],
        *,
        defaults: Optional["AgentConfig"] = None,
    ) -> "AgentConfig":
        """Build an :class:`AgentConfig` from a request/config dict.

        Accepts three shapes, in priority order: the dedicated ``agent`` element, the
        playground ``prompt`` prompt-template (system message -> instructions, ``llm_config``
        -> model + tools), and a flat ``{model, agents_md, tools}``. Unset fields fall back
        to ``defaults``. ``harness_options`` is read from the ``agent`` element (or the flat
        request) when present.
        """
        base = defaults or cls()
        instructions, model, tools = _parse_agent_fields(params, base)
        return cls(
            instructions=instructions,
            model=model,
            tools=_as_list(tools),
            harness_options=_parse_harness_options(params, base),
        )


class RunSelection(BaseModel):
    """The run-time choices stored next to the agent config: which harness, which sandbox,
    the permission policy. Read by the caller to pick a backend and harness class;
    deliberately not part of the neutral :class:`AgentConfig`."""

    harness: str = "pi"
    sandbox: str = "local"
    permission_policy: PermissionPolicy = "auto"

    @classmethod
    def from_params(
        cls,
        params: Dict[str, Any],
        *,
        default_harness: str = "pi",
        default_sandbox: str = "local",
    ) -> "RunSelection":
        agent = params.get("agent")
        source = agent if isinstance(agent, dict) else params
        return cls(
            harness=str(source.get("harness") or default_harness).lower(),
            sandbox=str(source.get("sandbox") or default_sandbox).lower(),
            permission_policy=str(source.get("permission_policy") or "auto").lower(),
        )


# ---------------------------------------------------------------------------
# Per-harness configs (what an adapter consumes)
# ---------------------------------------------------------------------------


class HarnessAgentConfig(BaseModel):
    """Base for a harness-specific config. A Harness produces one of these from the neutral
    config; a backend plumbs it as-is, with no business logic about how the harness works.

    The two subclasses differ in their *shape*, not just their identity, because the
    harnesses differ: Pi takes built-in tool names plus native tool specs and never gates
    tool use; Claude has no built-ins, delivers tools over MCP, and gates tool use behind a
    permission policy. ``wire_tools`` is where each config emits its own tool/permission
    fields for the ``/run`` payload.
    """

    harness: ClassVar[HarnessType]

    agents_md: Optional[str] = None
    model: Optional[str] = None
    tool_callback: Optional[ToolCallback] = None

    def wire_tools(self) -> Dict[str, Any]:
        """The tool + permission fields this harness contributes to the ``/run`` payload."""
        raise NotImplementedError

    def wire_prompt(self) -> Dict[str, Any]:
        """The system-prompt fields this harness contributes to the ``/run`` payload. Empty
        by default; a harness that exposes prompt overrides (Pi) emits them here."""
        return {}


class PiAgentConfig(HarnessAgentConfig):
    """Pi's config. Built-in tools by name plus resolved specs delivered natively (Pi has no
    MCP; the runner registers them through the Pi extension). Pi does not gate tool use, so
    no permission policy applies.

    ``system`` and ``append_system`` are Pi's two system-prompt layers, distinct from
    ``agents_md``. ``system`` *replaces* Pi's built-in base prompt outright (Pi's ``SYSTEM.md``
    / ``--system-prompt``); ``append_system`` *adds* to the base prompt without replacing it
    (Pi's ``APPEND_SYSTEM.md`` / ``--append-system-prompt``). Both are independent of
    ``agents_md``: Pi still appends the AGENTS.md project context after the system prompt
    either way, so AGENTS.md remains the right home for project conventions and these are
    only for changing or extending Pi's base persona."""

    harness: ClassVar[HarnessType] = HarnessType.PI

    builtin_tools: List[str] = Field(default_factory=list)
    custom_tools: List[Dict[str, Any]] = Field(default_factory=list)
    system: Optional[str] = None
    append_system: Optional[str] = None

    def wire_tools(self) -> Dict[str, Any]:
        return {
            "tools": list(self.builtin_tools),
            "customTools": list(self.custom_tools),
            "toolCallback": self.tool_callback.to_wire()
            if self.tool_callback
            else None,
            "permissionPolicy": "auto",  # Pi never gates tool use
        }

    def wire_prompt(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        if self.system is not None:
            out["systemPrompt"] = self.system
        if self.append_system is not None:
            out["appendSystemPrompt"] = self.append_system
        return out


class ClaudeAgentConfig(HarnessAgentConfig):
    """Claude's config. No Pi built-ins; tools are delivered over MCP, and
    ``permission_policy`` answers Claude's tool-use prompts in a headless run."""

    harness: ClassVar[HarnessType] = HarnessType.CLAUDE

    custom_tools: List[Dict[str, Any]] = Field(default_factory=list)
    permission_policy: PermissionPolicy = "auto"

    def wire_tools(self) -> Dict[str, Any]:
        return {
            "tools": [],  # Claude has no Pi built-in tools
            "customTools": list(self.custom_tools),
            "toolCallback": self.tool_callback.to_wire()
            if self.tool_callback
            else None,
            "permissionPolicy": self.permission_policy,
        }


class AgentaAgentConfig(PiAgentConfig):
    """The Agenta harness's config. It *is* a Pi config (same engine, same tool delivery and
    system-prompt layers), plus the forced ``skills`` the Agenta harness always ships.

    ``skills`` are skill directory names the runner resolves against its bundled
    ``services/agent/skills/`` root and loads into Pi's resource loader, so they appear in the
    system prompt on every run."""

    harness: ClassVar[HarnessType] = HarnessType.AGENTA

    skills: List[str] = Field(default_factory=list)

    def wire_tools(self) -> Dict[str, Any]:
        # Same tool fields as Pi, plus the forced skill names the runner loads.
        return {**super().wire_tools(), "skills": list(self.skills)}


# ---------------------------------------------------------------------------
# The session bundle
# ---------------------------------------------------------------------------


class SessionConfig(BaseModel):
    """Everything one run needs except where it runs.

    ``agent`` is the neutral definition. ``secrets`` are provider keys injected as harness
    env, never written to the agent filesystem. The ``builtin_tools`` / ``custom_tools`` /
    ``tool_callback`` triple is the resolved tool delivery (Agenta produces it server-side;
    empty for a bare standalone run). Sandbox is intentionally absent: it is a
    backend/environment concern."""

    agent: AgentConfig
    secrets: Dict[str, str] = Field(default_factory=dict)
    permission_policy: PermissionPolicy = "auto"
    trace: Optional[TraceContext] = None
    session_id: Optional[str] = None
    builtin_tools: List[str] = Field(default_factory=list)
    custom_tools: List[Dict[str, Any]] = Field(default_factory=list)
    tool_callback: Optional[ToolCallback] = None


# ---------------------------------------------------------------------------
# Parsing helpers (ported from the agent service's inputs.py)
# ---------------------------------------------------------------------------


def _as_list(raw: Any) -> List[Any]:
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        return raw
    return []


def _parse_harness_options(
    params: Dict[str, Any],
    defaults: AgentConfig,
) -> Dict[str, Dict[str, Any]]:
    """Pull the per-harness options bag from a request/config dict, falling back to defaults.

    Reads ``harness_options`` from the ``agent`` element when present, else from the flat
    request. Keeps only well-formed entries (a harness name mapping to an options dict) and
    lower-cases the harness key so it matches :class:`HarnessType` values.
    """
    agent = params.get("agent")
    source = agent if isinstance(agent, dict) else params
    raw = source.get("harness_options")
    if not isinstance(raw, dict):
        return dict(defaults.harness_options)
    options: Dict[str, Dict[str, Any]] = {}
    for name, opts in raw.items():
        if isinstance(opts, dict):
            options[str(name).lower()] = dict(opts)
    return options or dict(defaults.harness_options)


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


def _parse_agent_fields(
    params: Dict[str, Any],
    defaults: AgentConfig,
) -> Tuple[Optional[str], Optional[str], Any]:
    """Pull (instructions, model, tools) from a request/config dict, with fallbacks."""
    agent = params.get("agent")
    if isinstance(agent, dict):
        return (
            agent.get("instructions") or defaults.instructions,
            agent.get("model") or defaults.model,
            agent.get("tools"),
        )

    prompt_cfg = params.get("prompt")
    if isinstance(prompt_cfg, dict):
        llm_config = prompt_cfg.get("llm_config") or {}
        model = llm_config.get("model") or defaults.model
        instructions = _system_text(prompt_cfg.get("messages")) or defaults.instructions
        raw_tools = llm_config.get("tools")
        if raw_tools is None:
            raw_tools = prompt_cfg.get("tools")
    else:
        model = params.get("model") or defaults.model
        instructions = params.get("agents_md") or defaults.instructions
        raw_tools = params.get("tools")

    if raw_tools is None:
        raw_tools = defaults.tools
    return instructions, model, raw_tools
