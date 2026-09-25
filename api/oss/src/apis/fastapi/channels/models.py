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

from pydantic import BaseModel, ConfigDict, Field

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
    ChannelSetupResponse,
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
    "ChannelDestinationsQueryRequest",
    "ChannelMessageSendRequest",
    "ChannelMessagesReadRequest",
    "ChannelMessagesSearchRequest",
    "ChannelToolsAvailabilityRequest",
    "ChannelToolsAvailabilityResponse",
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
    "ChannelSetupResponse",
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


class TelegramHostedBindLinkRequest(BaseModel):
    # The workflow the connected chat's agent runs, by reference
    # (workflow/variant/revision) — the agent the user picked in the UI.
    references: Dict[str, Any]


class TelegramHostedBindLinkResponse(BaseModel):
    # The deep link the connect UI shows and renders as a QR code.
    url: str
    # How long the link stays valid, in seconds.
    expires_in_seconds: int
    # The project's hosted Telegram connection the link binds chats to. The
    # UI polls this connection's bindings to learn when /start completed.
    connection_id: UUID


class TelegramHostedBinding(BaseModel):
    # The Telegram chat bound to the connection (a private chat in v1).
    chat_id: str
    connection_id: UUID


class TelegramHostedBindingsResponse(BaseModel):
    # The chats a /start has bound to the connection. Empty until the first
    # bind completes, which is how the connect UI tells "link minted" apart
    # from "chat connected".
    count: int
    bindings: List[TelegramHostedBinding]


# --- channel agent tools ------------------------------------------------------ #
#
# Closed on purpose: `artifact_id`, `session_id` and `tool_call_id` are bound by
# the runner from run context, and anything else the model adds (a connection
# id, a raw Slack channel, a sender name) is refused before a read or a write.


class _ChannelToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    artifact_id: UUID


class ChannelToolsAvailabilityRequest(_ChannelToolRequest):
    pass


class ChannelToolsAvailabilityResponse(BaseModel):
    available: bool
    # the channel tool ops this agent's runs get, following its bots' settings
    tools: List[str] = Field(default_factory=list)


class ChannelDestinationsQueryRequest(_ChannelToolRequest):
    type: Optional[Literal["channel"]] = None
    query: Optional[str] = Field(default=None, max_length=200)
    limit: Optional[int] = Field(default=None, ge=1, le=100)
    cursor: Optional[str] = Field(default=None, max_length=64)


class ChannelMessageSendRequest(_ChannelToolRequest):
    session_id: str = Field(min_length=1, max_length=200)
    tool_call_id: str = Field(min_length=1, max_length=200)
    destination_id: str = Field(max_length=256)
    text: str = Field(min_length=1, max_length=40000)
    thread_id: Optional[str] = Field(default=None, max_length=256)


class ChannelMessagesReadRequest(_ChannelToolRequest):
    destination_id: str = Field(max_length=256)
    thread_id: Optional[str] = Field(default=None, max_length=256)
    limit: Optional[int] = Field(default=None, ge=1, le=200)
    cursor: Optional[str] = Field(default=None, max_length=256)


class ChannelMessagesSearchRequest(_ChannelToolRequest):
    query: str = Field(min_length=1, max_length=500)
    destination_ids: Optional[List[str]] = Field(default=None, max_length=100)
    after: Optional[datetime] = None
    before: Optional[datetime] = None
    limit: Optional[int] = Field(default=None, ge=1, le=50)
    cursor: Optional[str] = Field(default=None, max_length=64)
