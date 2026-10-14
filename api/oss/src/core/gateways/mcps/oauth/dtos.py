"""DTOs for the MCP OAuth client."""

from datetime import datetime
from enum import Enum
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class MCPOAuthDiscovery(BaseModel):
    """Feeds `MCPEndpointData.oauth` (`resource`, `authorization_server`,
    `scopes_offered`) and the connect-time scope checklist. No secret involved.

    `resource` is absent when the server publishes no protected-resource document and its
    authorization server was found at its origin instead: there is then no resource
    identifier to send.
    """

    resource: Optional[str] = None
    authorization_server: str
    scopes_offered: List[str] = []
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: Optional[str] = None
    # The authorization server accepts a URL as a client id (a client ID metadata
    # document). Only then is Agenta's own document offered as one.
    client_id_metadata_document_supported: bool = False


class MCPOAuthAuthorizationStart(BaseModel):
    authorization_url: str
    state: str
    attempt_id: UUID
    # How long the attempt stays usable. The browser waits exactly this long, so the
    # sheet and the callback agree on when an attempt is over.
    expires_in: int


class MCPOAuthCompletion(BaseModel):
    project_id: UUID
    user_id: UUID
    endpoint_id: UUID
    server_url: str
    secret_id: UUID


class MCPOAuthAttemptCreate(BaseModel):
    """One authorization attempt, as `begin()` records it.

    Everything here used to travel inside the `state` parameter. It stays server-side
    instead, so the PKCE verifier never reaches the authorization server and the
    callback is bound to the project, the endpoint, the issuer and the user that
    started the flow rather than to whatever a signed blob claimed.
    """

    state: str
    project_id: UUID
    user_id: UUID
    endpoint_id: UUID
    server_url: str
    issuer: str
    token_endpoint: str
    redirect_uri: str
    resource: Optional[str] = None
    code_verifier: str
    scopes: List[str] = Field(default_factory=list)
    strategy: str = "outbound"
    # The client the person entered that the attempt signs in as, `None` for a client
    # Agenta chose. The callback binds the grant only while the connection still names
    # the same one.
    client_id: Optional[str] = None
    expires_at: datetime


class MCPOAuthAttemptStatus(str, Enum):
    """Where one attempt stands.

    `claimed` is the moment between the callback taking the attempt and it writing an
    outcome, while the code is exchanged. The browser reads it as still pending.
    """

    PENDING = "pending"
    CLAIMED = "claimed"
    CONNECTED = "connected"
    FAILED = "failed"
    CANCELLED = "cancelled"


class MCPOAuthAttempt(MCPOAuthAttemptCreate):
    """A recorded authorization attempt, addressed by its opaque `state`."""

    id: UUID
    status: MCPOAuthAttemptStatus = MCPOAuthAttemptStatus.PENDING
    # The callback's own words for a failed attempt, so the sheet can show them when the
    # popup's message never reached it.
    error: Optional[str] = None


class MCPOAuthAttemptOutcome(BaseModel):
    """What the browser is told about one attempt it started.

    `claimed` reads as `pending`, and a pending attempt past its expiry as `cancelled`:
    the browser only needs to know whether to keep waiting, and how it ended.
    """

    id: UUID
    status: MCPOAuthAttemptStatus
    error: Optional[str] = None
