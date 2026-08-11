"""Wire models for the channels configuration API.

The house-shape request/response models live directly in `core.channels.dtos`
rather than here, and are re-exported rather than duplicated to avoid two
definitions of the same wire shape agreeing by accident. The three
`*CreateRequest` aliases below give the conventional name to the existing
`*Request` class without introducing a second class.
"""

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.channels.dtos import (
    ChannelAgentEditRequest,
    ChannelAgentQueryRequest,
    ChannelAgentRequest as ChannelAgentCreateRequest,
    ChannelAgentResponse,
    ChannelAgentsResponse,
    ChannelCapabilitiesResponse,
    ChannelConnectionEditRequest,
    ChannelConnectionQueryRequest,
    ChannelConnectionRequest as ChannelConnectionCreateRequest,
    ChannelConnectionResponse,
    ChannelConnectionSetupResponse,
    ChannelConnectionsResponse,
    ChannelConnectionTeardownResponse,
    ChannelEventAck,
    ChannelGrantEditRequest,
    ChannelGrantQueryRequest,
    ChannelGrantRequest as ChannelGrantCreateRequest,
    ChannelGrantResponse,
    ChannelGrantsResponse,
    ChannelInboxEventQueryRequest,
    ChannelInboxEventsResponse,
    ChannelOutboxEventQueryRequest,
    ChannelOutboxEventsResponse,
    ChannelPolicyResolveRequest,
    ChannelPolicyResponse,
    ChannelSpaceCandidatesResponse,
    ChannelSpaceEditRequest,
    ChannelSpaceQueryRequest,
    ChannelSpaceRequest as ChannelSpaceCreateRequest,
    ChannelSpaceResponse,
    ChannelSpacesResponse,
    ChannelThreadQueryRequest,
    ChannelThreadResponse,
    ChannelThreadsResponse,
    ChannelsCatalogResponse,
)

__all__ = [
    "AgentaConversationItem",
    "AgentaConversationResponse",
    "ChannelAgentCreateRequest",
    "ChannelAgentEditRequest",
    "ChannelAgentQueryRequest",
    "ChannelAgentResponse",
    "ChannelAgentsResponse",
    "ChannelCapabilitiesResponse",
    "ChannelConnectionCreateRequest",
    "ChannelConnectionEditRequest",
    "ChannelConnectionQueryRequest",
    "ChannelConnectionResponse",
    "ChannelConnectionSetupResponse",
    "ChannelConnectionsResponse",
    "ChannelConnectionTeardownResponse",
    "ChannelEventAck",
    "ChannelGrantCreateRequest",
    "ChannelGrantEditRequest",
    "ChannelGrantQueryRequest",
    "ChannelGrantResponse",
    "ChannelGrantsResponse",
    "ChannelInboxEventQueryRequest",
    "ChannelInboxEventsResponse",
    "ChannelOutboxEventQueryRequest",
    "ChannelOutboxEventsResponse",
    "ChannelPolicyResolveRequest",
    "ChannelPolicyResponse",
    "ChannelSpaceCandidatesResponse",
    "ChannelSpaceCreateRequest",
    "ChannelSpaceDiscoverRequest",
    "ChannelSpaceEditRequest",
    "ChannelSpaceQueryRequest",
    "ChannelSpaceResponse",
    "ChannelSpacesResponse",
    "ChannelThreadQueryRequest",
    "ChannelThreadResponse",
    "ChannelThreadsResponse",
    "ChannelsCatalogResponse",
]


class ChannelSpaceDiscoverRequest(BaseModel):
    """No core DTO either: `discover_spaces` persists nothing, so its only
    input is the connection to ask."""

    connection_id: UUID


class AgentaConversationItem(BaseModel):
    """One row of the merged read: the inbox log and what the outbox posted
    back, collapsed to the one shape a poller needs."""

    id: UUID
    direction: Literal["inbound", "outbound"]
    created_at: Optional[datetime] = None
    content: List[Dict[str, Any]] = Field(default_factory=list)


class AgentaConversationResponse(BaseModel):
    count: int = 0
    items: List[AgentaConversationItem] = Field(default_factory=list)
