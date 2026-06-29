"""Data contracts for the agent runtime (the DTO layer).

Everything the ports and adapters pass around: harness identity, capabilities, content
blocks, messages, run events, the run result, trace/tool-callback plumbing, the neutral
``AgentTemplate``, the per-harness configs a backend plumbs, and the ``SessionConfig`` bundle.

These are Pydantic models (the SDK already depends on Pydantic), kept neutral: an adapter
translates them to and from its engine's own shapes at its edge.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Callable, ClassVar, Dict, List, Literal, Optional, Tuple, Union

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from .connections import ModelRef, ResolvedConnection
from .mcp import (
    MCPServerConfig,
    ResolvedMCPServer,
    mcp_servers_to_wire,
    parse_mcp_server_configs,
)
from .skills import SkillTemplate, parse_skill_templates, skills_to_wire
from .tools import ToolCallback, ToolConfig, ToolSpec, coerce_tool_configs
from .tools.models import coerce_tool_spec


# ---------------------------------------------------------------------------
# Harness identity
# ---------------------------------------------------------------------------


class HarnessType(str, Enum):
    """The coding agent program a run drives. A backend declares which it supports.

    ``pi_core`` is plain Pi; ``pi_agenta`` is Pi with Agenta's forced skills, prompt, and
    policy. Both drive the same ``pi`` ACP agent in the runner; ``claude`` drives Claude Code.
    """

    PI = "pi_core"
    CLAUDE = "claude"
    CODEX = "codex"
    AGENTA = "pi_agenta"

    @classmethod
    def coerce(cls, value: "HarnessType | str") -> "HarnessType":
        """Accept either an enum or a loose string (the playground sends a string)."""
        if isinstance(value, cls):
            return value
        return cls(str(value).lower())


# ---------------------------------------------------------------------------
# Harness identity in the interface: a versioned slug + a display name
# ---------------------------------------------------------------------------

# The harness contract's versioned identity, in the repo's slug grammar
# (``agenta:<namespace>:<name>:v<N>``, mirroring ``agenta:builtin:agent:v0`` in
# ``engines/running/interfaces.py``). The namespace is ``harness`` and the trailing ``v0`` is
# bumped only when the harness contract shape breaks. This is purely the INTERFACE identity the
# agent_template schema advertises; the stored/wire harness VALUE stays the bare enum string
# (``pi_core`` / ``pi_agenta`` / ``claude``), which the runner reads as the runtime selector.


class HarnessIdentity(BaseModel):
    """One harness's interface identity: its bare value, versioned slug, and display name.

    ``value`` is the wire/runtime selector (the ``HarnessType`` value); ``slug`` is the
    versioned contract identity in the repo's slug grammar; ``name`` is the human-facing label
    the playground dropdown shows. This is the single source the agent_template schema builds the
    harness ``oneOf`` from, so the slug, name, and value never drift across the SDK, the service
    schema, and the frontend control."""

    value: str
    slug: str
    name: str


# One entry per ``HarnessType``. The slug version is ``v0`` for every harness today (the
# contract has not broken). ``HARNESS_IDENTITIES`` is the single source of truth.
HARNESS_IDENTITIES: List[HarnessIdentity] = [
    HarnessIdentity(
        value=HarnessType.PI.value,
        slug=f"agenta:harness:{HarnessType.PI.value}:v0",
        name="Pi",
    ),
    HarnessIdentity(
        value=HarnessType.AGENTA.value,
        slug=f"agenta:harness:{HarnessType.AGENTA.value}:v0",
        name="Pi (Agenta)",
    ),
    HarnessIdentity(
        value=HarnessType.CLAUDE.value,
        slug=f"agenta:harness:{HarnessType.CLAUDE.value}:v0",
        name="Claude Code",
    ),
    HarnessIdentity(
        value=HarnessType.CODEX.value,
        slug=f"agenta:harness:{HarnessType.CODEX.value}:v0",
        name="Codex",
    ),
]


# Permission policy for harness tool use in a headless run. ``auto`` approves (tools are
# backend-resolved and trusted, no human to prompt); ``deny`` rejects.
PermissionPolicy = Literal["auto", "deny"]


# ---------------------------------------------------------------------------
# Sandbox permission (Layer 2: the sandbox security boundary)
# ---------------------------------------------------------------------------


class NetworkEgress(BaseModel):
    """The sandbox's outbound-network policy. ``mode`` is ``on`` (allow all egress, the
    default), ``off`` (block all egress), or ``allowlist`` (allow only the CIDR ranges in
    ``allowlist``). This is *declared* config; the runner enforces it on the sandbox provider
    in a later slice."""

    mode: Literal["on", "off", "allowlist"] = "on"
    allowlist: List[str] = Field(
        default_factory=list
    )  # CIDR ranges; mode == "allowlist"


class SandboxPermission(BaseModel):
    """The sandbox security boundary an agent runs inside (authoring config, versioned).

    ``network`` is the outbound-egress policy; ``filesystem`` is declared but not enforced
    today; ``enforcement`` picks ``strict`` (fail the run when the boundary cannot be applied)
    or ``best_effort``. Optional on :class:`AgentTemplate`: an unset value never reaches the wire,
    so existing configs are unaffected."""

    network: NetworkEgress = Field(default_factory=NetworkEgress)
    filesystem: Optional[Literal["on", "readonly", "off"]] = (
        None  # declared, NOT enforced
    )
    enforcement: Literal["strict", "best_effort"] = "strict"

    def to_wire(self) -> Dict[str, Any]:
        """The nested camelCase ``sandboxPermission`` object for the ``/run`` payload. ``filesystem``
        is dropped when unset (it is declared, not enforced) so an unset field never rides the wire."""
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


# ---------------------------------------------------------------------------
# Capabilities
# ---------------------------------------------------------------------------


class HarnessCapabilities(BaseModel):
    """What a harness can do, probed by the sandbox-agent backend.

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

    ``tool_call`` / ``tool_result`` carriers (``tool_call_id``/``tool_name``/``input``/
    ``output``/``is_error``) hold a resolved tool turn for structured-message continuation:
    the ``/messages`` egress folds inbound UIMessage tool/approval parts into these so a
    cross-turn HITL reply replays as a real tool call plus its result, and the model resumes
    from the result instead of re-asking. Mirrors ``ContentBlock`` in
    ``services/agent/src/protocol.ts``.
    """

    type: str  # "text" | "image" | "resource" | "tool_call" | "tool_result"
    text: Optional[str] = None
    data: Optional[str] = None  # base64 payload, used when type != "text"
    mime_type: Optional[str] = None
    uri: Optional[str] = None
    # Tool-turn carriers (used by tool_call / tool_result blocks).
    tool_call_id: Optional[str] = None
    tool_name: Optional[str] = None
    input: Optional[Any] = None
    output: Optional[Any] = None
    is_error: Optional[bool] = None

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
        if self.tool_call_id is not None:
            block["toolCallId"] = self.tool_call_id
        if self.tool_name is not None:
            block["toolName"] = self.tool_name
        if self.input is not None:
            block["input"] = self.input
        if self.output is not None:
            block["output"] = self.output
        if self.is_error is not None:
            block["isError"] = self.is_error
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
                tool_call_id=raw.get("toolCallId") or raw.get("tool_call_id"),
                tool_name=raw.get("toolName") or raw.get("tool_name"),
                input=raw.get("input"),
                output=raw.get("output"),
                is_error=raw.get("isError")
                if raw.get("isError") is not None
                else raw.get("is_error"),
            )
        return cls(type="text", text=str(raw))


# A message's content is either a plain string or a list of content blocks.
MessageContent = Union[str, List[ContentBlock]]


class Message(BaseModel):
    """A chat message in an agent-runtime conversation. ``content`` is text or content blocks.

    Two unrelated types share the name ``Message`` in this SDK, on purpose, for two layers:

    - this one — the agent runtime's conversation message, imported from
      ``agenta.sdk.agents`` (it is deliberately *not* re-exported as ``agenta.Message``);
    - the prompt-template message ``agenta.Message`` (``agenta.sdk.utils.types.Message``),
      used by the prompt/completion layer.

    They never appear together in the same call, so the namespacing (top-level vs.
    ``agenta.sdk.agents``) is what keeps them apart. Import the agents one explicitly when you
    need both in one module.
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


class Event(BaseModel):
    """One structured event from a run, mapped from an ACP ``session/update``.

    ``type`` is one of ``message``, ``thought``, ``tool_call``, ``tool_result``, ``usage``,
    ``error``, ``done``. ``data`` carries the rest verbatim.
    """

    type: str
    data: Dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def from_wire(cls, raw: Any) -> Optional["Event"]:
        if not isinstance(raw, dict) or not raw.get("type"):
            return None
        return cls(type=str(raw["type"]), data=raw)


# A live event sink. Synchronous: adapters invoke it as events arrive (or as a batch).
EventSink = Callable[[Event], None]


# ---------------------------------------------------------------------------
# Cross-boundary plumbing
# ---------------------------------------------------------------------------


class TraceContext(BaseModel):
    """The run's tracing inputs, captured once per turn and serialized into TWO role-separated wire
    objects (this is one capture, not one wire field).

    The fields below are the flat capture (what the service reads off the active span and env), but
    they play three different roles, so they ride the wire grouped by role rather than in one
    ``trace`` bucket (see the trace/telemetry interface restructure):

    - ``traceparent`` / ``baggage`` are per-call protocol CONTEXT (the W3C trace-context propagation
      headers, kept verbatim). They ride ``context.propagation`` via :meth:`context_to_wire`.
    - ``endpoint`` / ``authorization`` / ``capture_content`` are operator-owned telemetry CONFIG +
      POLICY + CREDENTIAL: where spans export, what is captured, and the exporter auth. They ride
      ``telemetry`` via :meth:`telemetry_to_wire`, with the credential nested under the exporter's
      ``headers`` rather than as a free-floating field.

    All fields optional; with none set the run traces standalone (or not at all), the
    standalone-SDK case."""

    traceparent: Optional[str] = None
    baggage: Optional[str] = None
    endpoint: Optional[str] = None  # OTLP traces URL
    authorization: Optional[str] = None  # full Authorization header value
    capture_content: bool = True

    def context_to_wire(self) -> Dict[str, Any]:
        """The per-call propagation CONTEXT (W3C ``traceparent`` / ``baggage``), grouped under
        ``context.propagation`` so it reads as protocol context, not config."""
        return {
            "propagation": {
                "traceparent": self.traceparent,
                "baggage": self.baggage,
            }
        }

    def telemetry_to_wire(self) -> Dict[str, Any]:
        """The telemetry CONFIG: the capture POLICY (``capture.content.enabled``) and the OTLP
        exporter destination (``exporters.otlp.endpoint``) with the CREDENTIAL nested under the
        exporter's standard ``authorization`` header."""
        return {
            "capture": {"content": {"enabled": self.capture_content}},
            "exporters": {
                "otlp": {
                    "endpoint": self.endpoint,
                    "headers": {"authorization": self.authorization},
                }
            },
        }


class RunContextReference(BaseModel):
    """One workflow entity inside :class:`RunContextWorkflow` — the artifact, the variant, or
    the revision (direct-call tools, Phase 3a).

    Mirrors the platform's canonical workflow reference shape (``{id, slug, version}``, the API's
    ``Reference``) so the run-context identity reads the same way the rest of the platform names a
    workflow entity. ``version`` is meaningful only for a revision; it stays unset on the artifact
    and the variant. All fields optional and best-effort."""

    id: Optional[str] = None
    slug: Optional[str] = None
    version: Optional[str] = None


class RunContextWorkflow(BaseModel):
    """The running workflow's own identity (direct-call tools, Phase 3a).

    Part of the per-turn :class:`RunContext` blob, grouped into the same three entities the
    platform uses for a workflow — the ``artifact`` (the workflow), the ``variant``, and the
    ``revision`` — each an ``{id, slug, version}`` :class:`RunContextReference`. A self-targeting
    platform tool binds one of these into its request body server-side (e.g.
    ``$ctx.workflow.variant.id`` for "update myself"), so the model supplies only the payload and
    cannot retarget a different variant. ``is_draft`` says whether the run targets a committed
    revision (``False``) or an uncommitted playground draft (``True``); it is inferred from whether
    a stored revision was referenced. All fields optional and best-effort: the service fills what
    it holds and omits the rest."""

    artifact: Optional[RunContextReference] = None
    variant: Optional[RunContextReference] = None
    revision: Optional[RunContextReference] = None
    is_draft: Optional[bool] = None


class RunContextTrace(BaseModel):
    """The current run's own trace identity (direct-call tools, Phase 3a).

    A tool that acts on the run's own trace (e.g. "annotate my trace") binds
    ``$ctx.trace.trace_id`` into its request body server-side."""

    trace_id: Optional[str] = None
    span_id: Optional[str] = None


class RunContext(BaseModel):
    """The run's own context, delivered on ``/run`` and refreshed per turn (direct-call tools,
    Phase 3a; see ``projects/direct-call-tools/run-context.md``).

    The service computes this from the invocation's own trace + workflow identity and sends it on
    the ``/run`` request. It is consumed ONLY by a tool's ``call.context`` binding: the runner
    fills bound request fields from this blob at dispatch, server-side and hidden from the model.
    The model never reads run context directly.

    The inner keys are deliberately snake_case (``workflow.variant.id``, ``trace.trace_id``): they
    are the binding NAMESPACE that a catalog entry's ``$ctx.<dotted.path>`` token addresses, so
    they match those tokens exactly rather than the wire's camelCase convention. The conversation
    id is NOT carried here — it rides the top-level ``sessionId`` field, and the runner owns the
    live id across turns; duplicating it in run context would only let it go stale. ``to_wire``
    emits only the sub-objects/fields that are set, so a run with no identity yields an empty blob
    (and the serializer omits the key entirely)."""

    workflow: Optional[RunContextWorkflow] = None
    trace: Optional[RunContextTrace] = None

    def to_wire(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        if self.workflow is not None:
            workflow: Dict[str, Any] = {}
            for entity in ("artifact", "variant", "revision"):
                reference = getattr(self.workflow, entity)
                if reference is not None:
                    fields = {
                        key: value
                        for key, value in reference.model_dump().items()
                        if value is not None
                    }
                    if fields:
                        workflow[entity] = fields
            if self.workflow.is_draft is not None:
                workflow["is_draft"] = self.workflow.is_draft
            if workflow:
                out["workflow"] = workflow
        if self.trace is not None:
            trace = {
                key: value
                for key, value in self.trace.model_dump().items()
                if value is not None
            }
            if trace:
                out["trace"] = trace
        return out


# ---------------------------------------------------------------------------
# Run result
# ---------------------------------------------------------------------------


class AgentResult(BaseModel):
    """A run's reply plus structured metadata. ``output`` is the final assistant text;
    ``usage`` rolls token/cost onto a workflow span; ``capabilities`` is what the harness
    was probed to support."""

    output: str = ""
    messages: List[Message] = Field(default_factory=list)
    events: List[Event] = Field(default_factory=list)
    usage: Optional[Dict[str, Any]] = None
    stop_reason: Optional[str] = None
    capabilities: Optional[HarnessCapabilities] = None
    session_id: Optional[str] = None
    model: Optional[str] = None
    trace_id: Optional[str] = None


# ---------------------------------------------------------------------------
# The neutral agent definition + run selection
# ---------------------------------------------------------------------------


class AgentTemplate(BaseModel):
    """What an agent is and how it runs — the parsed agent template. ``instructions`` becomes
    ``AGENTS.md``. ``tools`` are provider-agnostic references; resolving them into runnable
    specs is the caller's job (the Agenta service does it server-side).

    The authoring template is one object at ``parameters.agent``: the definition flat
    (instructions/llm/tools/mcps/skills) plus nested ``harness`` / ``runner`` / ``sandbox`` sections
    (see ``big-agents-audit/agent-template-migration.md``). This runtime model is the FLATTENED parse
    of it: the harness adapters and ``wire_*`` methods read these flat fields. ``from_params`` reads
    the template and projects it here.

    ``harness`` / ``sandbox`` / ``permission_policy`` are the execution selectors: which coding
    agent to drive (``harness.kind``), where it runs (``sandbox.kind``), and how a
    permission-gating harness answers a tool-use interaction in a headless run
    (``runner.interactions.headless``). ``sandbox`` is a backend/environment concern the caller
    reads to pick a backend; it never enters the neutral run.

    ``harness_permissions`` is the selected harness's first-class allow/ask/deny posture (was
    ``harness_kwargs.<gating-harness>.permissions``); a gating harness (Claude) renders it into
    its settings. ``harness_extras`` is the selected harness's escape-hatch bag (was the keyed
    ``harness_kwargs`` slice), e.g. Pi's ``system`` / ``append_system`` prompt overrides. Only
    the selected harness's slice is carried — the keyed-by-harness bag collapses at parse time.
    """

    model_config = ConfigDict(populate_by_name=True)

    instructions: Optional[str] = None
    # ``model`` is the plain string every caller reads and hands to a harness. ``model_ref`` is
    # the structured provider/model/connection ref, populated only when the incoming model is
    # structured (a dict or a ``ModelRef``); a plain string leaves it ``None`` so a string-only
    # config's wire is byte-identical. See ``_split_model_ref`` and the provider-model-auth design.
    model: Optional[str] = None
    model_ref: Optional[ModelRef] = None
    tools: List[ToolConfig] = Field(default_factory=list)
    mcp_servers: List[MCPServerConfig] = Field(default_factory=list)
    skills: List[SkillTemplate] = Field(default_factory=list)
    # The selected harness's slice (the keyed-by-harness bag collapses at parse time).
    harness_permissions: Dict[str, Any] = Field(default_factory=dict)
    harness_extras: Dict[str, Any] = Field(default_factory=dict)
    sandbox_permission: Optional[SandboxPermission] = None
    # The execution selectors: the coding agent to drive, where it runs, and the headless
    # interaction default (sourced from ``runner.interactions.headless``). The caller reads
    # ``harness`` / ``sandbox`` to pick a harness class and backend; ``permission_policy`` is the
    # headless answer a gating harness (Claude) consults.
    harness: str = "pi_core"
    sandbox: str = "local"
    permission_policy: PermissionPolicy = "auto"

    @model_validator(mode="before")
    @classmethod
    def _coerce_model_ref(cls, data: Any) -> Any:
        return _split_model_ref(data)

    @field_validator("tools", mode="before")
    @classmethod
    def _coerce_tools(cls, value: Any) -> List[ToolConfig]:
        return coerce_tool_configs(_as_list(value)).tool_configs

    @field_validator("mcp_servers", mode="before")
    @classmethod
    def _coerce_mcp_servers(cls, value: Any) -> List[MCPServerConfig]:
        return parse_mcp_server_configs(_as_list(value))

    @field_validator("skills", mode="before")
    @classmethod
    def _coerce_skills(cls, value: Any) -> List[SkillTemplate]:
        return parse_skill_templates(_as_list(value))

    @classmethod
    def from_params(
        cls,
        params: Dict[str, Any],
        *,
        defaults: Optional["AgentTemplate"] = None,
    ) -> "AgentTemplate":
        """Build an :class:`AgentTemplate` from a request/config dict.

        Accepts two shapes, in priority order: the agent template at ``parameters.agent``
        (``{instructions, llm, tools, mcps, skills, harness, runner, sandbox}``), and the playground
        ``prompt`` prompt-template (system message -> instructions, ``llm_config`` -> model + tools)
        for a bare chat run. Unset fields fall back to ``defaults``. The execution selectors are read
        from the template's nested ``harness`` / ``runner`` / ``sandbox`` sections; the selected
        harness's ``permissions`` / ``extras`` collapse onto the flat ``harness_permissions`` /
        ``harness_extras`` here.
        """
        base = defaults or cls()
        instructions, model, tools = _parse_agent_fields(params, base)
        harness, sandbox, permission_policy = _parse_run_selection(params, base)
        harness_permissions, harness_extras = _parse_harness_slice(params, base)
        return cls(
            instructions=instructions,
            model=model,
            tools=_as_list(tools),
            mcp_servers=_parse_mcp_servers_raw(params, base),
            skills=_parse_skills_raw(params, base),
            harness_permissions=harness_permissions,
            harness_extras=harness_extras,
            sandbox_permission=_parse_sandbox_permission(params, base),
            harness=harness,
            sandbox=sandbox,
            permission_policy=permission_policy,
        )


# ---------------------------------------------------------------------------
# Per-harness configs (what an adapter consumes)
# ---------------------------------------------------------------------------


class HarnessAgentTemplate(BaseModel):
    """Base for a harness-specific config. A Harness produces one of these from the neutral
    config; a backend plumbs it as-is, with no business logic about how the harness works.

    The two subclasses differ in their *shape*, not just their identity, because the
    harnesses differ: Pi takes built-in tool names plus native tool specs and never gates
    tool use; Claude has no built-ins, delivers tools over MCP, and gates tool use behind a
    permission policy. ``wire_tools`` is where each config emits its own tool/permission
    fields for the ``/run`` payload.
    """

    model_config = ConfigDict(populate_by_name=True)

    harness: ClassVar[HarnessType]

    agents_md: Optional[str] = None
    # ``model`` stays the back-compat plain string the adapter hands to the harness.
    # ``model_ref`` carries the structured ref when one is supplied; it is populated only from
    # structured input (a dict / a ``ModelRef``), so a plain-string ``model`` leaves it
    # ``None`` and the wire is unchanged. See :meth:`wire_model_ref`.
    model: Optional[str] = None
    model_ref: Optional[ModelRef] = None
    # ``resolved_connection`` carries the least-privilege output of a ``ConnectionResolver``
    # (threaded down from ``SessionConfig``). It is the authoritative source of the non-secret
    # provider/model descriptor on the wire when present; unset leaves the wire unchanged (the
    # golden contract). Its ``env`` is the secret channel and never reaches the wire here (it
    # rides ``secrets``). See :meth:`wire_resolved_connection`.
    resolved_connection: Optional[ResolvedConnection] = None
    tool_callback: Optional[ToolCallback] = None
    mcp_servers: List[ResolvedMCPServer] = Field(default_factory=list)
    skills: List[SkillTemplate] = Field(default_factory=list)
    sandbox_permission: Optional[SandboxPermission] = None
    # The selected harness's first-class allow/ask/deny posture, carried verbatim from
    # ``AgentTemplate.harness_permissions`` by the harness adapter. A gating harness's CONFIG renders
    # it into files for the wire (see :meth:`wire_harness_files`); the raw slice does not ride the
    # wire.
    harness_permissions: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _coerce_model_ref(cls, data: Any) -> Any:
        return _split_model_ref(data)

    @field_validator("mcp_servers", mode="before")
    @classmethod
    def _coerce_resolved_mcp_servers(cls, value: Any) -> List[ResolvedMCPServer]:
        return [
            item
            if isinstance(item, ResolvedMCPServer)
            else ResolvedMCPServer.model_validate(item)
            for item in value or []
        ]

    @field_validator("skills", mode="before")
    @classmethod
    def _coerce_skills(cls, value: Any) -> List[SkillTemplate]:
        return [
            item
            if isinstance(item, SkillTemplate)
            else SkillTemplate.model_validate(item)
            for item in value or []
        ]

    def wire_tools(self) -> Dict[str, Any]:
        """The tool + permission fields this harness contributes to the ``/run`` payload."""
        raise NotImplementedError

    def wire_prompt(self) -> Dict[str, Any]:
        """The system-prompt fields this harness contributes to the ``/run`` payload. Empty
        by default; a harness that exposes prompt overrides (Pi) emits them here."""
        return {}

    def wire_mcp(self) -> Dict[str, Any]:
        """The ``mcpServers`` field for the ``/run`` payload. Omitted when none are declared so
        a tool-free run's payload is unchanged (the golden wire contract)."""
        if not self.mcp_servers:
            return {}
        return {"mcpServers": mcp_servers_to_wire(self.mcp_servers)}

    def wire_skills(self) -> Dict[str, Any]:
        """The ``skills`` field for the ``/run`` payload. Skills are not tools, so they ride
        their own seam (sibling of :meth:`wire_mcp`). Omitted when none are declared so a
        skill-free run's payload is unchanged (the golden wire contract). Every entry is a
        resolved inline package by the time the wire is built."""
        if not self.skills:
            return {}
        return {"skills": skills_to_wire(self.skills)}

    def wire_sandbox_permission(self) -> Dict[str, Any]:
        """The ``sandboxPermission`` field for the ``/run`` payload. Omitted when unset so a
        run without a declared boundary is unchanged (the golden wire contract). Plumbing only:
        the runner does not enforce it yet (a later slice applies it on the sandbox provider)."""
        if self.sandbox_permission is None:
            return {}
        return {"sandboxPermission": self.sandbox_permission.to_wire()}

    def wire_harness_files(self) -> Dict[str, Any]:
        """The generic ``harnessFiles`` field for the ``/run`` payload: files this harness's config
        renders to drop in the session cwd before the session starts. Empty by default (Pi/Agenta
        render none), so a config that produces no files is unchanged (the golden wire contract).

        This is where the per-harness translation of the harness's first-class ``permissions`` /
        ``extras`` slice happens in Python (it used to happen in the TS runner). A harness that turns
        its own slice into a config file overrides this; the runner is then a dumb writer that
        materializes each ``{path, content}`` entry into the cwd (``path`` relative to cwd) and has
        no harness knowledge."""
        return {}

    def wire_model_ref(self) -> Dict[str, Any]:
        """The non-secret provider/connection fields for the ``/run`` payload.

        Empty when ``model_ref`` is unset, so a string-only config's payload is byte-identical
        to before (the golden wire contract). When a structured ref is present this emits only
        the fields known at config-build time: ``provider`` (when set) and ``connection`` (when
        it carries non-default info). ``deployment`` / ``endpoint`` / ``credentialMode`` come
        from a :class:`ResolvedConnection`, which Slice 1 does not yet thread, so they are not
        emitted here. The plain ``model`` string still rides the wire separately for back-compat.
        """
        if self.model_ref is None:
            return {}
        out: Dict[str, Any] = {}
        if self.model_ref.provider:
            out["provider"] = self.model_ref.provider
        connection = self.model_ref.connection
        # Two modes only: the project default is ``agenta`` with no slug and carries no info
        # beyond the model, so it is omitted (byte-identical wire). Emit the connection only when
        # it is ``self_managed`` or names a slug.
        is_default = connection.mode == "agenta" and connection.slug is None
        if not is_default:
            wire_connection: Dict[str, Any] = {"mode": connection.mode}
            if connection.slug is not None:
                wire_connection["slug"] = connection.slug
            out["connection"] = wire_connection
        return out

    def wire_resolved_connection(self) -> Dict[str, Any]:
        """The non-secret resolved-connection descriptor for the ``/run`` payload.

        Empty when ``resolved_connection`` is unset, so a config without a resolved connection
        is byte-identical to before (the golden wire contract). When a resolved connection is
        present this is the AUTHORITATIVE source of the provider/model descriptor: it emits
        ``provider``, ``model`` (the resolved exact model), ``deployment``, ``credentialMode``,
        and ``endpoint`` (via :meth:`ResolvedConnection.to_wire`, which NEVER emits ``env``). It
        is spread AFTER the base ``model`` and after :meth:`wire_model_ref` in
        ``request_to_wire``, so the resolved ``provider``/``model`` win over the config-build
        values while ``connection`` (the author's ``{mode, slug}`` intent) is preserved. The
        secret ``env`` rides the existing ``secrets`` wire field, never here."""
        if self.resolved_connection is None:
            return {}
        return self.resolved_connection.to_wire()


class PiAgentTemplate(HarnessAgentTemplate):
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

    builtin_names: List[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("builtin_names", "builtin_tools"),
    )
    tool_specs: List[ToolSpec] = Field(
        default_factory=list,
        validation_alias=AliasChoices("tool_specs", "custom_tools"),
    )
    system: Optional[str] = None
    append_system: Optional[str] = None

    @field_validator("tool_specs", mode="before")
    @classmethod
    def _coerce_tool_specs(cls, value: Any) -> List[ToolSpec]:
        return [coerce_tool_spec(item) for item in value or []]

    @property
    def builtin_tools(self) -> List[str]:
        return list(self.builtin_names)

    @property
    def custom_tools(self) -> List[Dict[str, Any]]:
        return [tool_spec.to_wire() for tool_spec in self.tool_specs]

    def wire_tools(self) -> Dict[str, Any]:
        return {
            "tools": list(self.builtin_names),
            "customTools": [tool_spec.to_wire() for tool_spec in self.tool_specs],
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


class ClaudeAgentTemplate(HarnessAgentTemplate):
    """Claude's config. No Pi built-ins; tools are delivered over MCP, and
    ``permission_policy`` answers Claude's tool-use prompts in a headless run."""

    harness: ClassVar[HarnessType] = HarnessType.CLAUDE

    tool_specs: List[ToolSpec] = Field(
        default_factory=list,
        validation_alias=AliasChoices("tool_specs", "custom_tools"),
    )
    permission_policy: PermissionPolicy = "auto"

    @field_validator("tool_specs", mode="before")
    @classmethod
    def _coerce_tool_specs(cls, value: Any) -> List[ToolSpec]:
        return [coerce_tool_spec(item) for item in value or []]

    @property
    def custom_tools(self) -> List[Dict[str, Any]]:
        return [tool_spec.to_wire() for tool_spec in self.tool_specs]

    def wire_tools(self) -> Dict[str, Any]:
        return {
            "tools": [],  # Claude has no Pi built-in tools
            "customTools": [tool_spec.to_wire() for tool_spec in self.tool_specs],
            "toolCallback": self.tool_callback.to_wire()
            if self.tool_callback
            else None,
            "permissionPolicy": self.permission_policy,
        }

    def wire_harness_files(self) -> Dict[str, Any]:
        """Render the Claude harness's permission settings into a ``.claude/settings.json`` file
        the runner drops in the cwd. This is the claude adapter (Layer 1 translation), done in
        Python: parse the author's first-class ``harness_permissions`` slice, merge the Layer-2
        ``sandbox_permission`` derivation, the per-MCP-server Layer-3 permissions, and the
        per-resolved-tool Layer-3 permissions (``tool_specs`` -> ``mcp__agenta-tools__<tool>`` rules,
        F-046), and emit one ``harnessFiles`` entry. The resolved-tool rules matter because Claude
        Code's own permission gate fires BEFORE the runner relay, so without an ``allow`` rule an
        ``allow`` tool always parks. Omitted when Claude has nothing to write (no author options and
        no derived rules), so a boundary-free Claude run is byte-identical to before."""
        # Lazy import: ``adapters.claude_settings`` is light, but importing it at module top would
        # run ``adapters/__init__`` (which imports the harness adapters, which import this module),
        # so it is imported here to keep ``dtos`` free of that cycle.
        from .adapters.claude_settings import build_claude_settings_files

        files = build_claude_settings_files(
            self.harness_permissions,
            self.sandbox_permission,
            self.mcp_servers,
            self.tool_specs,
        )
        if not files:
            return {}
        return {"harnessFiles": files}


class CodexAgentTemplate(HarnessAgentTemplate):
    """Codex's config. No Pi built-ins; tools are delivered over MCP, and
    ``permission_policy`` answers Codex's tool-use prompts in a headless run."""

    harness: ClassVar[HarnessType] = HarnessType.CODEX

    tool_specs: List[ToolSpec] = Field(
        default_factory=list,
        validation_alias=AliasChoices("tool_specs", "custom_tools"),
    )
    permission_policy: PermissionPolicy = "auto"

    @field_validator("tool_specs", mode="before")
    @classmethod
    def _coerce_tool_specs(cls, value: Any) -> List[ToolSpec]:
        return [coerce_tool_spec(item) for item in value or []]

    @property
    def custom_tools(self) -> List[Dict[str, Any]]:
        return [tool_spec.to_wire() for tool_spec in self.tool_specs]

    def wire_tools(self) -> Dict[str, Any]:
        return {
            "tools": [],  # Codex has no Pi built-in tools
            "customTools": [tool_spec.to_wire() for tool_spec in self.tool_specs],
            "toolCallback": self.tool_callback.to_wire()
            if self.tool_callback
            else None,
            "permissionPolicy": self.permission_policy,
        }


class AgentaAgentTemplate(PiAgentTemplate):
    """The Agenta harness's config. It *is* a Pi config (same engine, same tool delivery and
    system-prompt layers). ``skills`` ride the inherited :meth:`wire_skills` seam as resolved
    inline packages, not through ``wire_tools`` (skills are not tools)."""

    harness: ClassVar[HarnessType] = HarnessType.AGENTA


# ---------------------------------------------------------------------------
# The session bundle
# ---------------------------------------------------------------------------


class SessionConfig(BaseModel):
    """Everything one run needs except where it runs.

    ``agent`` is the agent definition. ``secrets`` are provider keys injected as harness
    env, never written to the agent filesystem. The ``builtin_tools`` / ``custom_tools`` /
    ``tool_callback`` triple is the resolved tool delivery (Agenta produces it server-side;
    empty for a bare standalone run). The agent config's ``sandbox`` field is a
    backend/environment concern: the caller reads it to pick a backend BEFORE the session is
    built, and the run itself never consumes it (no adapter reads ``agent.sandbox``)."""

    model_config = ConfigDict(populate_by_name=True)

    agent: AgentTemplate
    secrets: Dict[str, str] = Field(default_factory=dict)
    # ``resolved_connection`` carries the least-privilege output of a ``ConnectionResolver``.
    # ``secrets`` is the compatibility alias for ``resolved_connection.env`` during the
    # transition: Slice 1 still ships the credential through ``secrets`` on the wire.
    resolved_connection: Optional[ResolvedConnection] = None
    permission_policy: PermissionPolicy = "auto"
    trace: Optional[TraceContext] = None
    # The run's own context (trace + variant identity), refreshed per turn and consumed only by a
    # tool's ``call.context`` binding at dispatch (direct-call tools, Phase 3a). Omitted from the
    # wire when unset, so a run that needs no binding is byte-identical to before.
    run_context: Optional[RunContext] = None
    session_id: Optional[str] = None
    builtin_names: List[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("builtin_names", "builtin_tools"),
    )
    tool_specs: List[ToolSpec] = Field(
        default_factory=list,
        validation_alias=AliasChoices("tool_specs", "custom_tools"),
    )
    tool_callback: Optional[ToolCallback] = None
    mcp_servers: List[ResolvedMCPServer] = Field(default_factory=list)

    @field_validator("tool_specs", mode="before")
    @classmethod
    def _coerce_tool_specs(cls, value: Any) -> List[ToolSpec]:
        return [coerce_tool_spec(item) for item in value or []]

    @field_validator("mcp_servers", mode="before")
    @classmethod
    def _coerce_resolved_mcp_servers(cls, value: Any) -> List[ResolvedMCPServer]:
        return [
            item
            if isinstance(item, ResolvedMCPServer)
            else ResolvedMCPServer.model_validate(item)
            for item in value or []
        ]

    @property
    def builtin_tools(self) -> List[str]:
        return list(self.builtin_names)

    @property
    def custom_tools(self) -> List[Dict[str, Any]]:
        return [tool_spec.to_wire() for tool_spec in self.tool_specs]


# ---------------------------------------------------------------------------
# Parsing helpers (ported from the agent service's inputs.py)
# ---------------------------------------------------------------------------


def _as_list(raw: Any) -> List[Any]:
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        return raw
    return []


def _split_model_ref(data: Any) -> Any:
    """Populate ``model_ref`` from a structured ``model`` and keep ``model`` a plain string.

    Shared ``mode="before"`` validator body for :class:`AgentTemplate` and
    :class:`HarnessAgentTemplate`. The lowest-risk wiring (no behavior change in Slice 1):

    - ``model`` is a dict or a :class:`ModelRef` -> set ``model_ref`` from it and project
      ``model`` to its plain ``provider/model`` string. A structured config gains a typed ref
      and a back-compat string at once.
    - ``model`` is a plain string (bare or ``"provider/model"``) -> leave it as-is and leave
      ``model_ref`` ``None``. A string-only config is unchanged, so its wire stays
      byte-identical (the golden contract).

    An explicit ``model_ref`` already supplied is respected and never overwritten.
    """
    if not isinstance(data, dict):
        return data
    if data.get("model_ref") is not None:
        return data
    model = data.get("model")
    if isinstance(model, (ModelRef, dict)):
        ref = ModelRef.coerce(model)
        data = dict(data)
        data["model_ref"] = ref
        data["model"] = ref.to_model_string()
    return data


def _template(params: Dict[str, Any]) -> Dict[str, Any]:
    """The agent template value from a request dict, or ``{}``.

    The whole template sits at ``parameters.agent`` (the ``agent-template`` catalog type), exactly
    as the prompt template sits at ``parameters.prompt``. The portable definition
    (instructions/llm/tools/mcps/skills) is flat on it, and the execution parts (``harness`` /
    ``runner`` / ``sandbox``) are nested sub-objects. A caller may also pass the bare template
    directly (SDK use, resolved params), in which case ``params`` already holds the definition
    fields; the two are told apart by whether ``params["agent"]`` is itself a dict."""
    agent = params.get("agent")
    return agent if isinstance(agent, dict) else params


def _agent_element(params: Dict[str, Any]) -> Dict[str, Any]:
    """The agent template's definition fields (instructions/llm/tools/mcps/skills), or ``{}``."""
    return _template(params)


def _section(params: Dict[str, Any], key: str) -> Dict[str, Any]:
    """One execution section (``harness`` / ``runner`` / ``sandbox``) of the template, or ``{}``."""
    value = _template(params).get(key)
    return value if isinstance(value, dict) else {}


def _parse_mcp_servers_raw(
    params: Dict[str, Any],
    defaults: AgentTemplate,
) -> List[Any]:
    """Pull the raw ``mcps`` list from the nested ``agent`` element, falling back to defaults.

    Canonical validation happens on :class:`AgentTemplate` construction."""
    raw = _agent_element(params).get("mcps")
    if raw is None:
        return list(defaults.mcp_servers)
    return _as_list(raw)


def _parse_skills_raw(
    params: Dict[str, Any],
    defaults: AgentTemplate,
) -> List[Any]:
    """Pull the raw ``skills`` list from the nested ``agent`` element, falling back to defaults.

    Mirrors the MCP path so an unparsed ``skills`` is not silently dropped; canonical validation
    happens on :class:`AgentTemplate` construction. Each entry is a concrete inline ``SkillTemplate``
    by the time the request is built (any ``@ag.embed`` reference resolved server-side first)."""
    raw = _agent_element(params).get("skills")
    if raw is None:
        return list(defaults.skills)
    return _as_list(raw)


def _parse_harness_slice(
    params: Dict[str, Any],
    defaults: AgentTemplate,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Pull the selected harness's first-class ``permissions`` + escape-hatch ``extras``.

    Reads ``harness.permissions`` / ``harness.extras`` from the envelope. The keyed-by-harness
    bag is gone: the template carries only the selected harness's slice. An absent section falls
    back to ``defaults``; an explicit empty dict clears the inherited slice."""
    harness = _section(params, "harness")
    permissions = harness.get("permissions")
    extras = harness.get("extras")
    return (
        dict(permissions)
        if isinstance(permissions, dict)
        else dict(defaults.harness_permissions),
        dict(extras) if isinstance(extras, dict) else dict(defaults.harness_extras),
    )


def _parse_run_selection(
    params: Dict[str, Any],
    defaults: AgentTemplate,
) -> Tuple[str, str, "PermissionPolicy"]:
    """Pull the execution selectors (harness kind / sandbox kind / headless interaction default).

    ``harness`` from ``harness.kind``, ``sandbox`` from ``sandbox.kind``, and the headless
    permission default from ``runner.interactions.headless`` (was the flat ``permission_policy``).
    Falls back to ``defaults``. The kinds are lower-cased so a playground-supplied ``"Claude"`` /
    ``"Daytona"`` matches the bare :class:`HarnessType` / sandbox values the caller selects on."""
    harness = str(_section(params, "harness").get("kind") or defaults.harness).lower()
    sandbox = str(_section(params, "sandbox").get("kind") or defaults.sandbox).lower()
    interactions = _section(params, "runner").get("interactions")
    headless = interactions.get("headless") if isinstance(interactions, dict) else None
    permission_policy = str(headless or defaults.permission_policy).lower()
    return harness, sandbox, permission_policy


def _parse_sandbox_permission(
    params: Dict[str, Any],
    defaults: AgentTemplate,
) -> Optional[SandboxPermission]:
    """Pull the sandbox boundary from ``sandbox.permissions``, falling back to defaults.

    Validates the loose dict into a :class:`SandboxPermission`; an absent value stays ``None`` so
    it never reaches the wire (a boundary-free run is unchanged)."""
    raw = _section(params, "sandbox").get("permissions")
    if raw is None:
        return defaults.sandbox_permission
    if isinstance(raw, SandboxPermission):
        return raw
    if isinstance(raw, dict):
        return SandboxPermission.model_validate(raw)
    return defaults.sandbox_permission


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


def _model_from_llm(llm: Dict[str, Any]) -> Any:
    """Project the nested ``agent.llm`` object back to the ``model`` value the validator consumes.

    A plain ``{model: "gpt-5.5"}`` (no provider / connection / extras) projects to the bare string
    so ``model_ref`` stays ``None`` and the wire is byte-identical. A structured llm (any of
    ``provider`` / ``connection`` / non-empty ``extras`` present) projects to a ``ModelRef``-shaped
    dict (``params`` is the ModelRef field name for the ``extras`` knobs bag) so ``_split_model_ref``
    builds the typed ref."""
    model = llm.get("model")
    provider = llm.get("provider")
    connection = llm.get("connection")
    extras = llm.get("extras")
    structured = bool(provider) or bool(connection) or bool(extras)
    if not structured:
        return model
    ref: Dict[str, Any] = {"model": model}
    if provider:
        ref["provider"] = provider
    if connection:
        ref["connection"] = connection
    if extras:
        ref["extras"] = extras
    return ref


def _parse_agent_fields(
    params: Dict[str, Any],
    defaults: AgentTemplate,
) -> Tuple[Optional[str], Optional[str], Any]:
    """Pull (instructions, model, tools) from a request/config dict, with fallbacks.

    Two shapes: the agent template at ``parameters.agent`` (``instructions.agents_md`` / ``llm`` /
    ``tools`` flat on it), and the ``prompt`` prompt-template for a bare chat run. The agent-template
    shape wins when present; the prompt fallback applies only when there is no agent template."""
    has_template = isinstance(params.get("agent"), dict) or any(
        key in params for key in ("instructions", "llm", "tools", "mcps", "skills")
    )
    if has_template:
        agent = _template(params)
        instructions = agent.get("instructions")
        agents_md = (
            instructions.get("agents_md") if isinstance(instructions, dict) else None
        )
        llm = agent.get("llm")
        model = _model_from_llm(llm) if isinstance(llm, dict) else None
        return (
            agents_md or defaults.instructions,
            model if model is not None else defaults.model,
            agent.get("tools") if agent.get("tools") is not None else defaults.tools,
        )

    prompt_cfg = params.get("prompt")
    if isinstance(prompt_cfg, dict):
        llm_config = prompt_cfg.get("llm_config") or {}
        model = llm_config.get("model") or defaults.model
        instructions = _system_text(prompt_cfg.get("messages")) or defaults.instructions
        raw_tools = llm_config.get("tools")
        if raw_tools is None:
            raw_tools = prompt_cfg.get("tools")
        if raw_tools is None:
            raw_tools = defaults.tools
        return instructions, model, raw_tools

    return defaults.instructions, defaults.model, defaults.tools
