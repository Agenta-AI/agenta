from sqlalchemy import (
    Column,
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UUID,
    text,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import LifecycleDBA
from oss.src.dbs.postgres.secrets.dbas import SecretsDBA


class SecretsDBE(Base, SecretsDBA):
    __tablename__ = "secrets"

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name="fk_secrets_user_id",
        ),
        Index(
            "uq_secrets_project_id_slug",
            "project_id",
            "slug",
            unique=True,
            postgresql_where=text("slug IS NOT NULL"),
        ),
        # Organization rows (project_id NULL) have their own slug space. SSO rows have no
        # slug, so they never collide.
        Index(
            "uq_secrets_organization_id_slug",
            "organization_id",
            "slug",
            unique=True,
            postgresql_where=text(
                "project_id IS NULL AND user_id IS NULL AND slug IS NOT NULL"
            ),
        ),
        # Each person's slugs, per organization.
        Index(
            "uq_secrets_user_slug",
            "organization_id",
            "user_id",
            "slug",
            unique=True,
            postgresql_where=text("user_id IS NOT NULL"),
        ),
        Index(
            "ix_secrets_organization_id",
            "organization_id",
            postgresql_where=text("project_id IS NULL"),
        ),
        CheckConstraint(
            "(project_id IS NOT NULL AND organization_id IS NULL AND user_id IS NULL) "
            "OR (project_id IS NULL AND organization_id IS NOT NULL)",
            name="ck_secrets_single_owner",
        ),
        CheckConstraint(
            "user_id IS NULL OR kind IN "
            "('CUSTOM_SECRET', 'SUBSCRIPTION_PROVIDER', 'OAUTH_GRANT', 'MCP_TOKEN')",
            name="ck_secrets_user_kinds",
        ),
        CheckConstraint(
            "availability IN ('all_projects', 'selected_projects')",
            name="ck_secrets_availability",
        ),
    )


class SecretProjectDBE(Base, LifecycleDBA):
    """A project that an organization credential limited to `selected_projects` reaches.

    The DAO writes rows only for an organization row of the same organization as the
    project; the schema does not enforce the organization match. It carries the six
    lifecycle columns of the table convention; only `created_at` and `created_by_id` are
    written.
    """

    __tablename__ = "secret_projects"

    __table_args__ = (
        PrimaryKeyConstraint("secret_id", "project_id", name="pk_secret_projects"),
        ForeignKeyConstraint(
            ["secret_id"],
            ["secrets.id"],
            ondelete="CASCADE",
            name="fk_secret_projects_secret_id",
        ),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
            name="fk_secret_projects_project_id",
        ),
        Index("ix_secret_projects_project_id", "project_id"),
    )

    secret_id = Column(UUID(as_uuid=True), nullable=False)
    project_id = Column(UUID(as_uuid=True), nullable=False)
