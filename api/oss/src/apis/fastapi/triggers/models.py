from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import Windowing
from oss.src.core.triggers.dtos import (
    TriggerCatalogEvent,
    TriggerCatalogEventDetails,
    TriggerCatalogIntegration,
    TriggerCatalogProvider,
    TriggerConnection,
    TriggerConnectionCreate,
    TriggerDelivery,
    TriggerDeliveryQuery,
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionEdit,
    TriggerSubscriptionQuery,
)


# ---------------------------------------------------------------------------
# Trigger Catalog — providers + integrations are SHARED (gateway/catalog);
# events are the trigger-specific leaf.
# ---------------------------------------------------------------------------


class TriggerCatalogProviderResponse(BaseModel):
    count: int = 0
    provider: Optional[TriggerCatalogProvider] = None


class TriggerCatalogProvidersResponse(BaseModel):
    count: int = 0
    providers: List[TriggerCatalogProvider] = Field(default_factory=list)


class TriggerCatalogIntegrationResponse(BaseModel):
    count: int = 0
    integration: Optional[TriggerCatalogIntegration] = None


class TriggerCatalogIntegrationsResponse(BaseModel):
    count: int = 0
    total: int = 0
    cursor: Optional[str] = None
    integrations: List[TriggerCatalogIntegration] = Field(default_factory=list)


class TriggerCatalogEventResponse(BaseModel):
    count: int = 0
    event: Optional[TriggerCatalogEventDetails] = None


class TriggerCatalogEventsResponse(BaseModel):
    count: int = 0
    total: int = 0
    cursor: Optional[str] = None
    events: List[TriggerCatalogEvent] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Trigger Connections
#
# Connections are shared `gateway_connections` rows; triggers exposes an
# independent `/triggers/connections/*` surface over the SAME ConnectionsService
# that tools uses, so a connection made from either side is visible from both.
# ---------------------------------------------------------------------------


class TriggerConnectionCreateRequest(BaseModel):
    connection: TriggerConnectionCreate


class TriggerConnectionResponse(BaseModel):
    count: int = 0
    connection: Optional[TriggerConnection] = None


class TriggerConnectionsResponse(BaseModel):
    count: int = 0
    connections: List[TriggerConnection] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Trigger Subscriptions
# ---------------------------------------------------------------------------


class TriggerSubscriptionCreateRequest(BaseModel):
    subscription: TriggerSubscriptionCreate


class TriggerSubscriptionEditRequest(BaseModel):
    subscription: TriggerSubscriptionEdit


class TriggerSubscriptionQueryRequest(BaseModel):
    subscription: Optional[TriggerSubscriptionQuery] = None

    windowing: Optional[Windowing] = None


class TriggerSubscriptionResponse(BaseModel):
    count: int = 0
    subscription: Optional[TriggerSubscription] = None


class TriggerSubscriptionsResponse(BaseModel):
    count: int = 0
    subscriptions: List[TriggerSubscription] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Trigger Deliveries
# ---------------------------------------------------------------------------


class TriggerDeliveryQueryRequest(BaseModel):
    delivery: Optional[TriggerDeliveryQuery] = None

    windowing: Optional[Windowing] = None


class TriggerDeliveryResponse(BaseModel):
    count: int = 0
    delivery: Optional[TriggerDelivery] = None


class TriggerDeliveriesResponse(BaseModel):
    count: int = 0
    deliveries: List[TriggerDelivery] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Trigger Ingress (inbound provider events)
# ---------------------------------------------------------------------------


class TriggerEventAck(BaseModel):
    status: str = "accepted"
    detail: Optional[str] = None


class ComposioEventEnvelope(BaseModel):
    """Loose view of a Composio trigger webhook envelope (`{data, type, ...}`).

    Demultiplexing keys live under ``metadata`` (``trigger_id``, ``id``); the rest
    is passed through to the resolver as the inbound event.
    """

    type: Optional[str] = None
    timestamp: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
