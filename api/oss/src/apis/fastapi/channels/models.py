"""Wire models for the channels configuration API (entities.md §6).

C0/WP1 already placed the house-shape request/response models directly in
`core.channels.dtos` rather than here. Re-exported, not duplicated: a second
set under new names would be the exact seam defect c1-merge-notes.md warns
about — two definitions of the same wire shape, agreeing by accident. The
three `*CreateRequest` aliases below restore the entities.md §6 name over the
existing `*Request` class without introducing a second class.
"""

from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.channels.dtos import (
    ChannelAgentEditRequest,
    ChannelAgentQueryRequest,
    ChannelAgentRequest as ChannelAgentCreateRequest,
    ChannelAgentResponse,
    ChannelAgentsResponse,
    ChannelCapabilitiesResponse,
    ChannelConnectionsResponse,
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
    "ChannelAgentCreateRequest",
    "ChannelAgentEditRequest",
    "ChannelAgentQueryRequest",
    "ChannelAgentResponse",
    "ChannelAgentsResponse",
    "ChannelCapabilitiesResponse",
    "ChannelConnectionsQueryRequest",
    "ChannelConnectionsResponse",
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


class ChannelConnectionsQueryRequest(BaseModel):
    """No core `*Query` DTO exists for connections — it is a read-only view
    over the shared `ConnectionsService.query_connections`, whose own filters
    are scalar kwargs rather than a DTO."""

    provider_key: Optional[str] = None
    integration_key: Optional[str] = None
    is_active: Optional[bool] = True


class ChannelSpaceDiscoverRequest(BaseModel):
    """No core DTO either: `discover_spaces` persists nothing, so its only
    input is the connection to ask."""

    connection_id: UUID
