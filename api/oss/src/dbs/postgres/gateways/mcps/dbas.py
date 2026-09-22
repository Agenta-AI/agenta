"""MCP endpoint DBA mixins."""

from sqlalchemy import TIMESTAMP, UUID, Column, String
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import JSONB

from oss.src.core.gateways.mcps.dtos import MCPAuthScheme
from oss.src.dbs.postgres.shared.dbas import (
    DataDBA,
    FlagsDBA,
    HeaderDBA,
    IdentifierDBA,
    LifecycleDBA,
    MetaDBA,
    ProjectScopeDBA,
    SlugDBA,
    StatusDBA,
    TagsDBA,
    UserScopeDBA,
)


class MCPEndpointDBA(
    ProjectScopeDBA,
    IdentifierDBA,
    SlugDBA,
    LifecycleDBA,
    HeaderDBA,
    DataDBA,
    StatusDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    """One custom MCP server."""

    __abstract__ = True

    auth_mode = Column(
        SQLEnum(MCPAuthScheme, name="gatewayauthscheme_enum"), nullable=False
    )
    secret_id = Column(UUID(as_uuid=True), nullable=True)
    # data: route, tools, settings, and OAuth configuration.


class MCPOAuthAttemptDBA(ProjectScopeDBA, UserScopeDBA, IdentifierDBA):
    """One in-flight OAuth authorization attempt.

    Short-lived by construction: created by `begin()`, deleted by the callback that
    consumes it or by the expiry sweep. Nothing ever edits or soft-deletes a row, so it
    carries no `LifecycleDBA` columns at all; `expires_at` is the only time it has.
    """

    __abstract__ = True

    # The opaque handle that travels as the `state` query parameter. The callback
    # knows nothing else, so this is the only lookup key and it is unique globally
    # rather than per project.
    state = Column(String, nullable=False)

    endpoint_id = Column(UUID(as_uuid=True), nullable=False)
    server_url = Column(String, nullable=False)
    issuer = Column(String, nullable=False)
    token_endpoint = Column(String, nullable=False)
    redirect_uri = Column(String, nullable=False)
    resource = Column(String, nullable=True)
    # The PKCE verifier. It used to ride inside `state`, readable by the very server
    # it is meant to be proved against; it stays here and never leaves the platform.
    code_verifier = Column(String, nullable=False)
    scopes = Column(JSONB, nullable=True)
    strategy = Column(String, nullable=False)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)
