from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.gateway.catalog.dtos import (
    CatalogIntegration,
    CatalogProvider,
)
from oss.src.core.gateway.connections.dtos import (
    Connection,
    ConnectionCreate,
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
    pass


class TriggerCatalogIntegration(CatalogIntegration):
    pass


# ---------------------------------------------------------------------------
# Trigger Connections — shared `gateway_connections` rows, inherited here so the
# triggers router/models never reference the generic gateway DTOs directly.
# ---------------------------------------------------------------------------


class TriggerConnection(Connection):
    pass


class TriggerConnectionCreate(ConnectionCreate):
    pass


# ---------------------------------------------------------------------------
# Context allowlists (mapping; see mapping.md §3)
#
# The inbound analogue of webhooks' EVENT_CONTEXT_FIELDS / SUBSCRIPTION_CONTEXT_FIELDS.
# A subscription's inputs_fields template may only reference these context keys;
# ca_*/secrets/connection internals are never exposed.
# ---------------------------------------------------------------------------

TRIGGER_CONTEXT_FIELDS = {
    "trigger_id",
    "trigger_type",
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


class TriggerSubscriptionData(BaseModel):
    event_key: str
    #
    trigger_config: Optional[Dict[str, Any]] = None
    #
    # MAPPING — inputs-only template resolved into WorkflowServiceRequest.data.inputs.
    inputs_fields: Optional[Dict[str, Any]] = None
    #
    # DESTINATION — the bound workflow, by reference (the /retrieve shape).
    references: Optional[Dict[str, Reference]] = None
    selector: Optional[Selector] = None


class TriggerSubscription(Identifier, Lifecycle, Header, Metadata):
    connection_id: UUID
    #
    ti_id: Optional[str] = None
    #
    data: TriggerSubscriptionData
    #
    flags: TriggerSubscriptionFlags = Field(default_factory=TriggerSubscriptionFlags)


class TriggerSubscriptionCreate(Header, Metadata):
    connection_id: UUID
    #
    data: TriggerSubscriptionData


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
# trigger_datetime) instead of a Composio event. No connection_id, no ti_id.
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
    # MAPPING — inputs-only template resolved into WorkflowServiceRequest.data.inputs.
    inputs_fields: Optional[Dict[str, Any]] = None
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
