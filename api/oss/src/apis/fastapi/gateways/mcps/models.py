"""MCP gateway management wire models.

The house triple, matching `triggers/models.py`, plus the connect shapes.

"""

from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from oss.src.core.gateways.mcps.dtos import (
    MCPCredentialBinding,
    MCPEndpoint,
    MCPEndpointCreate,
    MCPEndpointEdit,
    MCPEndpointQuery,
)
from oss.src.core.gateways.mcps.oauth.dtos import MCPOAuthAttemptOutcome
from oss.src.core.gateways.mcps.probe import MCPServerProbeResult
from oss.src.core.shared.dtos import Windowing


class MCPEndpointCreateRequest(BaseModel):
    endpoint: MCPEndpointCreate


class MCPEndpointEditRequest(BaseModel):
    endpoint: MCPEndpointEdit


class MCPEndpointQueryRequest(BaseModel):
    endpoint: Optional[MCPEndpointQuery] = None
    windowing: Optional[Windowing] = None


class MCPEndpointResponse(BaseModel):
    count: int = 0
    endpoint: Optional[MCPEndpoint] = None


class MCPEndpointsResponse(BaseModel):
    count: int = 0
    endpoints: List[MCPEndpoint] = Field(default_factory=list)


class MCPEndpointCheckRequest(BaseModel):
    """The result of a check the connect sheet just ran against the connection."""

    ok: bool
    reason: Optional[str] = Field(
        default=None,
        description="Why the check failed. Text past 300 characters is cut, not refused.",
    )

    @field_validator("reason")
    @classmethod
    def clip_reason(cls, reason: Optional[str]) -> Optional[str]:
        """The reason can carry a server's own error text whole. A long one is cut, not
        refused, so the failed check is still recorded."""
        return reason[:300] if reason else reason


class MCPConnectRequest(BaseModel):
    """Request MCP OAuth scope discovery or authorization.
    `scopes` present (an empty list is a legal "no scopes") is the begin step."""

    scopes: Optional[List[str]] = None

    @field_validator("scopes")
    @classmethod
    def scopes_must_be_distinct_non_blank(cls, scopes: Optional[List[str]]):
        """The dashboard sends discovered scope identifiers verbatim. Rejecting
        duplicates and whitespace-only values keeps the signed OAuth state stable
        and makes a reconnect/step-up request unambiguous without inventing an
        OAuth-specific scope grammar here."""
        if scopes is None:
            return scopes
        if any(not scope or scope != scope.strip() for scope in scopes):
            raise ValueError("scopes must be non-blank identifiers")
        if len(set(scopes)) != len(scopes):
            raise ValueError("scopes must not contain duplicates")
        return scopes


class MCPConnectResponse(BaseModel):
    count: int = 0
    redirect_url: Optional[str] = None
    scopes_offered: List[str] = Field(default_factory=list)
    # Set with `redirect_url`: the attempt the callback will answer for, and how many
    # seconds it stays usable.
    attempt_id: Optional[str] = None
    expires_in: Optional[int] = None


class MCPConnectAttemptResponse(BaseModel):
    count: int = 0
    attempt: Optional[MCPOAuthAttemptOutcome] = None


class MCPEndpointProbeRequest(BaseModel):
    """Inspect a server URL before an endpoint exists.

    The probe routes a request and reports what came back. It takes no name (nothing is
    being labelled), no slug or id (nothing is being identified), and no credential value.

    `secret_id` names a project secret to send the way `credential_binding` says, which
    is a `{secret}` in the URL's path when it says nothing: that address does not exist
    without its key. A key sent in a header or the query is how a changed key is checked
    before a connection saves it. The API reads the value from the vault, so the browser
    never sends it.
    """

    url: str
    secret_id: Optional[UUID] = None
    credential_binding: Optional[MCPCredentialBinding] = None


class MCPEndpointProbeResponse(BaseModel):
    count: int = 0
    probe: Optional[MCPServerProbeResult] = None


class MCPAgentaToolDescriptor(BaseModel):
    """One callback tool selected by the agent service for a single run."""

    name: str = Field(min_length=1, max_length=128)
    call_ref: str = Field(min_length=1, max_length=512)
    description: Optional[str] = Field(default=None, max_length=4096)
    input_schema: Dict[str, Any] = Field(default_factory=dict)


class MCPAgentaCredentialRequest(BaseModel):
    tools: List[MCPAgentaToolDescriptor] = Field(default_factory=list, max_length=128)


class MCPAgentaCredentialResponse(BaseModel):
    credentials: str
