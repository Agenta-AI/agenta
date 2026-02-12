from uuid_extensions import uuid7

from sqlalchemy import (
    Boolean,
    Column,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    String,
    TIMESTAMP,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import ProjectScopeDBA


class ConnectionDBE(Base, ProjectScopeDBA):
    __tablename__ = "tool_connections"

    id = Column(UUID(as_uuid=True), nullable=False, default=uuid7)
    slug = Column(String, nullable=False)
    name = Column(String, nullable=True)
    description = Column(String, nullable=True)
    #
    provider_key = Column(String, nullable=False)
    integration_key = Column(String, nullable=False)
    #
    provider_connection_id = Column(String, nullable=True)
    auth_config_id = Column(String, nullable=True)
    #
    is_active = Column(Boolean, nullable=False, default=True)
    is_valid = Column(Boolean, nullable=False, default=False)
    status = Column(String, nullable=True)
    #
    created_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )
    updated_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_by_id = Column(UUID(as_uuid=True), nullable=False)

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint(
            "project_id",
            "provider_key",
            "integration_key",
            "slug",
            name="uq_tool_connections_project_provider_integration_slug",
        ),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        Index(
            "ix_tool_connections_project_provider_integration",
            "project_id",
            "provider_key",
            "integration_key",
        ),
    )
