"""MCP plane DBA mixins (entities.md §2)."""

from sqlalchemy import UUID, Column
from sqlalchemy import Enum as SQLEnum

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
    """One custom MCP server: a registered upstream (entities.md §2)."""

    __abstract__ = True

    auth_mode = Column(
        SQLEnum(MCPAuthScheme, name="gatewayauthscheme_enum"), nullable=False
    )
    secret_id = Column(UUID(as_uuid=True), nullable=True)
    # data: { route, tools, settings, oauth } — MCPEndpointData (entities.md §2.4)
