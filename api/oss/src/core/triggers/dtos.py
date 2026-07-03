from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.gateway.catalog.dtos import (
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
    Header,
    Identifier,
    Lifecycle,
    Metadata,
    Reference,
    Selector,
    Status,
)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

TRIGGER_MAX_RETRIES = 5


# ---------------------------------------------------------------------------
# Trigger Enums
# ---------------------------------------------------------------------------


class TriggerProviderKind(str, Enum):
    COMPOSIO = "composio"


class TriggerAuthScheme(str, Enum):
    OAUTH = "oauth"
    API_KEY = "api_key"


# ---------------------------------------------------------------------------
# Trigger Catalog
#
# The catalog leaf is an **event** (Composio "trigger type"), the analogue of a
# tools **action**. An event carries a ``trigger_config`` JSON Schema, the
# analogue of an action's ``input_parameters``.
# ---------------------------------------------------------------------------


class TriggerCatalogEvent(BaseModel):
    key: str
    #
    name: str
    description: Optional[str] = None
    #
    provider: Optional[str] = None
    integration: Optional[str] = None
    #
    categories: List[str] = Field(default_factory=list)
    logo: Optional[str] = None


class TriggerCatalogEventDetails(TriggerCatalogEvent):
    trigger_config: Optional[Dict[str, Any]] = None
    payload: Optional[Dict[str, Any]] = None


# Providers + integrations are SHARED across tools and triggers — defined once
# in gateway/catalog and inherited here as the triggers-side subclasses.
class TriggerCatalogProvider(CatalogProvider):
    key: TriggerProviderKind


class TriggerCatalogIntegration(CatalogIntegration):
    auth_schemes: Optional[List[TriggerAuthScheme]] = None


class TriggerCatalogIntegrationsPage(BaseModel):
    """A cursor-paginated page of trigger integrations."""

    integrations: List[TriggerCatalogIntegration] = []
    next_cursor: Optional[str] = None
    total: int = 0


class TriggerCatalogEventsPage(BaseModel):
    """A cursor-paginated page of trigger events."""

    events: List[TriggerCatalogEvent] = []
    next_cursor: Optional[str] = None
    total: int = 0


# ---------------------------------------------------------------------------
# Trigger discovery (find_triggers)
# ---------------------------------------------------------------------------


class TriggerDiscoveryConnectionState(str, Enum):
    READY = "ready"
    NEEDS_AUTH = "needs_auth"
    NEEDS_INPUT = "needs_input"


class DiscoveredTriggerEvent(BaseModel):
    type: Literal["trigger"] = "trigger"
    provider: str = TriggerProviderKind.COMPOSIO.value
    integration: str
    event_key: str
    trigger_config: Optional[Dict[str, Any]] = None
    payload: Optional[Dict[str, Any]] = None
    description: Optional[str] = None
    provider_event: str


class DiscoveredTriggerAlternative(BaseModel):
    integration: str
    event_key: str
    description: Optional[str] = None
    provider_event: str


class TriggerCapabilityConnection(BaseModel):
    state: TriggerDiscoveryConnectionState
    id: Optional[UUID] = None
    slug: Optional[str] = None


class TriggerConnectAffordance(BaseModel):
    endpoint: str = "POST /triggers/connections/"
    body: Dict[str, Any]


class TriggerConnectionRequirement(BaseModel):
    integration: str
    state: TriggerDiscoveryConnectionState
    id: Optional[UUID] = None
    slug: Optional[str] = None
    connect: Optional[TriggerConnectAffordance] = None


class TriggerCapability(BaseModel):
    use_case: str
    integration: Optional[str] = None
    event: Optional[DiscoveredTriggerEvent] = None
    alternatives: List[DiscoveredTriggerAlternative] = Field(default_factory=list)
    connection: Optional[TriggerCapabilityConnection] = None
    note: Optional[str] = None


class TriggerDiscoveryGuidance(BaseModel):
    plan_steps: List[str] = Field(default_factory=list)
    pitfalls: List[str] = Field(default_factory=list)


class TriggerCapabilitiesResult(BaseModel):
    capabilities: List[TriggerCapability] = Field(default_factory=list)
    connections: List[TriggerConnectionRequirement] = Field(default_factory=list)
    guidance: TriggerDiscoveryGuidance = Field(default_factory=TriggerDiscoveryGuidance)
    ready: bool = False
    notes: List[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Trigger Connections — shared `gateway_connections` rows, inherited here so the
# triggers router/models never reference the generic gateway DTOs directly.
# ---------------------------------------------------------------------------


class TriggerConnectionStatus(ConnectionStatus):
    pass


class TriggerConnectionCreateData(ConnectionCreateData):
    auth_scheme: Optional[TriggerAuthScheme] = None


class TriggerConnection(Connection):
    provider_key: TriggerProviderKind
    status: Optional[TriggerConnectionStatus] = None


class TriggerConnectionCreate(ConnectionCreate):
    provider_key: TriggerProviderKind
    data: Optional[TriggerConnectionCreateData] = None


# ---------------------------------------------------------------------------
# Context allowlists (mapping; see mapping.md §3)
#
# The inbound analogue of webhooks' EVENT_CONTEXT_FIELDS / SUBSCRIPTION_CONTEXT_FIELDS.
# A subscription's inputs_fields template may only reference these context keys;
# ca_*/secrets/connection internals are never exposed.
# ---------------------------------------------------------------------------

TRIGGER_CONTEXT_FIELDS = {
    "event_id",
    "event_type",
    "timestamp",
    "created_at",
    "attributes",
}

SUBSCRIPTION_CONTEXT_FIELDS = {
    "id",
    "name",
    "tags",
    "meta",
    "created_at",
    "updated_at",
}


# ---------------------------------------------------------------------------
# Trigger Subscriptions
#
# A standing watch on one provider event. Mirrors a webhook subscription
# (subscribe-to-events lifecycle, CRUD) + FK to the shared gateway_connections
# row + a bound workflow reference. The provider-side trigger instance id
# (``ti_*``) is a top-level lookup key (indexed), not config inside ``data``.
# ---------------------------------------------------------------------------


class TriggerSubscriptionFlags(BaseModel):
    # is_active = user play/pause switch; is_valid = provider connection still good
    # (Composio can revoke a connection out from under a subscription).
    is_active: bool = True
    is_valid: bool = True
    # is_test = capture-and-skip mode: no bound-workflow required, events are recorded
    # as test deliveries (full event context) and the workflow is never invoked.
    is_test: bool = False


class TriggerSubscriptionData(BaseModel):
    event_key: str
    #
    trigger_config: Optional[Dict[str, Any]] = None
    #
    # MAPPING — inputs-only template resolved into WorkflowServiceRequest.data.inputs.
    # A bare selector string (e.g. "$") is allowed at top level = whole context.
    inputs_fields: Optional[Union[Dict[str, Any], str]] = None
    #
    # DESTINATION — the bound workflow, by reference (the /retrieve shape).
    references: Optional[Dict[str, Reference]] = None
    selector: Optional[Selector] = None


class TriggerSubscription(Identifier, Lifecycle, Header, Metadata):
    connection_id: UUID
    #
    trigger_id: Optional[str] = None
    #
    data: TriggerSubscriptionData
    #
    flags: TriggerSubscriptionFlags = Field(default_factory=TriggerSubscriptionFlags)


class TriggerSubscriptionCreate(Header, Metadata):
    connection_id: UUID
    #
    data: TriggerSubscriptionData
    #
    flags: TriggerSubscriptionFlags = Field(default_factory=TriggerSubscriptionFlags)


class TriggerSubscriptionEdit(Identifier, Header, Metadata):
    connection_id: UUID
    #
    data: TriggerSubscriptionData
    #
    flags: TriggerSubscriptionFlags = Field(default_factory=TriggerSubscriptionFlags)


class TriggerSubscriptionQuery(BaseModel):
    name: Optional[str] = None
    connection_id: Optional[UUID] = None
    event_key: Optional[str] = None


# ---------------------------------------------------------------------------
# Trigger Schedules
#
# A cron-driven analogue to a trigger subscription. Same mapping + bound-workflow
# reference, but fired by our own cron tick (``croniter.match`` on the rounded
# trigger_datetime) instead of a Composio event. No connection_id, no trigger_id.
# ---------------------------------------------------------------------------


class TriggerScheduleFlags(BaseModel):
    # No is_valid: a schedule has no external connection to invalidate.
    is_active: bool = True


class TriggerScheduleData(BaseModel):
    event_key: str
    #
    # PERIOD — a 5-field cron expression (UTC, 1-minute floor); validated via croniter.
    schedule: str
    #
    # WINDOW — minute-aligned UTC bounds; [start_time, end_time), null = unbounded.
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    #
    # MAPPING — inputs-only template resolved into WorkflowServiceRequest.data.inputs.
    # A bare selector string (e.g. "$") is allowed at top level = whole context.
    inputs_fields: Optional[Union[Dict[str, Any], str]] = None
    #
    # DESTINATION — the bound workflow, by reference (the /retrieve shape).
    references: Optional[Dict[str, Reference]] = None
    selector: Optional[Selector] = None


class TriggerSchedule(Identifier, Lifecycle, Header, Metadata):
    data: TriggerScheduleData
    #
    flags: TriggerScheduleFlags = Field(default_factory=TriggerScheduleFlags)


class TriggerScheduleCreate(Header, Metadata):
    data: TriggerScheduleData
    #
    flags: TriggerScheduleFlags = Field(default_factory=TriggerScheduleFlags)


class TriggerScheduleEdit(Identifier, Header, Metadata):
    data: TriggerScheduleData
    #
    flags: TriggerScheduleFlags = Field(default_factory=TriggerScheduleFlags)


class TriggerScheduleQuery(BaseModel):
    name: Optional[str] = None
    event_key: Optional[str] = None


# ---------------------------------------------------------------------------
# Trigger Deliveries
#
# One audit row per inbound event dispatched to its workflow — the inbound dual
# of webhook_deliveries. ``event_id`` is the I4 dedup key (provider metadata.id),
# unique per subscription.
# ---------------------------------------------------------------------------


class TriggerDeliveryData(BaseModel):
    event_key: Optional[str] = None
    #
    references: Optional[Dict[str, Reference]] = None
    inputs: Optional[Dict[str, Any]] = None
    #
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    #
    # Self-describing test marker: a capture-and-skip delivery from an is_test
    # subscription, so the playground can filter without loading the subscription.
    is_test: Optional[bool] = None


class TriggerDelivery(Identifier, Lifecycle):
    status: Status

    data: Optional[TriggerDeliveryData] = None

    # Exactly one of subscription_id / schedule_id is set (XOR — enforced in DB).
    subscription_id: Optional[UUID] = None
    schedule_id: Optional[UUID] = None
    event_id: str


class TriggerDeliveryCreate(Identifier):
    status: Status

    data: Optional[TriggerDeliveryData] = None

    subscription_id: Optional[UUID] = None
    schedule_id: Optional[UUID] = None
    event_id: str


class TriggerDeliveryQuery(BaseModel):
    status: Optional[Status] = None

    subscription_id: Optional[UUID] = None
    schedule_id: Optional[UUID] = None
    event_id: Optional[str] = None
