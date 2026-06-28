"""The ``/run`` wire contract as Pydantic models — the single schema source of truth.

These models describe the EXACT camelCase JSON the Python producer emits and parses in
``utils/wire.py`` (``request_to_wire`` / ``result_from_wire``) and the TS runner mirrors in
``services/agent/src/protocol.ts``. They are deliberately a SEPARATE set from the semantic
DTOs in ``dtos.py``: the DTOs are snake_case and intentionally loose (``Event`` is a free
``type: str`` + ``data`` bag), while the real wire is camelCase with a discriminated event
union. Exporting ``model_json_schema()`` off the DTOs would produce the wrong schema, so the
contract lives here.

What these models are for in this phase (a pre-production POC):

- They are the schema authority: ``run_contract_schemas()`` exports their JSON Schema, which
  ships in the SDK through ``CATALOG_TYPES`` (the same mechanism ``AgentTemplateSchema`` uses to
  reach the SDK / clients / ``/inspect``). A test asserts the committed catalog entry matches a
  fresh export, so the schema cannot drift from these models.
- They validate the golden fixtures and ``request_to_wire`` output in tests, proving the schema
  faithfully describes today's wire.

What they are NOT (deferred, per the project plan):

- They are NOT a runtime guard. ``request_to_wire`` still builds a plain dict and the runner
  still parses the body as-is; nothing validates against these models on a live ``/run``.
- They do NOT carry a contract ``version`` field, structured errors, or a ``cancelled`` outcome
  yet — those are deferred follow-ups. The result error stays the current free string.

Conventions: every field is camelCase via an alias, with ``populate_by_name=True`` so the
models also accept the Python field name. Optional fields default to ``None`` / empty, matching
the implicitly-all-optional wire. ``extra="allow"`` keeps the models forward-compatible (an
unknown field is not the schema's job to reject in this POC phase).
"""

from __future__ import annotations

from typing import Any, ClassVar, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


class _WireModel(BaseModel):
    """Base for every wire model: camelCase aliases, accept-by-name, allow extra.

    ``populate_by_name=True`` lets a producer construct with the Python field names while the
    schema and ``model_dump(by_alias=True)`` speak camelCase. ``extra="allow"`` keeps the
    contract open/forward-compatible (matching the runner's tolerant parsing); this POC does not
    reject unknown fields.

    ``__ag_type__`` is the catalog key a top-level model carries into ``CATALOG_TYPES`` (the
    same role :class:`~agenta.sdk.utils.types.AgSchemaMixin` plays for the other catalog types).
    It is NOT mixed in from ``utils/types`` on purpose: ``utils/types`` imports the agents
    package, so importing it here would create a load cycle. ``ag_type()`` reads the marker.
    """

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    __ag_type__: ClassVar[Optional[str]] = None

    @classmethod
    def ag_type(cls) -> str:
        if cls.__ag_type__ is None:
            raise ValueError(f"{cls.__name__} does not define __ag_type__")
        return cls.__ag_type__


# ---------------------------------------------------------------------------
# Shared sub-objects
# ---------------------------------------------------------------------------


class WireEndpoint(_WireModel):
    """Non-secret connection config (mirrors ``Endpoint.to_wire``)."""

    base_url: Optional[str] = Field(default=None, alias="baseUrl")
    api_version: Optional[str] = Field(default=None, alias="apiVersion")
    region: Optional[str] = None
    headers: Optional[Dict[str, str]] = None


class WireConnection(_WireModel):
    """The author's credential-connection intent (``{mode, slug?}``)."""

    mode: Literal["agenta", "self_managed"] = "agenta"
    slug: Optional[str] = None


class WireContentBlock(_WireModel):
    """One content block of a message (mirrors ``ContentBlock.to_wire``)."""

    type: str
    text: Optional[str] = None
    data: Optional[str] = None
    mime_type: Optional[str] = Field(default=None, alias="mimeType")
    uri: Optional[str] = None
    tool_call_id: Optional[str] = Field(default=None, alias="toolCallId")
    tool_name: Optional[str] = Field(default=None, alias="toolName")
    input: Optional[Any] = None
    output: Optional[Any] = None
    is_error: Optional[bool] = Field(default=None, alias="isError")


class WireChatMessage(_WireModel):
    """A chat message on the wire: ``{role, content}`` (string or content blocks)."""

    role: str
    content: Union[str, List[WireContentBlock]] = ""


class WireTraceContext(_WireModel):
    """Agenta trace context threaded into a run (mirrors ``TraceContext.to_wire``)."""

    traceparent: Optional[str] = None
    baggage: Optional[str] = None
    endpoint: Optional[str] = None
    authorization: Optional[str] = None
    capture_content: bool = Field(default=True, alias="captureContent")


class WireToolCallback(_WireModel):
    """Where callback (gateway) tools route their calls back to."""

    endpoint: Optional[str] = None
    authorization: Optional[str] = None


class WireRunContextReference(_WireModel):
    """One workflow entity (artifact / variant / revision) inside ``runContext.workflow``
    (mirrors ``RunContextReference``), the platform's ``{id, slug, version}`` reference shape.
    The keys stay snake_case on purpose — see ``WireRunContext``."""

    id: Optional[str] = None
    slug: Optional[str] = None
    version: Optional[str] = None


class WireRunContextWorkflow(_WireModel):
    """The running workflow identity inside ``runContext`` (mirrors ``RunContextWorkflow``),
    grouped into the platform's three workflow entities. The keys stay snake_case on purpose —
    see ``WireRunContext``."""

    artifact: Optional[WireRunContextReference] = None
    variant: Optional[WireRunContextReference] = None
    revision: Optional[WireRunContextReference] = None
    is_draft: Optional[bool] = None


class WireRunContextTrace(_WireModel):
    """The run's own trace identity inside ``runContext`` (mirrors ``RunContextTrace``)."""

    trace_id: Optional[str] = None
    span_id: Optional[str] = None


class WireRunContext(_WireModel):
    """The run's own context, delivered on ``/run`` and refreshed per turn (direct-call tools,
    Phase 3a; mirrors ``RunContext.to_wire``).

    Consumed only by a tool's ``call.context`` binding at dispatch, server-side and hidden from
    the model. Unlike the rest of the wire, the INNER keys are snake_case
    (``workflow.variant.id`` / ``trace.trace_id``): they are the binding NAMESPACE a catalog
    entry's ``$ctx.<dotted.path>`` token addresses, so they must match those tokens exactly rather
    than follow the camelCase wire convention. The conversation id is NOT carried here — it rides
    the top-level camelCase ``sessionId`` field. The top-level field is still the camelCase
    ``runContext`` on the request."""

    workflow: Optional[WireRunContextWorkflow] = None
    trace: Optional[WireRunContextTrace] = None


class WireRenderHint(_WireModel):
    """How a tool's result should be rendered by a client."""

    kind: Optional[str] = None
    component: Optional[str] = None


class WireToolCall(_WireModel):
    """The direct-call descriptor on a resolved tool (direct-call tools, Phase 1).

    Present on a callback tool instead of ``callRef`` when the runner should call an Agenta
    endpoint DIRECTLY (``call`` XOR ``callRef``). ``path`` is an absolute path from the Agenta
    origin; ``body`` are static server-fixed fields; ``context`` maps a dotted body path to a
    ``"$ctx.<key>"`` token the runner fills from the run context; ``args_into`` is the dotted path
    where the model's arguments are placed. All fields optional on the wire, matching the
    contract's implicitly-all-optional convention. Plumbing only in this phase: it rides the wire
    but nothing emits or dispatches it yet.
    """

    method: Optional[str] = None
    path: Optional[str] = None
    body: Optional[Dict[str, Any]] = None
    context: Optional[Dict[str, str]] = None
    args_into: Optional[str] = None


class WireResolvedToolSpec(_WireModel):
    """A resolved tool the runner delivers to the harness (the three-axis tool surface).

    ``kind`` is the executor axis (``callback`` / ``code`` / ``client`` / ``builtin``);
    ``needsApproval`` / ``render`` are the orthogonal axes; ``callRef`` / ``runtime`` / ``code``
    / ``env`` are executor-specific. ``call`` is the direct-call descriptor a callback tool carries
    instead of ``callRef`` (direct-call tools, Phase 1). Extra fields are allowed so an executor
    variant the schema has not enumerated still validates.
    """

    name: str
    description: Optional[str] = None
    input_schema: Optional[Dict[str, Any]] = Field(default=None, alias="inputSchema")
    kind: Optional[str] = None
    call_ref: Optional[str] = Field(default=None, alias="callRef")
    call: Optional[WireToolCall] = None
    runtime: Optional[str] = None
    code: Optional[str] = None
    env: Optional[Dict[str, str]] = None
    needs_approval: Optional[bool] = Field(default=None, alias="needsApproval")
    render: Optional[WireRenderHint] = None
    read_only: Optional[bool] = Field(default=None, alias="readOnly")
    permission: Optional[str] = None


class WireMcpServer(_WireModel):
    """A user-declared MCP server (stdio or http), mirrors ``mcp_servers_to_wire``."""

    name: str
    transport: Optional[str] = None
    command: Optional[str] = None
    args: Optional[List[str]] = None
    env: Optional[Dict[str, str]] = None
    url: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    tools: Optional[List[str]] = None
    permission: Optional[str] = None


class WireSkillFile(_WireModel):
    """One bundled file in a resolved inline skill package."""

    path: str
    content: str
    executable: Optional[bool] = None


class WireSkill(_WireModel):
    """A resolved inline skill package (mirrors ``skill_to_wire``)."""

    name: str
    description: Optional[str] = None
    body: Optional[str] = None
    files: Optional[List[WireSkillFile]] = None
    disable_model_invocation: Optional[bool] = Field(
        default=None, alias="disableModelInvocation"
    )
    allow_executable_files: Optional[bool] = Field(
        default=None, alias="allowExecutableFiles"
    )


class WireNetworkEgress(_WireModel):
    """The sandbox outbound-network policy (mirrors ``NetworkEgress``)."""

    mode: Literal["on", "off", "allowlist"] = "on"
    allowlist: List[str] = Field(default_factory=list)


class WireSandboxPermission(_WireModel):
    """The declared sandbox security boundary (mirrors ``SandboxPermission.to_wire``)."""

    network: WireNetworkEgress = Field(default_factory=WireNetworkEgress)
    filesystem: Optional[Literal["on", "readonly", "off"]] = None
    enforcement: Literal["strict", "best_effort"] = "strict"


class WireHarnessFile(_WireModel):
    """One file the active harness's config renders into the session cwd before a run."""

    path: str
    content: str


class WireHarnessCapabilities(_WireModel):
    """What a harness can do, probed by the runner (the 11 boolean flags)."""

    text_messages: bool = Field(default=True, alias="textMessages")
    images: bool = False
    file_attachments: bool = Field(default=False, alias="fileAttachments")
    mcp_tools: bool = Field(default=False, alias="mcpTools")
    tool_calls: bool = Field(default=False, alias="toolCalls")
    reasoning: bool = False
    plan_mode: bool = Field(default=False, alias="planMode")
    permissions: bool = False
    usage: bool = False
    streaming_deltas: bool = Field(default=False, alias="streamingDeltas")
    session_lifecycle: bool = Field(default=False, alias="sessionLifecycle")


class WireAgentUsage(_WireModel):
    """Token / cost usage rolled onto a workflow span."""

    input: Optional[int] = None
    output: Optional[int] = None
    total: Optional[int] = None
    cost: Optional[float] = None


# ---------------------------------------------------------------------------
# The event union (open / forward-compatible)
# ---------------------------------------------------------------------------


class WireEvent(_WireModel):
    """One structured event from a run, keyed by ``type``.

    The Python parser (``Event.from_wire``) keeps the whole event verbatim and drops a
    typeless event, so the wire event is intentionally OPEN: ``type`` is the discriminator and
    ``extra="allow"`` carries the rest. ``type`` is OPTIONAL on the model on purpose — a
    typeless event is dropped, not rejected (a golden pins exactly that), and the schema must
    describe that tolerance rather than reject it. A closed discriminated union would also reject
    the forward-compatible event types the runner may add, which contradicts the "drop unknown"
    guarantee. The known ``type`` values are documented for readers, not enforced: ``message``,
    ``thought``, the ``message_*`` / ``reasoning_*`` lifecycle trios, ``tool_call``,
    ``tool_result``, ``interaction_request``, ``data``, ``file``, ``usage``, ``error``, ``done``.
    """

    type: Optional[str] = None


# ---------------------------------------------------------------------------
# The request
# ---------------------------------------------------------------------------


class WireRunRequest(_WireModel):
    """The ``/run`` request payload — the exact field set ``request_to_wire`` may emit.

    Every field is optional on the wire (the contract is implicitly all-optional), so the schema
    expresses "optional" while the producer's omit-when-empty behavior stays in ``wire.py`` and
    is pinned by the golden fixtures. The harness selects the agent (``pi_core`` / ``pi_agenta``
    / ``claude``); there is no engine selector on the wire (A3 removed the legacy backend).
    """

    __ag_type__ = "run_request"

    harness: Optional[str] = None
    sandbox: Optional[str] = None
    session_id: Optional[str] = Field(default=None, alias="sessionId")
    agents_md: Optional[str] = Field(default=None, alias="agentsMd")
    # Model + connection. ``model`` stays a plain string; the structured provider/connection
    # fields ride alongside only when a resolved connection / model ref is present.
    model: Optional[str] = None
    provider: Optional[str] = None
    connection: Optional[WireConnection] = None
    deployment: Optional[str] = None
    endpoint: Optional[WireEndpoint] = None
    credential_mode: Optional[str] = Field(default=None, alias="credentialMode")
    # Turn.
    messages: Optional[List[WireChatMessage]] = None
    # Secrets injected as harness env (provider keys); never written to the agent filesystem.
    secrets: Optional[Dict[str, str]] = None
    trace: Optional[WireTraceContext] = None
    # The run's own context (trace + variant identity), refreshed per turn; consumed only by a
    # tool's ``call.context`` binding at dispatch (direct-call tools, Phase 3a). Omitted when unset.
    run_context: Optional[WireRunContext] = Field(default=None, alias="runContext")
    # Tools + skills.
    tools: Optional[List[str]] = None
    custom_tools: Optional[List[WireResolvedToolSpec]] = Field(
        default=None, alias="customTools"
    )
    tool_callback: Optional[WireToolCallback] = Field(
        default=None, alias="toolCallback"
    )
    mcp_servers: Optional[List[WireMcpServer]] = Field(default=None, alias="mcpServers")
    skills: Optional[List[WireSkill]] = None
    # Policy + prompt overrides + files.
    permission_policy: Optional[str] = Field(default=None, alias="permissionPolicy")
    system_prompt: Optional[str] = Field(default=None, alias="systemPrompt")
    append_system_prompt: Optional[str] = Field(
        default=None, alias="appendSystemPrompt"
    )
    sandbox_permission: Optional[WireSandboxPermission] = Field(
        default=None, alias="sandboxPermission"
    )
    harness_files: Optional[List[WireHarnessFile]] = Field(
        default=None, alias="harnessFiles"
    )


# ---------------------------------------------------------------------------
# The result
# ---------------------------------------------------------------------------


class WireRunResult(_WireModel):
    """The ``/run`` result payload — what ``result_from_wire`` parses.

    ``ok`` is the outcome flag; on failure ``error`` is the current free string (a structured
    error model is a deferred follow-up, not this phase). On success the run carries ``output``,
    ``messages``, ``events``, ``usage``, ``stopReason``, ``capabilities``, plus the resolved
    ``sessionId`` / ``model`` / ``traceId``.
    """

    __ag_type__ = "run_result"

    ok: bool
    output: Optional[str] = None
    messages: Optional[List[WireChatMessage]] = None
    events: Optional[List[WireEvent]] = None
    usage: Optional[WireAgentUsage] = None
    stop_reason: Optional[str] = Field(default=None, alias="stopReason")
    capabilities: Optional[WireHarnessCapabilities] = None
    session_id: Optional[str] = Field(default=None, alias="sessionId")
    model: Optional[str] = None
    trace_id: Optional[str] = Field(default=None, alias="traceId")
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# The exported JSON interface
# ---------------------------------------------------------------------------

# The top-level wire models whose JSON Schema ships in the SDK. Each is keyed by its
# ``x-ag-type`` so ``CATALOG_TYPES`` can carry it the same way it carries ``agent-template``.
WIRE_CONTRACT_MODELS = (WireRunRequest, WireRunResult)


def run_contract_schemas() -> Dict[str, Dict[str, Any]]:
    """The exported JSON Schema of the ``/run`` wire models, keyed by ``x-ag-type``.

    Uses ``model_json_schema(by_alias=True)`` so the emitted property names are the camelCase
    wire keys, and dereferences ``$defs`` (the same treatment ``CATALOG_TYPES`` gives every other
    entry, via ``_dereference_schema``) so the catalog entries are self-contained. This is the
    single export point: ``CATALOG_TYPES`` adds these entries, and a freshness test asserts the
    committed catalog matches a fresh call here so the schema cannot silently drift from the
    models.
    """
    # Local import to avoid a module-load cycle: ``utils/types`` imports the agents package.
    from ..utils.types import _dereference_schema

    schemas: Dict[str, Dict[str, Any]] = {}
    for model in WIRE_CONTRACT_MODELS:
        schema = _dereference_schema(model.model_json_schema(by_alias=True))
        schema["x-ag-type"] = model.ag_type()
        schemas[model.ag_type()] = schema
    return schemas
