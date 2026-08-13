"""MCP plane DBA mixins (entities.md §2)."""

from sqlalchemy import UUID, Column
from sqlalchemy import Enum as SQLEnum

from oss.src.core.gateways.dtos import GatewayAuthScheme
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
)


class McpEndpointDBA(
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
    """One custom MCP server: a registered upstream (entities.md §2)."""

    __abstract__ = True

    auth_mode = Column(
        SQLEnum(GatewayAuthScheme, name="gatewayauthscheme_enum"), nullable=False
    )
    secret_id = Column(UUID(as_uuid=True), nullable=True)
    # data: { url, headers, tool_policy, config, oauth } — McpEndpointData (entities.md §2.4)


class McpGrantDBA(
    ProjectScopeDBA,
    IdentifierDBA,
    LifecycleDBA,
    StatusDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    """One owner's authorization on one server — a pointer at the vault, plus the
    operational facts the encrypted payload cannot serve (entities.md §2, D18)."""

    __abstract__ = True

    endpoint_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    # NULL = project-owned; a UUID = that member's grant in this project (§2.5).
    secret_id = Column(UUID(as_uuid=True), nullable=False)
    # No DataDBA, no HeaderDBA, no SlugDBA, no expires_at column — entities.md §2
    # is explicit these are absent. Do not add them.
