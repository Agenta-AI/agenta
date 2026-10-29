"""add session commands, and the two session_streams columns a Stop needs

A user Stop reached the runner only through the absence of a Redis lock, discovered on the next
heartbeat up to 30 seconds later. Nothing recorded that a Stop had been asked for, so a Stop
against an unreachable runner was simply lost and no execution ever reached a terminal outcome
anyone could read.

`session_commands` is that record. One row per durable request to change an execution. `state`
is where the COMMAND is (pending, claimed, applied, obsolete); `outcome` is what happened to the
EXECUTION (stopped, not_running, superseded_by_newer_turn, failed, lost). The two are separate
columns because they answer different questions and settle at different times.

Two columns join `session_streams`:

  * `stopping_turn_id` names the execution an accepted Stop is waiting on, written in the same
    transaction as the command insert and cleared at settlement.
  * `turn_started_at` records when the row's current `turn_id` started. Nothing else could serve
    the stale-Stop guard: `updated_at` is the heartbeat timestamp and moves every 30 seconds,
    runner-minted turn ids are uuid4 and carry no time, the Redis lock value is a bare turn id
    that a Lua compare reads whole, and the `session_turns` append is fire-and-forget so a
    running turn may have no row at all.

Both are nullable and backfill to NULL. A row written before this migration yields no
comparison, and the guard then does not fire — deliberately, because a guard that refused every
Stop it could not verify would break the common case to protect a rare one.

Revision ID: oss000000022
Revises: oss000000021
Create Date: 2026-09-02 23:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "oss000000022"
down_revision: Union[str, None] = "oss000000021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "session_commands",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("target_turn_id", sa.String(), nullable=True),
        sa.Column("expected_turn_id", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("claimed_by", sa.String(), nullable=True),
        sa.Column("claim_expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "claim_count",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column("outcome", sa.String(), nullable=True),
        sa.Column("idempotency_key", sa.String(), nullable=True),
        sa.Column("settled_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column(
            "flags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
        sa.Column(
            "tags",
            postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
        sa.Column("meta", sa.JSON(), nullable=True),
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
        sa.CheckConstraint("kind IN ('cancel')", name="ck_session_commands_kind"),
        sa.CheckConstraint(
            "state IN ('pending', 'claimed', 'applied', 'obsolete')",
            name="ck_session_commands_state",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id",
            "session_id",
            "idempotency_key",
            name="uq_session_commands_idempotency",
        ),
    )
    # One open command per target execution, enforced by the database because admission's
    # read-then-insert races itself: two Stops in the same instant both find no open command.
    op.create_index(
        "uq_session_commands_open_target",
        "session_commands",
        ["project_id", "session_id", "kind", "target_turn_id"],
        unique=True,
        postgresql_where=sa.text(
            "state IN ('pending', 'claimed') AND deleted_at IS NULL"
        ),
    )
    op.create_index(
        "ix_session_commands_open",
        "session_commands",
        ["project_id", "session_id", "created_at"],
        postgresql_where=sa.text(
            "state IN ('pending', 'claimed') AND deleted_at IS NULL"
        ),
    )
    op.create_index(
        "ix_session_commands_claims",
        "session_commands",
        ["claim_expires_at"],
        postgresql_where=sa.text("state = 'claimed' AND deleted_at IS NULL"),
    )
    op.create_index(
        "ix_session_commands_project_session",
        "session_commands",
        ["project_id", "session_id", "created_at"],
    )
    # The runner reports an outcome with the command id alone; it holds no project credential,
    # so that read cannot use the primary key's leading column.
    op.create_index(
        "ix_session_commands_id",
        "session_commands",
        ["id"],
    )

    op.add_column(
        "session_streams",
        sa.Column("stopping_turn_id", sa.String(), nullable=True),
    )
    op.add_column(
        "session_streams",
        sa.Column("turn_started_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("session_streams", "turn_started_at")
    op.drop_column("session_streams", "stopping_turn_id")
    op.drop_index("ix_session_commands_id", table_name="session_commands")
    op.drop_index("ix_session_commands_project_session", table_name="session_commands")
    op.drop_index("ix_session_commands_claims", table_name="session_commands")
    op.drop_index("ix_session_commands_open", table_name="session_commands")
    op.drop_index("uq_session_commands_open_target", table_name="session_commands")
    op.drop_table("session_commands")
