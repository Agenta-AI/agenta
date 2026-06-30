from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

from oss.src.core.shared.dtos import Windowing
from oss.src.core.triggers.dtos import (
    TriggerCatalogEvent,
    TriggerCatalogEventDetails,
    TriggerCatalogIntegration,
    TriggerCapabilitiesResult,
    TriggerCatalogProvider,
    TriggerProviderKind,
    TriggerConnection,
    TriggerConnectionCreate,
    TriggerDelivery,
    TriggerDeliveryQuery,
    TriggerSchedule,
    TriggerScheduleCreate,
    TriggerScheduleEdit,
    TriggerScheduleQuery,
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


class TriggerDiscoveryQuery(BaseModel):
    """Request body for ``POST /triggers/discover``."""

    use_cases: List[str]
    provider: str = TriggerProviderKind.COMPOSIO.value
    limit_alternatives: int = Field(default=3, ge=0)

    @field_validator("use_cases", mode="before")
    @classmethod
    def _require_use_cases(cls, value: Any) -> List[str]:
        if not isinstance(value, list):
            raise ValueError("use_cases must be a list of non-empty fragments")
        items = [str(v).strip() for v in value if str(v).strip()]
        if not items:
            raise ValueError("use_cases must contain at least one non-empty fragment")
        return items


TriggerDiscoveryResponse = TriggerCapabilitiesResult


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
# Trigger Schedules
# ---------------------------------------------------------------------------


class TriggerScheduleCreateRequest(BaseModel):
    schedule: TriggerScheduleCreate


class TriggerScheduleEditRequest(BaseModel):
    schedule: TriggerScheduleEdit


class TriggerScheduleQueryRequest(BaseModel):
    schedule: Optional[TriggerScheduleQuery] = None

    windowing: Optional[Windowing] = None


class TriggerScheduleResponse(BaseModel):
    count: int = 0
    schedule: Optional[TriggerSchedule] = None


class TriggerSchedulesResponse(BaseModel):
    count: int = 0
    schedules: List[TriggerSchedule] = Field(default_factory=list)


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
