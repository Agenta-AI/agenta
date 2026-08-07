"""add channels

Revision ID: oss000000021
Revises: oss000000020
Create Date: 2026-08-07 00:00:00.000000

WP7 (identity links) rides this same revision per workstreams/README.md's
collision table ("One migration, owned by WP1, containing WP7's tables too").
`channel_identity_links` was added by WP7 in a follow-up commit on this same
revision, never a new revision.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "oss000000021"
down_revision: Union[str, None] = "oss000000020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "channel_agents",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("connection_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("data", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("flags", JSONB(none_as_null=True), nullable=True),
        sa.Column("tags", JSONB(none_as_null=True), nullable=True),
        sa.Column("meta", sa.JSON(none_as_null=True), nullable=True),
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
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id",
            "connection_id",
            "slug",
            name="uq_channel_agents_connection_slug",
        ),
    )
    op.create_index(
        "uq_channel_agents_default",
        "channel_agents",
        ["project_id", "connection_id"],
        unique=True,
        postgresql_where=sa.text("(flags->>'is_default')::boolean"),
    )

    op.create_table(
        "channel_spaces",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("connection_id", sa.UUID(as_uuid=True), nullable=False),
        # String, not Enum: space kinds grow with each platform, and widening a
        # DB enum needs a migration. Pydantic validates the vocabulary.
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("external_key", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("data", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("flags", JSONB(none_as_null=True), nullable=True),
        sa.Column("tags", JSONB(none_as_null=True), nullable=True),
        sa.Column("meta", sa.JSON(none_as_null=True), nullable=True),
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
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id",
            "connection_id",
            "external_key",
            name="uq_channel_spaces_connection_external_key",
        ),
    )
    op.create_index(
        "ix_channel_spaces_flags",
        "channel_spaces",
        ["flags"],
        postgresql_using="gin",
    )

    op.create_table(
        "channel_grants",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("space_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("data", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("flags", JSONB(none_as_null=True), nullable=True),
        sa.Column("tags", JSONB(none_as_null=True), nullable=True),
        sa.Column("meta", sa.JSON(none_as_null=True), nullable=True),
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
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id",
            "agent_id",
            "space_id",
            name="uq_channel_grants_agent_space",
        ),
    )
    op.create_index(
        "uq_channel_grants_default",
        "channel_grants",
        ["project_id", "space_id"],
        unique=True,
        postgresql_where=sa.text("(flags->>'is_default')::boolean"),
    )

    op.create_table(
        "channel_threads",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("space_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("external_key", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("data", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("flags", JSONB(none_as_null=True), nullable=True),
        sa.Column("tags", JSONB(none_as_null=True), nullable=True),
        sa.Column("meta", sa.JSON(none_as_null=True), nullable=True),
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
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
    )
    op.create_index(
        "ix_channel_threads_current",
        "channel_threads",
        ["project_id", "space_id", "external_key", "agent_id", "created_at"],
    )

    op.create_table(
        "channel_inbox_events",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("connection_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("external_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        # origin stays an Enum: query_events_since orders by it, and only
        # declaration order guarantees PULLED before PUSHED.
        sa.Column(
            "origin",
            sa.Enum("PULLED", "PUSHED", name="channeleventorigin"),
            nullable=False,
        ),
        sa.Column("space_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("data", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("status", JSONB(none_as_null=True), nullable=True),
        sa.Column("flags", JSONB(none_as_null=True), nullable=True),
        sa.Column("tags", JSONB(none_as_null=True), nullable=True),
        sa.Column("meta", sa.JSON(none_as_null=True), nullable=True),
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
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id",
            "connection_id",
            "external_id",
            name="uq_channel_inbox_connection_external",
        ),
    )
    op.create_index(
        "ix_channel_inbox_events_log",
        "channel_inbox_events",
        ["project_id", "space_id", "origin", "id"],
    )

    op.create_table(
        "channel_inbox_triggers",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("thread_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("turn_id", sa.String(), nullable=False),
        sa.Column(
            "state",
            sa.Enum(
                "STARTED", "SETTLED", "REFUSED", "FAILED", name="channeltriggerstate"
            ),
            nullable=False,
        ),
        sa.Column("status", JSONB(none_as_null=True), nullable=True),
        sa.Column("flags", JSONB(none_as_null=True), nullable=True),
        sa.Column("tags", JSONB(none_as_null=True), nullable=True),
        sa.Column("meta", sa.JSON(none_as_null=True), nullable=True),
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
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id",
            "thread_id",
            "event_id",
            name="uq_channel_inbox_triggers_thread_event",
        ),
    )
    op.create_index(
        "ix_channel_inbox_triggers_latest",
        "channel_inbox_triggers",
        ["project_id", "thread_id", "id"],
    )

    op.create_table(
        "channel_outbox_events",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("connection_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("thread_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("turn_id", sa.String(), nullable=False),
        sa.Column("key", sa.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "state",
            sa.Enum(
                "CREATED", "SENT", "FAILED", "ABANDONED", name="channeldeliverystate"
            ),
            nullable=False,
        ),
        sa.Column("data", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("status", JSONB(none_as_null=True), nullable=True),
        sa.Column("flags", JSONB(none_as_null=True), nullable=True),
        sa.Column("tags", JSONB(none_as_null=True), nullable=True),
        sa.Column("meta", sa.JSON(none_as_null=True), nullable=True),
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
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint("project_id", "key", name="uq_channel_outbox_key"),
    )
    op.create_index(
        "ix_channel_outbox_created",
        "channel_outbox_events",
        ["project_id", "state", "created_at"],
    )

    # WP7 (identity links): platform user -> Agenta account, per specs-wp7.md.
    op.create_table(
        "channel_identity_links",
        sa.Column("id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("connection_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("external_user_key", sa.String(), nullable=False),
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
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
        sa.UniqueConstraint(
            "project_id",
            "connection_id",
            "external_user_key",
            name="uq_channel_identity_links_connection_external_user_key",
        ),
    )


def downgrade() -> None:
    op.drop_table("channel_identity_links")

    op.drop_index(
        "ix_channel_outbox_created",
        table_name="channel_outbox_events",
    )
    op.drop_table("channel_outbox_events")
    op.execute("DROP TYPE IF EXISTS channeldeliverystate")

    op.drop_index(
        "ix_channel_inbox_triggers_latest",
        table_name="channel_inbox_triggers",
    )
    op.drop_table("channel_inbox_triggers")
    op.execute("DROP TYPE IF EXISTS channeltriggerstate")

    op.drop_index(
        "ix_channel_inbox_events_log",
        table_name="channel_inbox_events",
    )
    op.drop_table("channel_inbox_events")
    op.execute("DROP TYPE IF EXISTS channeleventorigin")

    op.drop_index(
        "ix_channel_threads_current",
        table_name="channel_threads",
    )
    op.drop_table("channel_threads")

    op.drop_index(
        "uq_channel_grants_default",
        table_name="channel_grants",
    )
    op.drop_table("channel_grants")

    op.drop_index(
        "ix_channel_spaces_flags",
        table_name="channel_spaces",
    )
    op.drop_table("channel_spaces")

    op.drop_index(
        "uq_channel_agents_default",
        table_name="channel_agents",
    )
    op.drop_table("channel_agents")
