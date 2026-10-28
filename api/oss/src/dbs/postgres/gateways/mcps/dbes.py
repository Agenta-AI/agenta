"""MCP endpoint DBEs."""

from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UniqueConstraint,
    text,
)

from oss.src.dbs.postgres.gateways.mcps.dbas import (
    MCPEndpointDBA,
    MCPOAuthAttemptDBA,
)
from oss.src.dbs.postgres.shared.base import Base


class MCPEndpointDBE(Base, MCPEndpointDBA):
    __tablename__ = "mcps_endpoints"

    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_mcps_endpoints"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
            name="fk_mcps_endpoints_organization_id",
        ),
        ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name="fk_mcps_endpoints_user_id",
        ),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        # A project server, or a person's own server in one organization (M7).
        CheckConstraint(
            "(project_id IS NOT NULL AND organization_id IS NULL AND user_id IS NULL) "
            "OR (project_id IS NULL AND organization_id IS NOT NULL "
            "AND user_id IS NOT NULL)",
            name="ck_mcps_endpoints_owner",
        ),
        UniqueConstraint(
            "project_id",
            "slug",
            name="uq_mcps_endpoints_project_slug",
        ),
        Index(
            "uq_mcps_endpoints_user_slug",
            "organization_id",
            "user_id",
            "slug",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
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
