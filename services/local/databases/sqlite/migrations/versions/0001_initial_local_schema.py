"""initial local schema

Revision ID: 0001
Revises:
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agents",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("current_revision_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_agents"),
        sa.ForeignKeyConstraint(
            ["current_revision_id"],
            ["agent_revisions.id"],
            name="fk_agents_current_revision_id_agent_revisions",
            ondelete="RESTRICT",
            deferrable=True,
            initially="DEFERRED",
        ),
    )
    op.create_table(
        "agent_revisions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("agent_id", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("model_json", sa.Text(), nullable=False),
        sa.Column("execution_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_agent_revisions"),
        sa.ForeignKeyConstraint(
            ["agent_id"],
            ["agents.id"],
            name="fk_agent_revisions_agent_id_agents",
            ondelete="RESTRICT",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.UniqueConstraint(
            "agent_id", "version", name="uq_agent_revisions_agent_version"
        ),
    )
    op.create_table(
        "sessions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("agent_revision_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_sessions"),
        sa.ForeignKeyConstraint(
            ["agent_revision_id"],
            ["agent_revisions.id"],
            name="fk_sessions_agent_revision_id_agent_revisions",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'archived')", name="ck_sessions_status_valid"
        ),
    )
    op.create_table(
        "turns",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("client_turn_id", sa.String(), nullable=False),
        sa.Column("input_hash", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error_json", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_turns"),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
            name="fk_turns_session_id_sessions",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed', 'cancelled',"
            " 'interrupted')",
            name="ck_turns_status_valid",
        ),
        sa.UniqueConstraint(
            "session_id", "client_turn_id", name="uq_turns_session_client_turn"
        ),
    )
    op.create_index(
        "uq_turns_one_active_per_session",
        "turns",
        ["session_id"],
        unique=True,
        sqlite_where=sa.text("status IN ('pending', 'running')"),
    )
    op.create_table(
        "messages",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("turn_id", sa.String(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_messages"),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
            name="fk_messages_session_id_sessions",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["turn_id"],
            ["turns.id"],
            name="fk_messages_turn_id_turns",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "role IN ('user', 'assistant', 'system')", name="ck_messages_role_valid"
        ),
        sa.UniqueConstraint(
            "session_id", "sequence", name="uq_messages_session_sequence"
        ),
    )
    op.execute(
        "CREATE TRIGGER agent_revisions_no_update "
        "BEFORE UPDATE ON agent_revisions "
        "BEGIN SELECT RAISE(ABORT, 'agent revisions are immutable'); END"
    )
    op.execute(
        "CREATE TRIGGER sessions_no_rebind "
        "BEFORE UPDATE OF agent_revision_id ON sessions "
        "BEGIN SELECT RAISE(ABORT, 'sessions are permanently bound to their revision');"
        " END"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS sessions_no_rebind")
    op.execute("DROP TRIGGER IF EXISTS agent_revisions_no_update")
    op.drop_table("messages")
    op.drop_index("uq_turns_one_active_per_session", table_name="turns")
    op.drop_table("turns")
    op.drop_table("sessions")
    op.drop_table("agent_revisions")
    op.drop_table("agents")
