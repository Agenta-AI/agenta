from sqlalchemy import (
    UUID,
    Boolean,
    CheckConstraint,
    Column,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    String,
    UniqueConstraint,
    text,
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


class ConnectionDBE(
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
    __tablename__ = "gateway_connections"

    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_gateway_connections"),
        # The `trigger_subscriptions` FK target: a subscription names a project row.
        UniqueConstraint(
            "project_id", "id", name="uq_gateway_connections_project_id_id"
        ),
        ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
            name="fk_gateway_connections_organization_id",
        ),
        ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name="fk_gateway_connections_user_id",
        ),
        # A project row, an organization row, or a person's row in one organization.
        CheckConstraint(
            "(project_id IS NOT NULL AND organization_id IS NULL AND user_id IS NULL) "
            "OR (project_id IS NULL AND organization_id IS NOT NULL)",
            name="ck_gateway_connections_single_owner",
        ),
        CheckConstraint(
            "NOT is_default OR user_id IS NOT NULL",
            name="ck_gateway_connections_default_user",
        ),
        Index(
            "uq_gateway_connections_user_provider_integration_slug",
            "organization_id",
            "user_id",
            "provider_key",
            "integration_key",
            "slug",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
        ),
        Index(
            "uq_gateway_connections_organization_provider_integration_slug",
            "organization_id",
            "provider_key",
            "integration_key",
            "slug",
            unique=True,
            postgresql_where=text("project_id IS NULL AND user_id IS NULL"),
        ),
        # At most one default per person and integration.
        Index(
            "uq_gateway_connections_user_default",
            "organization_id",
            "user_id",
            "provider_key",
            "integration_key",
            unique=True,
            postgresql_where=text("is_default AND user_id IS NOT NULL"),
        ),
        # The OAuth callback's lookup of a person's row.
        Index(
            "ix_gateway_connections_user_account",
            "organization_id",
            "user_id",
            text("(data ->> 'connected_account_id')"),
            postgresql_where=text("user_id IS NOT NULL"),
        ),
        UniqueConstraint(
            "project_id",
            "provider_key",
            "integration_key",
            "slug",
            name="uq_gateway_connections_project_provider_integration_slug",
        ),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        Index(
            "ix_gateway_connections_project_provider_integration",
            "project_id",
            "provider_key",
            "integration_key",
        ),
        Index(
            "ix_gateway_connections_flags",
            "flags",
            postgresql_using="gin",
        ),
    )

    # Overrides `ProjectScopeDBA`: a person's or an organization's row has no project.
    project_id = Column(UUID(as_uuid=True), nullable=True)
    organization_id = Column(UUID(as_uuid=True), nullable=True)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    is_default = Column(Boolean, nullable=False, server_default="false", default=False)

    provider_key = Column(
        String,
        nullable=False,
    )
    integration_key = Column(
        String,
        nullable=False,
    )
