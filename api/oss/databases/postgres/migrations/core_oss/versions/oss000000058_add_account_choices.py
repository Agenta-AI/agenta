"""add account choices

`account_choices` holds one row per person, agent and "user" item: the account the
person picked for that item of that agent. A row points to exactly one account, a
`secrets` row or a `gateway_connections` row. Every foreign key cascades, so the database
deletes a choice when the person, the agent, the project or the account goes. Rows are
deleted, never archived.

The table is new and empty, so its indexes are built in the same transaction. The
foreign keys to existing tables take a short lock on them, under a lock timeout.

Revision ID: oss000000058
Revises: oss000000057
Create Date: 2026-10-29 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "oss000000058"
down_revision: Union[str, None] = "oss000000057"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        "account_choices",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("artifact_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_key", sa.String(), nullable=False),
        sa.Column("secret_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "gateway_connection_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_account_choices"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
            name="fk_account_choices_project_id",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "artifact_id"],
            ["workflow_artifacts.project_id", "workflow_artifacts.id"],
            ondelete="CASCADE",
            name="fk_account_choices_artifact",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name="fk_account_choices_user_id",
        ),
        sa.ForeignKeyConstraint(
            ["secret_id"],
            ["secrets.id"],
            ondelete="CASCADE",
            name="fk_account_choices_secret_id",
        ),
        sa.ForeignKeyConstraint(
            ["gateway_connection_id"],
            ["gateway_connections.id"],
            ondelete="CASCADE",
            name="fk_account_choices_gateway_connection_id",
        ),
        sa.CheckConstraint(
            "num_nonnulls(secret_id, gateway_connection_id) = 1",
            name="ck_account_choices_single_account",
        ),
        sa.UniqueConstraint(
            "project_id",
            "artifact_id",
            "user_id",
            "item_key",
            name="uq_account_choices_project_id_artifact_id_user_id_item_key",
        ),
        if_not_exists=True,
    )
    op.create_index(
        "ix_account_choices_user_id",
        "account_choices",
        ["user_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_account_choices_secret_id",
        "account_choices",
        ["secret_id"],
        postgresql_where=sa.text("secret_id IS NOT NULL"),
        if_not_exists=True,
    )
    op.create_index(
        "ix_account_choices_gateway_connection_id",
        "account_choices",
        ["gateway_connection_id"],
        postgresql_where=sa.text("gateway_connection_id IS NOT NULL"),
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_table("account_choices", if_exists=True)
