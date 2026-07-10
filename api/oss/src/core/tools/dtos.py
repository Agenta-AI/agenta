from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union
from uuid import UUID

from agenta.sdk.agents.tools import BuiltinToolConfig, GatewayToolConfig
from agenta.sdk.models.workflows import JsonSchemas
from pydantic import BaseModel, ConfigDict, Field

from oss.src.core.workflows.dtos import WorkflowRevisionDelta

from oss.src.core.gateway.catalog.dtos import (
    CatalogCategory,
    CatalogIntegration,
    CatalogProvider,
)
from oss.src.core.gateway.connections.dtos import (
    Connection,
    ConnectionCreate,
    ConnectionCreateData,
    ConnectionStatus,
)
from oss.src.core.shared.dtos import (
    Identifier,
    Json,
    Status,
)

# ---------------------------------------------------------------------------
# Tool Enums
# ---------------------------------------------------------------------------


class ToolProviderKind(str, Enum):
    COMPOSIO = "composio"
    AGENTA = "agenta"


class ToolAuthScheme(str, Enum):
    OAUTH = "oauth"
    API_KEY = "api_key"


# ---------------------------------------------------------------------------
# Tool Catalog
# ---------------------------------------------------------------------------

# Tags type for filtering tools by tag flags (e.g. {"important": true})
Tags = Optional[Dict[str, bool]]


class ToolCatalogAction(BaseModel):
    key: str
    #
    name: str
    description: Optional[str] = None
    #
    categories: List[str] = []
    logo: Optional[str] = None
    #
    # From the MCP behavioral hints: True (read-only), False (mutating), None (unknown).
    read_only: Optional[bool] = None


class ToolCatalogActionDetails(ToolCatalogAction):
    schemas: Optional[JsonSchemas] = None
    scopes: Optional[List[str]] = None


# Providers + integrations are SHARED across tools and triggers — defined once
# in gateway/catalog and inherited here so the tool-specific "details" leaves
# (nested actions) can extend them without duplicating the base shape.
class ToolCatalogIntegration(CatalogIntegration):
    auth_schemes: Optional[List[ToolAuthScheme]] = None


class ToolCatalogIntegrationDetails(ToolCatalogIntegration):
    actions: Optional[List[ToolCatalogAction]] = None


class ToolCatalogCategory(CatalogCategory):
    pass


class ToolCatalogProvider(CatalogProvider):
    key: ToolProviderKind


class ToolCatalogProviderDetails(ToolCatalogProvider):
    integrations: Optional[List[ToolCatalogIntegration]] = None


class ToolCatalogIntegrationsPage(BaseModel):
    """A cursor-paginated page of tool integrations."""

    integrations: List[ToolCatalogIntegration] = []
    next_cursor: Optional[str] = None
    total: int = 0


class ToolCatalogActionsPage(BaseModel):
    """A cursor-paginated page of tool actions."""

    actions: List[ToolCatalogAction] = []
    next_cursor: Optional[str] = None
    total: int = 0


# ---------------------------------------------------------------------------
# Tool Connections — shared `gateway_connections` rows, inherited here so the
# tools router/models never reference the generic gateway DTOs directly.
# ---------------------------------------------------------------------------


class ToolConnectionStatus(ConnectionStatus):
    pass


class ToolConnectionCreateData(ConnectionCreateData):
    auth_scheme: Optional[ToolAuthScheme] = None


class ToolConnection(Connection):
    provider_key: ToolProviderKind
    status: Optional[ToolConnectionStatus] = None


class ToolConnectionCreate(ConnectionCreate):
    provider_key: ToolProviderKind
    data: Optional[ToolConnectionCreateData] = None


# ---------------------------------------------------------------------------
# Tool Calls
# ---------------------------------------------------------------------------


class ToolCallFunction(BaseModel):
    """Mirrors OpenAI function call: {name, arguments}."""

    name: str  # ~ tool.slug
    arguments: Any  # JSON string (as returned by LLM) or parsed dict


class ToolCallData(BaseModel):
    """OpenAI tool_calls array item — passed verbatim from the LLM."""

    id: str  # LLM call ID (e.g. "call_zEoV...")
    type: str = "function"
    function: ToolCallFunction


class ToolCall(BaseModel):
    """Request envelope — wraps the raw OpenAI tool call."""

    data: ToolCallData


class ToolResultData(BaseModel):
    """OpenAI tool message — passed verbatim back to the LLM."""

    role: str = "tool"
    tool_call_id: str  # Echoed from ToolCallData.id
    content: str  # Execution result serialised as a JSON string


class ToolResult(Identifier):
    """Response envelope with Agenta identity, status, and the OpenAI tool message."""

    status: Optional[Status] = None
    data: Optional[ToolResultData] = None


# ---------------------------------------------------------------------------
# Tool Execution (adapter-level DTOs)
# ---------------------------------------------------------------------------


class ToolExecutionRequest(BaseModel):
    """Input DTO for executing a tool action via a provider adapter."""

    integration_key: str
    action_key: str
    provider_connection_id: Optional[str] = None  # absent for no-auth toolkits
    user_id: Optional[str] = None
    arguments: Dict[str, Any] = {}


class ToolExecutionResponse(BaseModel):
    """Output DTO from executing a tool action via a provider adapter."""

    data: Optional[Json] = None
    error: Optional[str] = None
    successful: bool = False


# ---------------------------------------------------------------------------
# Tool references + resolution
# ---------------------------------------------------------------------------

# A provider-agnostic list of tool references lives under an agent revision's
# ``parameters["tools"]``. Each entry is a discriminated union on ``type``: config
# holds references and display metadata only, never secrets. The backend resolves
# them into model-ready specs at invoke time (see ToolsService.resolve_tools).


BuiltinTool = BuiltinToolConfig
ComposioTool = GatewayToolConfig
ToolReference = Union[BuiltinToolConfig, GatewayToolConfig]


class ResolvedTool(BaseModel):
    """A runnable reference resolved into a model-ready tool spec.

    ``call_ref`` is the ``tools.{provider}.{integration}.{action}.{connection}`` slug
    the execution bridge sends back to ``POST /tools/call``.
    """

    name: str
    description: Optional[str] = None
    input_schema: Optional[Dict[str, Any]] = None
    call_ref: str
    read_only: Optional[bool] = None


class ToolsResolution(BaseModel):
    """Outcome of resolving a ``tools`` list.

    ``builtins`` pass straight into Pi's ``tools: string[]``; ``custom`` become Pi
    ``customTools`` whose ``execute`` routes through ``/tools/call``.
    """

    builtins: List[str] = Field(default_factory=list)
    custom: List[ResolvedTool] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Platform tool handlers (reserved ``tools.agenta.*`` ops) — test_run contract
# ---------------------------------------------------------------------------
#
# The request/response contract for the server-side ``test_run`` handler (see
# ``core/tools/platform_handlers.py`` for the orchestration and the registry).
# Every model forbids extra fields: the arguments come straight from a model
# tool call and must not smuggle unknown keys.


class TestRunTarget(BaseModel):
    """The workflow variant under test. Bound from run context by the runner
    (``$ctx.workflow.variant.id``), never chosen by the model."""

    model_config = ConfigDict(extra="forbid")

    workflow_variant_id: UUID


class TestRunInputs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: List[Dict[str, Any]]


class TestRunExpectations(BaseModel):
    """Checks that define a passing run. Without a ``terminal_tool`` the verdict can
    never be ``pass``, only ``unconfirmed``."""

    model_config = ConfigDict(extra="forbid")

    terminal_tool: Optional[str] = None


class TestRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: TestRunTarget
    inputs: TestRunInputs
    # In-memory only: the delta is applied to the resolved revision for this one run and
    # never committed. Its scope is restricted to the ``parameters`` tree (enforced by the
    # handler) so it cannot redirect the child invoke.
    delta: Optional[WorkflowRevisionDelta] = None
    expectations: Optional[TestRunExpectations] = None


class TestRunToolDigest(BaseModel):
    """Per-tool observation, merged from transcript messages and trace spans.

    ``error`` is excluded from the payload: it only feeds the verdict, so a transient
    span-read failure cannot leak a false error flag to the model."""

    name: str
    called: bool = True
    returned: bool = False
    error: bool = Field(default=False, exclude=True)


class TestRunResolved(BaseModel):
    """Execution metadata resolved by the child run (read from its spans)."""

    harness: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    connection_mode: Optional[str] = None


TestRunVerdict = Literal["pass", "incomplete", "unconfirmed", "failed"]


class TestRunResponse(BaseModel):
    output: str = ""
    tools: List[TestRunToolDigest] = Field(default_factory=list)
    approvals: List[str] = Field(default_factory=list)
    resolved: TestRunResolved = Field(default_factory=TestRunResolved)
    trace_id: Optional[str] = None
    test_id: Optional[str] = None
    verdict: TestRunVerdict
    verdict_reason: Optional[str] = None
    # Excluded from the payload: distinguishes "the child invoke never completed"
    # (timeout / non-2xx / no output) from a business-level failed verdict, so the API
    # boundary can set the outer ToolResult status accordingly.
    infra_failure: bool = Field(default=False, exclude=True)


# ---------------------------------------------------------------------------
# Tool discovery (discover_tools) — Agenta-native response contract
# ---------------------------------------------------------------------------
#
# ``discover_tools`` translates a Composio semantic search into Agenta terms so
# the agent never sees Composio. See ``docs/design/agent-workflows/projects/
# tool-discovery/design.md`` for the field-by-field mapping and the connection
# state machine, and ``core/tools/discovery.py`` for the translation itself.


class ToolConnectionState(str, Enum):
    """The connection state of one integration, derived per the design's state
    machine. ``ready`` reuses an existing connection; the other two need a human."""

    READY = "ready"  # an active+valid project connection exists; reuse it
    NEEDS_AUTH = "needs_auth"  # OAuth integration with no connection; initiate
    NEEDS_INPUT = "needs_input"  # API-key integration; collect a secret first


class DiscoveredTool(BaseModel):
    """A discovered tool, already shaped as a ``GatewayToolConfig`` plus the
    model-facing extras the setup agent needs. ``connection`` is filled only when
    the integration's state is ``ready``; otherwise the agent resolves it first.
    """

    type: Literal["gateway"] = "gateway"
    provider: str = "composio"
    integration: str
    action: str
    connection: Optional[str] = None  # filled only when state == ready
    input_schema: Optional[Dict[str, Any]] = None
    description: Optional[str] = None
    # The raw Composio slug, opaque and for debugging only — never the interface.
    provider_action: str


class DiscoveredAlternative(BaseModel):
    """A companion/prerequisite tool the one-line request omitted (Agenta-shaped)."""

    integration: str
    action: str
    description: Optional[str] = None
    provider_action: str


class CapabilityConnection(BaseModel):
    """The connection state for a capability's primary integration."""

    state: ToolConnectionState
    slug: Optional[str] = None  # present only when state == ready


class ConnectAffordance(BaseModel):
    """The Agenta create-connection call to run when a connection is missing.

    Speaks Agenta, not Composio: it points at ``POST /tools/connections/`` (which
    returns a ``redirect_url``), never at ``COMPOSIO_MANAGE_CONNECTIONS``.
    """

    endpoint: str = "POST /tools/connections/"
    body: Dict[str, Any]


class ConnectionRequirement(BaseModel):
    """One integration's connection state, deduped across the result."""

    integration: str
    state: ToolConnectionState
    slug: Optional[str] = None  # present only when state == ready
    connect: Optional[ConnectAffordance] = None  # present when not ready


class Capability(BaseModel):
    """One use_case resolved to a best-match tool, alternatives, and its state."""

    use_case: str
    integration: Optional[str] = None
    tool: Optional[DiscoveredTool] = None
    alternatives: List[DiscoveredAlternative] = Field(default_factory=list)
    connection: Optional[CapabilityConnection] = None
    difficulty: Optional[str] = None
    # Set when the use_case reads like a trigger/listen ask (D5 scope note).
    note: Optional[str] = None


class CapabilityGuidance(BaseModel):
    """Structured operating knowledge the setup agent composes into ``agents_md``.

    Composio slugs in the text are mapped to the same ``integration.action`` names
    used elsewhere, so nothing Composio leaks.
    """

    plan_steps: List[str] = Field(default_factory=list)
    pitfalls: List[str] = Field(default_factory=list)


class CapabilitiesResult(BaseModel):
    """The ``discover_tools`` response (Agenta-native)."""

    capabilities: List[Capability] = Field(default_factory=list)
    connections: List[ConnectionRequirement] = Field(default_factory=list)
    guidance: CapabilityGuidance = Field(default_factory=CapabilityGuidance)
    # True only when every primary-tool connection is ready (create-and-run now).
    ready: bool = False
    # Top-level scope notes, e.g. a trigger/listen ask that v1 does not cover (D5).
    notes: List[str] = Field(default_factory=list)
