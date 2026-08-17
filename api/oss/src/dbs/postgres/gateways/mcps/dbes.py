"""MCP plane DBEs (entities.md §3)."""

from sqlalchemy import (
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UniqueConstraint,
)

from oss.src.dbs.postgres.gateways.mcps.dbas import MCPEndpointDBA
from oss.src.dbs.postgres.shared.base import Base


class MCPEndpointDBE(Base, MCPEndpointDBA):
    __tablename__ = "mcps_endpoints"

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        UniqueConstraint(
            "project_id",
            "slug",
            name="uq_mcps_endpoints_project_slug",
        ),
        Index(
            "ix_mcps_endpoints_flags",
            "flags",
            postgresql_using="gin",
        ),
    )
