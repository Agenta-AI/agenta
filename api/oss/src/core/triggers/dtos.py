from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel

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
    categories: List[str] = []
    logo: Optional[str] = None


class TriggerCatalogEventDetails(TriggerCatalogEvent):
    # FROZEN (WS-PRE): the Event DTO carries the event's trigger_config JSON Schema
    # — the inbound analogue of an action's input_parameters.
    trigger_config: Optional[Dict[str, Any]] = None
    payload: Optional[Dict[str, Any]] = None


class TriggerCatalogProvider(BaseModel):
    key: TriggerProviderKind
    #
    name: str
    description: Optional[str] = None


# ---------------------------------------------------------------------------
# Context allowlists (mapping; see mapping.md §3)
#
# The inbound analogue of webhooks' EVENT_CONTEXT_FIELDS / SUBSCRIPTION_CONTEXT_FIELDS.
# A subscription's inputs_fields template may only reference these context keys;
# ca_*/secrets/connection internals are never exposed.
# ---------------------------------------------------------------------------

TRIGGER_EVENT_FIELDS = {
    "data",
    "type",
    "timestamp",
    "metadata",
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
# (``ti_*``) lives on the row alongside its ``trigger_config``.
# ---------------------------------------------------------------------------


class TriggerSubscriptionData(BaseModel):
    event_key: str
    #
    ti_id: Optional[str] = None
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
    data: TriggerSubscriptionData
    #
    enabled: bool = True
    valid: bool = True


class TriggerSubscriptionCreate(Header, Metadata):
    connection_id: UUID
    #
    data: TriggerSubscriptionData


class TriggerSubscriptionEdit(Identifier, Header, Metadata):
    connection_id: UUID
    #
    data: TriggerSubscriptionData
    #
    enabled: bool = True
    valid: bool = True


class TriggerSubscriptionQuery(BaseModel):
    name: Optional[str] = None
    connection_id: Optional[UUID] = None
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

    subscription_id: UUID
    event_id: str


class TriggerDeliveryCreate(Identifier):
    status: Status

    data: Optional[TriggerDeliveryData] = None

    subscription_id: UUID
    event_id: str


class TriggerDeliveryQuery(BaseModel):
    status: Optional[Status] = None

    subscription_id: Optional[UUID] = None
    event_id: Optional[str] = None
