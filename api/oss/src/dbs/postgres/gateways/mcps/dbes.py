"""MCP endpoint DBEs."""

from sqlalchemy import (
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UniqueConstraint,
)

from oss.src.dbs.postgres.gateways.mcps.dbas import (
    MCPEndpointDBA,
    MCPOAuthAttemptDBA,
)
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


class MCPOAuthAttemptDBE(Base, MCPOAuthAttemptDBA):
    __tablename__ = "mcps_oauth_attempts"

    __table_args__ = (
        # `id` alone, not the `(project_id, id)` of the endpoint tables: the browser
        # coming back from the authorization server presents `state` and nothing else,
        # so the row has to be reachable without knowing its project.
        PrimaryKeyConstraint("id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        UniqueConstraint("state", name="uq_mcps_oauth_attempts_state"),
        # The sweep scans by expiry.
        Index("ix_mcps_oauth_attempts_expires_at", "expires_at"),
    )
