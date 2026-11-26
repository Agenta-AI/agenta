from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    String,
    UniqueConstraint,
    UUID,
    text,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    LifecycleDBA,
    ProjectScopeDBA,
)


class AccountChoiceDBE(Base, ProjectScopeDBA, IdentifierDBA, LifecycleDBA):
    """For one person, one agent and one "user" item: the account to use. Rows are
    deleted, never archived; every foreign key cascades."""

    __tablename__ = "account_choices"

    artifact_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    item_key = Column(String, nullable=False)
    secret_id = Column(UUID(as_uuid=True), nullable=True)
    gateway_connection_id = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_account_choices"),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
            name="fk_account_choices_project_id",
        ),
        ForeignKeyConstraint(
            ["project_id", "artifact_id"],
            ["workflow_artifacts.project_id", "workflow_artifacts.id"],
            ondelete="CASCADE",
            name="fk_account_choices_artifact",
        ),
        ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name="fk_account_choices_user_id",
        ),
        ForeignKeyConstraint(
            ["secret_id"],
            ["secrets.id"],
            ondelete="CASCADE",
            name="fk_account_choices_secret_id",
        ),
        ForeignKeyConstraint(
            ["gateway_connection_id"],
            ["gateway_connections.id"],
            ondelete="CASCADE",
            name="fk_account_choices_gateway_connection_id",
        ),
        CheckConstraint(
            "num_nonnulls(secret_id, gateway_connection_id) = 1",
            name="ck_account_choices_single_account",
        ),
        UniqueConstraint(
            "project_id",
            "artifact_id",
            "user_id",
            "item_key",
            name="uq_account_choices_project_id_artifact_id_user_id_item_key",
        ),
        Index("ix_account_choices_user_id", "user_id"),
        Index(
            "ix_account_choices_secret_id",
            "secret_id",
            postgresql_where=text("secret_id IS NOT NULL"),
        ),
        Index(
            "ix_account_choices_gateway_connection_id",
            "gateway_connection_id",
            postgresql_where=text("gateway_connection_id IS NOT NULL"),
        ),
    )
