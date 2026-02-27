from sqlalchemy import (
    Column,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    String,
    UniqueConstraint,
)

from oss.src.dbs.postgres.shared.base import Base
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


class ToolConnectionDBE(
    Base,
    ProjectScopeDBA,
    IdentifierDBA,
    SlugDBA,
    LifecycleDBA,
    HeaderDBA,
    TagsDBA,
    FlagsDBA,
    DataDBA,
    StatusDBA,
    MetaDBA,
):
    __tablename__ = "tool_connections"

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

    provider_key = Column(
        String,
        nullable=False,
    )
    integration_key = Column(
        String,
        nullable=False,
    )
