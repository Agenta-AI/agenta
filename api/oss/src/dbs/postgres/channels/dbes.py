from sqlalchemy import (
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UniqueConstraint,
    text,
)

from oss.src.dbs.postgres.channels.dbas import (
    ChannelAgentDBA,
    ChannelGrantDBA,
    ChannelInboxEventDBA,
    ChannelInboxTriggerDBA,
    ChannelOutboxEventDBA,
    ChannelSpaceDBA,
    ChannelThreadDBA,
)
from oss.src.dbs.postgres.shared.base import Base


class ChannelAgentDBE(Base, ChannelAgentDBA):
    __tablename__ = "channel_agents"

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint(
            "project_id",
            "connection_id",
            "slug",
            name="uq_channel_agents_connection_slug",
        ),
        # at most one connection-wide default agent
        Index(
            "uq_channel_agents_default",
            "project_id",
            "connection_id",
            unique=True,
            postgresql_where=text("(flags->>'is_default')::boolean"),
        ),
    )


class ChannelSpaceDBE(Base, ChannelSpaceDBA):
    __tablename__ = "channel_spaces"

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint(
            "project_id",
            "connection_id",
            "external_key",
            name="uq_channel_spaces_connection_external_key",
        ),
        Index("ix_channel_spaces_flags", "flags", postgresql_using="gin"),
    )


class ChannelGrantDBE(Base, ChannelGrantDBA):
    __tablename__ = "channel_grants"

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint(
            "project_id",
            "agent_id",
            "space_id",
            name="uq_channel_grants_agent_space",
        ),
        # at most one default agent per space
        Index(
            "uq_channel_grants_default",
            "project_id",
            "space_id",
            unique=True,
            postgresql_where=text("(flags->>'is_default')::boolean"),
        ),
    )


class ChannelThreadDBE(Base, ChannelThreadDBA):
    __tablename__ = "channel_threads"

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        # current thread for one agent in one place — no unique constraint,
        # deliberately: the table is append-only and the latest row wins
        Index(
            "ix_channel_threads_current",
            "project_id",
            "space_id",
            "external_key",
            "agent_id",
            "created_at",
        ),
    )


class ChannelInboxEventDBE(Base, ChannelInboxEventDBA):
    __tablename__ = "channel_inbox_events"

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint(
            "project_id",
            "connection_id",
            "external_id",
            name="uq_channel_inbox_connection_external",
        ),
        # the log read, in true sequence: PULLED before PUSHED, then id
        Index(
            "ix_channel_inbox_events_log",
            "project_id",
            "space_id",
            "origin",
            "id",
        ),
    )


class ChannelInboxTriggerDBE(Base, ChannelInboxTriggerDBA):
    __tablename__ = "channel_inbox_triggers"

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        # one addressing per (thread, event) — a re-route cannot double-trigger
        UniqueConstraint(
            "project_id",
            "thread_id",
            "event_id",
            name="uq_channel_inbox_triggers_thread_event",
        ),
        # this thread's latest trigger: uuid7 id IS arrival order
        Index(
            "ix_channel_inbox_triggers_latest",
            "project_id",
            "thread_id",
            "id",
        ),
    )


class ChannelOutboxEventDBE(Base, ChannelOutboxEventDBA):
    __tablename__ = "channel_outbox_events"

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        # one row per item — a re-run of the outbox worker cannot fork a message
        UniqueConstraint("project_id", "key", name="uq_channel_outbox_key"),
        # the delivery sweep: what is still owed, oldest first
        Index(
            "ix_channel_outbox_created",
            "project_id",
            "state",
            "created_at",
        ),
    )
