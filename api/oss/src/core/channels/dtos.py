from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Set
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from oss.src.core.shared.dtos import (
    Header,
    Identifier,
    Lifecycle,
    Metadata,
    Reference,
    Slug,
    Status,
    Windowing,
)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class ChannelSpaceKind(str, Enum):
    PRIVATE = "private"
    GROUP = "group"
    TOPIC = "topic"


class ChannelEventKind(str, Enum):
    """The two kinds of thing an agent can be addressed by."""

    MESSAGE = "message"
    ACTION = "action"  # button click, reaction


class ChannelEventOrigin(str, Enum):
    """Who initiated the transfer — and therefore where the row sorts.

    Declared oldest-first: PULLED rows predate every PUSHED row, so
    `ORDER BY origin, id` is the log's true sequence.
    """

    PULLED = "pulled"  # we asked the platform for it (the history API)
    PUSHED = "pushed"  # the platform delivered it to our ingress


class ChannelTriggerKind(str, Enum):
    MENTION = "mention"
    COMMAND = "command"
    ACTION = "action"  # button, reaction, delegation


class ChannelSessionScope(str, Enum):
    THREAD = "thread"
    MESSAGE = "message"


# narrowest last; precedence picks the highest index any level stated
SESSION_SCOPE_ORDER = [ChannelSessionScope.THREAD, ChannelSessionScope.MESSAGE]


class ChannelPolicyLevel(str, Enum):
    CAPABILITY = "capability"  # the outermost; not editable
    CHANNEL = "channel"  # per-channel defaults
    AGENT = "agent"
    SPACE = "space"
    GRANT = "grant"


class ChannelTriggerState(str, Enum):
    """The fate of one turn. STARTED, not RUNNING: this column records what we
    did, not what is happening elsewhere."""

    STARTED = "started"  # we minted a turn and handed it to invoke
    SETTLED = "settled"  # the turn finished; the offset stands
    REFUSED = "refused"  # not granted, no agent, or an overlapping turn
    FAILED = "failed"


class ChannelDeliveryState(str, Enum):
    """Where one outbound message is in its life. CREATED, not PENDING: the row
    is inserted before the post is attempted."""

    CREATED = "created"  # row written, post not yet attempted
    SENT = "sent"  # the platform acknowledged; locator held
    FAILED = "failed"  # terminal after retries
    ABANDONED = "abandoned"  # we stopped trying — access revoked mid-thread


class ChannelKeyGrain(str, Enum):
    CONNECTION = "connection"
    SPACE = "space"
    THREAD = "thread"


class ChannelGrantEffect(str, Enum):
    ALLOW = "allow"
    DENY = "deny"


# ---------------------------------------------------------------------------
# Capability declaration
#
# Fetched from the adapter, normalised by core, never trusted.
# ---------------------------------------------------------------------------


class ChannelProtocol(BaseModel):
    versions: List[str] = Field(default_factory=list)


class ChannelSigils(BaseModel):
    agent: Optional[str] = None
    command: Optional[str] = None


class ChannelNativeCommands(BaseModel):
    native: bool = False
    # a platform can offer commands that do not work where you need them
    in_conversation: bool = False


class ChannelAddressing(BaseModel):
    sigils: ChannelSigils = Field(default_factory=ChannelSigils)
    mention: bool = False
    commands: ChannelNativeCommands = Field(default_factory=ChannelNativeCommands)


class ChannelSpacesSupport(BaseModel):
    private: bool = False
    group: bool = False
    topic: bool = False


class ChannelConversation(BaseModel):
    # vocabulary is {"thread", "space"} — ChannelKeyGrain, not the
    # policy-level ChannelSessionScope ({"thread", "message"}); a platform
    # with no threads degenerates to "space", never to "message"
    units: List[ChannelKeyGrain] = Field(default_factory=list)
    # applies when no policy level states a session_scope; must be in units
    default: ChannelKeyGrain = ChannelKeyGrain.SPACE


class ChannelFillMode(BaseModel):
    supported: bool = False
    # informational: names what an operator must grant; core does not interpret
    requires_permission: Optional[str] = None


class ChannelFill(BaseModel):
    backfill: ChannelFillMode = Field(default_factory=ChannelFillMode)
    forwardfill: ChannelFillMode = Field(default_factory=ChannelFillMode)


class ChannelControls(BaseModel):
    update: bool = False
    ephemeral: bool = False


class ChannelButtons(BaseModel):
    supported: bool = False
    max: int = 0


class ChannelText(BaseModel):
    format: Literal["markdown", "plain", "html"] = "plain"
    max_chars: int = 0


class ChannelFileDirection(BaseModel):
    supported: bool = False
    max_bytes: int = 0


class ChannelFiles(BaseModel):
    send: ChannelFileDirection = Field(default_factory=ChannelFileDirection)
    receive: ChannelFileDirection = Field(default_factory=ChannelFileDirection)


class ChannelRendering(BaseModel):
    controls: ChannelControls = Field(default_factory=ChannelControls)
    buttons: ChannelButtons = Field(default_factory=ChannelButtons)
    text: ChannelText = Field(default_factory=ChannelText)
    files: ChannelFiles = Field(default_factory=ChannelFiles)


class ChannelIdentity(BaseModel):
    scope: Optional[str] = None
    stable: bool = False
    # the field set compose_external_key reads, per grain
    keys: Dict[ChannelKeyGrain, List[str]] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Setup declaration
#
# Three slots, any of them empty: instructions we give, a document we
# generate, fields we ask for. Empty is a declaration, not a special case —
# Agenta fills none, Slack fills all three. `fields` is what the form
# renders; what is stored and valid is the CHANNEL_SECRET discriminator's
# job, so this list restates no type.
# ---------------------------------------------------------------------------


class ChannelSetupField(BaseModel):
    name: str
    label: str
    secret: bool = False
    required: bool = True
    help: Optional[str] = None


class ChannelSetupDoc(BaseModel):
    """What `build_setup_document` generates, request-url-dependent and so
    never baked into the static capability declaration."""

    format: str
    content: str
    filename: Optional[str] = None
    link: Optional[str] = None


class ChannelSetup(BaseModel):
    instructions: List[str] = Field(default_factory=list)
    document: Optional[ChannelSetupDoc] = None
    fields: List[ChannelSetupField] = Field(default_factory=list)


class ChannelCapabilities(BaseModel):
    channel: str
    protocol: ChannelProtocol = Field(default_factory=ChannelProtocol)
    #
    addressing: ChannelAddressing = Field(default_factory=ChannelAddressing)
    spaces: ChannelSpacesSupport = Field(default_factory=ChannelSpacesSupport)
    conversation: ChannelConversation = Field(default_factory=ChannelConversation)
    fill: ChannelFill = Field(default_factory=ChannelFill)
    rendering: ChannelRendering = Field(default_factory=ChannelRendering)
    identity: ChannelIdentity = Field(default_factory=ChannelIdentity)
    setup: ChannelSetup = Field(default_factory=ChannelSetup)
    #
    commands: List[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------


class ChannelConnectionFlags(BaseModel):
    is_active: bool = True
    # set once verification (a real call against the platform) succeeds;
    # an unverified connection is configured but not yet routable
    is_verified: bool = False


class ChannelAgentFlags(BaseModel):
    is_active: bool = True
    # the connection-wide fallback, used when there is no sigil and the space
    # names no default; at most one per connection
    is_default: bool = False


class ChannelSpaceFlags(BaseModel):
    is_active: bool = True
    # the one-time fetch happened here, including when it returned nothing
    is_backfilled: bool = False


class ChannelGrantFlags(BaseModel):
    # this agent answers this space when no sigil names anyone;
    # at most one per space
    is_default: bool = False


class ChannelThreadFlags(BaseModel):
    is_active: bool = True  # closed by !new, or by the space going inactive


class ChannelInboxEventFlags(BaseModel):
    """Empty today; the typed model makes the first flag a DTO change."""


class ChannelInboxTriggerFlags(BaseModel):
    # did THIS turn's input include fetched history?
    is_backfilled: bool = False


class ChannelOutboxEventFlags(BaseModel):
    """Empty today, same reason as the inbox event flags."""


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------


class ChannelPolicy(BaseModel):
    """What one level STATED. Every field optional; None means no opinion."""

    triggers: Optional[Set[ChannelTriggerKind]] = None
    session_scope: Optional[ChannelSessionScope] = None
    backfill: Optional[bool] = None
    forwardfill: Optional[bool] = None


class ChannelEffectivePolicy(BaseModel):
    """What the intersection DECIDED. Every field present, none optional."""

    triggers: Set[ChannelTriggerKind]
    session_scope: ChannelSessionScope
    backfill: bool
    forwardfill: bool
    decided_by: Dict[str, ChannelPolicyLevel]


# ---------------------------------------------------------------------------
# Data payloads
# ---------------------------------------------------------------------------


class ChannelAgentData(BaseModel):
    references: Dict[str, Reference]  # the bound workflow/variant/revision
    policy: Optional[ChannelPolicy] = None


class ChannelSpaceData(BaseModel):
    external_locator: Dict[str, Any]  # the platform's own fields
    policy: Optional[ChannelPolicy] = None


class ChannelGrantData(BaseModel):
    policy: Optional[ChannelPolicy] = None


class ChannelThreadData(BaseModel):
    # tracks the nullable external_key column: absent together, present together
    external_locator: Optional[Dict[str, Any]] = None


# Defensive, not exhaustive: the union of every channel's own secret field
# names would need the adapter registry, which a leaf DTO must not import.
_REDACTED_CREDENTIAL_FIELDS = {"bot_token", "signing_secret", "webhook_secret"}
_REDACTED_VALUE = "[REDACTED]"


def _redact_credentials(value: Any) -> Any:
    """A platform that echoes a credential back would otherwise put it in
    our log; strip known field names wherever they appear, recursively."""

    if isinstance(value, dict):
        return {
            key: (
                _REDACTED_VALUE
                if isinstance(key, str) and key.lower() in _REDACTED_CREDENTIAL_FIELDS
                else _redact_credentials(val)
            )
            for key, val in value.items()
        }
    if isinstance(value, list):
        return [_redact_credentials(item) for item in value]
    return value


class ChannelInboxEventProcessed(BaseModel):
    """What core reads. The adapter's normalisation of the platform's payload."""

    content: List[Dict[str, Any]]  # normalised parts
    sender: Dict[str, Any]  # platform user, pre-identity-link

    @field_validator("content", "sender", mode="after")
    @classmethod
    def _redact(cls, value):
        return _redact_credentials(value)


class ChannelInboxEventData(BaseModel):
    external_locator: Dict[str, Any]
    processed: ChannelInboxEventProcessed
    # the adapter's classification, carried through so a get-or-create space
    # knows its kind without re-parsing the platform payload
    space_kind: Optional[ChannelSpaceKind] = None
    # raw:            Optional[Dict[str, Any]] = None


class ChannelOutboxEventData(BaseModel):
    external_locator: Optional[Dict[str, Any]] = None  # the receipt
    processed: Optional[Dict[str, Any]] = None  # the request we posted
    # raw:            Optional[Dict[str, Any]] = None

    @field_validator("processed", mode="after")
    @classmethod
    def _redact(cls, value):
        return _redact_credentials(value) if value is not None else value


# ---------------------------------------------------------------------------
# Connections
#
# Own table, not a row shared with tools/triggers: `channel` is a plain
# registry key and `external_key` is the uuid5 composed at CONNECTION grain.
# `data` stays a loose bag (locator, credential reference, per-install
# capability override, setup state) — adapters read it the same way they read
# any other connection payload.
# ---------------------------------------------------------------------------


class ChannelConnection(Identifier, Slug, Lifecycle, Header, Metadata):
    channel: str
    external_key: UUID
    #
    data: Optional[Dict[str, Any]] = None
    status: Optional[Status] = None
    flags: ChannelConnectionFlags = Field(default_factory=ChannelConnectionFlags)


class ChannelConnectionCreate(Slug, Header, Metadata):
    channel: str
    # derived, never taken from the caller — the service composes it from the
    # locator once verification discovers what it must
    external_key: UUID
    #
    data: Optional[Dict[str, Any]] = None
    # raw field values for the declared setup fields; verified, written to a
    # CHANNEL_SECRET row, and never persisted on this row or echoed back
    credentials: Optional[Dict[str, Any]] = None
    flags: ChannelConnectionFlags = Field(default_factory=ChannelConnectionFlags)


class ChannelConnectionEdit(Identifier, Header, Metadata):
    # channel and external_key are dropped: repointing a connection at a
    # different installation is a different row, not an edit of this one.
    slug: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    # present only to rotate: re-verified, then replaces the secret row's
    # contents without moving external_key
    credentials: Optional[Dict[str, Any]] = None
    flags: ChannelConnectionFlags = Field(default_factory=ChannelConnectionFlags)


class ChannelConnectionQuery(BaseModel):
    channel: Optional[str] = None
    slug: Optional[str] = None


class ChannelConnectionQueryRequest(BaseModel):
    connection: Optional[ChannelConnectionQuery] = None
    windowing: Optional[Windowing] = None


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------


class ChannelAgent(Identifier, Slug, Lifecycle, Header, Metadata):
    connection_id: UUID
    #
    data: ChannelAgentData
    flags: ChannelAgentFlags = Field(default_factory=ChannelAgentFlags)


class ChannelAgentCreate(Slug, Header, Metadata):
    connection_id: UUID
    #
    data: ChannelAgentData
    flags: ChannelAgentFlags = Field(default_factory=ChannelAgentFlags)


class ChannelAgentEdit(Identifier, Header, Metadata):
    data: ChannelAgentData
    flags: ChannelAgentFlags = Field(default_factory=ChannelAgentFlags)


class ChannelAgentQuery(BaseModel):
    connection_id: Optional[UUID] = None
    slug: Optional[str] = None


# ---------------------------------------------------------------------------
# Spaces
# ---------------------------------------------------------------------------


class ChannelSpace(Identifier, Lifecycle, Header, Metadata):
    connection_id: UUID
    kind: ChannelSpaceKind
    external_key: UUID
    #
    data: ChannelSpaceData
    flags: ChannelSpaceFlags = Field(default_factory=ChannelSpaceFlags)


class ChannelSpaceCreate(Header, Metadata):
    connection_id: UUID
    kind: ChannelSpaceKind
    external_key: UUID
    #
    data: ChannelSpaceData
    flags: ChannelSpaceFlags = Field(default_factory=ChannelSpaceFlags)


class ChannelSpaceEdit(Identifier, Header, Metadata):
    data: ChannelSpaceData
    flags: ChannelSpaceFlags = Field(default_factory=ChannelSpaceFlags)


class ChannelSpaceQuery(BaseModel):
    connection_id: Optional[UUID] = None
    kind: Optional[ChannelSpaceKind] = None
    external_key: Optional[UUID] = None


class ChannelSpaceCandidate(BaseModel):
    """One row in the configuration pick-list. Not an entity: no id, no
    lifecycle, nothing persisted until the operator chooses."""

    kind: ChannelSpaceKind
    external_locator: Dict[str, Any]
    #
    display_name: Optional[str] = None  # the platform's own name, for the list
    is_configured: bool = False  # a space row already exists for it


# ---------------------------------------------------------------------------
# Grants
# ---------------------------------------------------------------------------


def _validate_grant_rule(*, kind, space_id, effect, is_default) -> None:
    if (kind is None) == (space_id is None):
        raise ValueError("exactly one of kind or space_id must be set")
    if effect is ChannelGrantEffect.DENY and is_default:
        raise ValueError("a deny grant may not carry is_default")


class ChannelGrant(Identifier, Lifecycle, Header, Metadata):
    agent_id: UUID
    effect: ChannelGrantEffect
    kind: Optional[ChannelSpaceKind] = None
    space_id: Optional[UUID] = None
    #
    data: ChannelGrantData
    flags: ChannelGrantFlags = Field(default_factory=ChannelGrantFlags)

    @model_validator(mode="after")
    def _rule(self):
        _validate_grant_rule(
            kind=self.kind,
            space_id=self.space_id,
            effect=self.effect,
            is_default=self.flags.is_default,
        )
        return self


class ChannelGrantCreate(Header, Metadata):
    agent_id: UUID
    effect: ChannelGrantEffect
    kind: Optional[ChannelSpaceKind] = None
    space_id: Optional[UUID] = None
    #
    data: ChannelGrantData
    flags: ChannelGrantFlags = Field(default_factory=ChannelGrantFlags)

    @model_validator(mode="after")
    def _rule(self):
        _validate_grant_rule(
            kind=self.kind,
            space_id=self.space_id,
            effect=self.effect,
            is_default=self.flags.is_default,
        )
        return self


class ChannelGrantEdit(Identifier, Header, Metadata):
    data: ChannelGrantData
    flags: ChannelGrantFlags = Field(default_factory=ChannelGrantFlags)


class ChannelGrantQuery(BaseModel):
    agent_id: Optional[UUID] = None
    kind: Optional[ChannelSpaceKind] = None
    space_id: Optional[UUID] = None


# ---------------------------------------------------------------------------
# Threads (no Edit: the table is append-only)
# ---------------------------------------------------------------------------


class ChannelThread(Identifier, Lifecycle):
    space_id: UUID
    agent_id: UUID
    external_key: Optional[UUID] = None
    session_id: str
    #
    data: ChannelThreadData
    flags: ChannelThreadFlags = Field(default_factory=ChannelThreadFlags)


class ChannelThreadCreate(BaseModel):
    space_id: UUID
    agent_id: UUID
    external_key: Optional[UUID] = None
    session_id: str
    #
    data: ChannelThreadData
    flags: ChannelThreadFlags = Field(default_factory=ChannelThreadFlags)


class ChannelThreadQuery(BaseModel):
    space_id: Optional[UUID] = None
    agent_id: Optional[UUID] = None
    external_key: Optional[UUID] = None
    session_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Inbox events (no Edit either; append-only log)
# ---------------------------------------------------------------------------


class ChannelInboxEvent(Identifier, Lifecycle):
    connection_id: UUID
    external_id: str
    kind: ChannelEventKind
    origin: ChannelEventOrigin
    space_id: Optional[UUID] = None
    #
    status: Optional[Status] = None
    data: ChannelInboxEventData
    flags: ChannelInboxEventFlags = Field(default_factory=ChannelInboxEventFlags)


class ChannelInboxEventCreate(BaseModel):
    connection_id: UUID
    external_id: str
    kind: ChannelEventKind
    origin: ChannelEventOrigin
    space_id: Optional[UUID] = None
    #
    data: ChannelInboxEventData


class ChannelInboxEventQuery(BaseModel):
    connection_id: Optional[UUID] = None
    space_id: Optional[UUID] = None
    kind: Optional[ChannelEventKind] = None
    origin: Optional[ChannelEventOrigin] = None
    external_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Inbox triggers
# ---------------------------------------------------------------------------


class ChannelInboxTrigger(Identifier, Lifecycle):
    thread_id: UUID
    event_id: UUID
    turn_id: str
    state: ChannelTriggerState
    #
    status: Optional[Status] = None
    flags: ChannelInboxTriggerFlags = Field(default_factory=ChannelInboxTriggerFlags)


class ChannelInboxTriggerCreate(BaseModel):
    thread_id: UUID
    event_id: UUID
    turn_id: str
    state: ChannelTriggerState = ChannelTriggerState.STARTED
    #
    flags: ChannelInboxTriggerFlags = Field(default_factory=ChannelInboxTriggerFlags)


class ChannelInboxTriggerQuery(BaseModel):
    thread_id: Optional[UUID] = None
    event_id: Optional[UUID] = None
    turn_id: Optional[str] = None
    state: Optional[ChannelTriggerState] = None


# ---------------------------------------------------------------------------
# Outbox events
# ---------------------------------------------------------------------------


class ChannelOutboxEvent(Identifier, Lifecycle):
    connection_id: UUID
    thread_id: UUID
    turn_id: str
    key: UUID
    state: ChannelDeliveryState
    #
    status: Optional[Status] = None
    data: ChannelOutboxEventData
    flags: ChannelOutboxEventFlags = Field(default_factory=ChannelOutboxEventFlags)


class ChannelOutboxEventCreate(BaseModel):
    connection_id: UUID
    thread_id: UUID
    turn_id: str
    key: UUID
    state: ChannelDeliveryState = ChannelDeliveryState.CREATED
    #
    data: ChannelOutboxEventData


class ChannelOutboxEventQuery(BaseModel):
    thread_id: Optional[UUID] = None
    turn_id: Optional[str] = None
    key: Optional[UUID] = None
    state: Optional[ChannelDeliveryState] = None


# ---------------------------------------------------------------------------
# Adapter-facing shapes
# ---------------------------------------------------------------------------


class ChannelRequestContext(BaseModel):
    """The inbound request, framework-free: a bridge produces one without ever
    holding a FastAPI `Request`. Telegram's identity rides a header, a
    per-bot URL rides the path, so an adapter gets all three rather than the
    body alone."""

    headers: Dict[str, str]
    path: str
    body: bytes


class ChannelInboundEvent(BaseModel):
    """What an adapter produces from a platform payload. Not a row: routing
    turns it into a ChannelInboxEventCreate once the space resolves."""

    external_id: str
    kind: ChannelEventKind
    origin: ChannelEventOrigin = ChannelEventOrigin.PUSHED
    #
    space_kind: ChannelSpaceKind
    # one locator, every grain: `compose_external_key` takes the declared
    # subset per grain rather than the adapter supplying one locator each.
    external_locator: Dict[str, Any]
    #
    processed: ChannelInboxEventProcessed
    # the adapter's own answer to trigger-or-fill
    addressed: bool = False


class ChannelResolution(BaseModel):
    """Who runs, and under what policy. Composition of the input is separate."""

    space: ChannelSpace
    agent: ChannelAgent
    thread: ChannelThread
    policy: ChannelEffectivePolicy


class ChannelTurnInput(BaseModel):
    """What the agent sees: this event, plus whatever fill the policy allowed."""

    content: List[Dict[str, Any]]
    is_backfilled: bool = False


# ---------------------------------------------------------------------------
# Requests and responses
# ---------------------------------------------------------------------------


class ChannelsCatalogResponse(BaseModel):
    count: int = 0
    channels: List[str] = Field(default_factory=list)


class ChannelCapabilitiesResponse(BaseModel):
    count: int = 0
    capabilities: Optional[ChannelCapabilities] = None


class ChannelConnectionsResponse(BaseModel):
    count: int = 0
    connections: List[ChannelConnection] = Field(default_factory=list)


class ChannelConnectionRequest(BaseModel):
    connection: ChannelConnectionCreate


class ChannelConnectionEditRequest(BaseModel):
    connection: ChannelConnectionEdit


class ChannelConnectionResponse(BaseModel):
    count: int = 0
    connection: Optional[ChannelConnection] = None


class ChannelConnectionTeardownResponse(BaseModel):
    """Archive/unarchive: say what changed, and what did not — we never own
    the customer's app, so nothing here uninstalls anything on their side."""

    count: int = 0
    connection: Optional[ChannelConnection] = None
    platform_notice: str


class ChannelConnectionSetupResponse(BaseModel):
    """The declaration, plus the generated document: `setup.fields` and
    `setup.instructions` come straight from the capability declaration,
    `setup.document` is rebuilt per request from `build_setup_document`."""

    count: int = 0
    setup: Optional[ChannelSetup] = None


class ChannelAgentRequest(BaseModel):
    agent: ChannelAgentCreate


class ChannelAgentEditRequest(BaseModel):
    agent: ChannelAgentEdit


class ChannelAgentQueryRequest(BaseModel):
    agent: Optional[ChannelAgentQuery] = None
    windowing: Optional[Windowing] = None


class ChannelAgentResponse(BaseModel):
    count: int = 0
    agent: Optional[ChannelAgent] = None


class ChannelAgentsResponse(BaseModel):
    count: int = 0
    agents: List[ChannelAgent] = Field(default_factory=list)


class ChannelSpaceRequest(BaseModel):
    space: ChannelSpaceCreate


class ChannelSpaceEditRequest(BaseModel):
    space: ChannelSpaceEdit


class ChannelSpaceQueryRequest(BaseModel):
    space: Optional[ChannelSpaceQuery] = None
    windowing: Optional[Windowing] = None


class ChannelSpaceResponse(BaseModel):
    count: int = 0
    space: Optional[ChannelSpace] = None


class ChannelSpacesResponse(BaseModel):
    count: int = 0
    spaces: List[ChannelSpace] = Field(default_factory=list)


class ChannelSpaceCandidatesResponse(BaseModel):
    count: int = 0
    candidates: List[ChannelSpaceCandidate] = Field(default_factory=list)


class ChannelGrantRequest(BaseModel):
    grant: ChannelGrantCreate


class ChannelGrantEditRequest(BaseModel):
    grant: ChannelGrantEdit


class ChannelGrantQueryRequest(BaseModel):
    grant: Optional[ChannelGrantQuery] = None
    windowing: Optional[Windowing] = None


class ChannelGrantResponse(BaseModel):
    count: int = 0
    grant: Optional[ChannelGrant] = None


class ChannelGrantsResponse(BaseModel):
    count: int = 0
    grants: List[ChannelGrant] = Field(default_factory=list)


class ChannelThreadQueryRequest(BaseModel):
    thread: Optional[ChannelThreadQuery] = None
    windowing: Optional[Windowing] = None


class ChannelThreadResponse(BaseModel):
    count: int = 0
    thread: Optional[ChannelThread] = None


class ChannelThreadsResponse(BaseModel):
    count: int = 0
    threads: List[ChannelThread] = Field(default_factory=list)


class ChannelInboxEventQueryRequest(BaseModel):
    event: Optional[ChannelInboxEventQuery] = None
    windowing: Optional[Windowing] = None


class ChannelInboxEventsResponse(BaseModel):
    count: int = 0
    events: List[ChannelInboxEvent] = Field(default_factory=list)


class ChannelOutboxEventQueryRequest(BaseModel):
    event: Optional[ChannelOutboxEventQuery] = None
    windowing: Optional[Windowing] = None


class ChannelOutboxEventsResponse(BaseModel):
    count: int = 0
    events: List[ChannelOutboxEvent] = Field(default_factory=list)


class ChannelPolicyResolveRequest(BaseModel):
    agent_id: UUID
    space_id: UUID


class ChannelPolicyResponse(BaseModel):
    count: int = 0
    policy: Optional[ChannelEffectivePolicy] = None


class ChannelEventAck(BaseModel):
    """The 202 body. Mirrors TriggerEventAck exactly."""

    status: str = "accepted"
    detail: Optional[str] = None
