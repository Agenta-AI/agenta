"""add durable session pending inputs

Revision ID: oss000000028
Revises: oss000000027
Create Date: 2026-09-04 15:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "oss000000028"
down_revision: Union[str, None] = "oss000000027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_session_commands_kind", "session_commands", type_="check")
    op.create_check_constraint(
        "ck_session_commands_kind",
        "session_commands",
        "kind IN ('cancel', 'continue_interaction', 'continue_input')",
    )
    op.create_table(
        "session_inputs",
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("position", sa.BigInteger(), nullable=False),
        sa.Column("state", sa.String(), server_default="pending", nullable=False),
        sa.Column("policy", sa.String(), nullable=False),
        sa.Column("idempotency_key", sa.String(), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("promoted_execution_id", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=True,
        ),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_by_id", sa.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "state IN ('pending', 'promoted', 'removed')",
            name="ck_session_inputs_state",
        ),
        sa.CheckConstraint(
            "policy IN ('queue', 'steer')", name="ck_session_inputs_policy"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
    )
    op.create_index("uq_session_inputs_id", "session_inputs", ["id"], unique=True)
    op.create_index(
        "uq_session_inputs_idempotency",
        "session_inputs",
        ["project_id", "session_id", "idempotency_key"],
        unique=True,
    )
    op.create_index(
        "uq_session_inputs_position",
        "session_inputs",
        ["project_id", "session_id", "position"],
        unique=True,
    )
    op.create_index(
        "ix_session_inputs_pending",
        "session_inputs",
        ["project_id", "session_id", "position"],
        postgresql_where=sa.text("state = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index("ix_session_inputs_pending", table_name="session_inputs")
    op.drop_index("uq_session_inputs_position", table_name="session_inputs")
    op.drop_index("uq_session_inputs_idempotency", table_name="session_inputs")
    op.drop_index("uq_session_inputs_id", table_name="session_inputs")
    op.drop_table("session_inputs")
    op.drop_constraint("ck_session_commands_kind", "session_commands", type_="check")
    op.create_check_constraint(
        "ck_session_commands_kind",
        "session_commands",
        "kind IN ('cancel', 'continue_interaction')",
    )
