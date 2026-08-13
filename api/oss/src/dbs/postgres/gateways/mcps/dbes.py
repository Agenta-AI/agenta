"""MCP plane DBEs (entities.md §3)."""

from sqlalchemy import (
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UniqueConstraint,
    text,
)

from oss.src.dbs.postgres.gateways.mcps.dbas import McpEndpointDBA, McpGrantDBA
from oss.src.dbs.postgres.shared.base import Base


class McpEndpointDBE(Base, McpEndpointDBA):
    __tablename__ = "mcp_gateway_endpoints"

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        UniqueConstraint(
            "project_id",
            "slug",
            name="uq_mcp_gateway_endpoints_project_slug",
        ),
        Index(
            "ix_mcp_gateway_endpoints_flags",
            "flags",
            postgresql_using="gin",
        ),
    )


class McpGrantDBE(Base, McpGrantDBA):
    __tablename__ = "mcp_gateway_grants"

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="CASCADE"),
        # one grant per owner per server, under a nullable owner — entities.md §2.5
        Index(
            "uq_mcp_gateway_grants_user",
            "project_id",
            "endpoint_id",
            "user_id",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
        ),
        Index(
            "uq_mcp_gateway_grants_project",
            "project_id",
            "endpoint_id",
            unique=True,
            postgresql_where=text("user_id IS NULL"),
        ),
        # the resolution read: all grants for one endpoint, then filter by owner
        Index(
            "ix_mcp_gateway_grants_endpoint",
            "project_id",
            "endpoint_id",
        ),
    )
