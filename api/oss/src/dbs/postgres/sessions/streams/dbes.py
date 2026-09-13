from sqlalchemy import (
    Column,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    String,
    TIMESTAMP,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import (
    FlagsDBA,
    HeaderDBA,
    IdentifierDBA,
    LifecycleDBA,
    MetaDBA,
    ProjectScopeDBA,
    TagsDBA,
)


class SessionStreamDBE(
    Base,
    IdentifierDBA,
    ProjectScopeDBA,
    HeaderDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    """The session's one row: identity (name/description) and run/liveness (the
    durable mirror of the Redis nest, alive ⊇ running ⊇ attached).

    1:1 with session_id per project. Redis is authoritative for the nest bools;
    this row mirrors them in ``flags`` for durability / orphan sweep / observability.
    ``updated_at`` (LifecycleDBA) is the heartbeat timestamp — no separate column.
    ``description`` (HeaderDBA) is written only on the rename edit, never on a
    flag-mirror write, so heartbeats don't churn it. ``name`` and ``references`` are
    additionally FILL-ONCE: a heartbeat may write either onto a NULL column and never
    over an existing value, so a session nothing else names still gets a title while a
    rename always wins.
    sandbox_id is NOT stored here (it lives on the latest session_turns row).
    """

    __tablename__ = "session_streams"

    # Bare string correlator — NOT an FK (sessions may be external).
    session_id = Column(String, nullable=False)

    # What this session runs, as the flat tagged list session_turns already stores.
    # Duplicated off the turn on purpose: a turn append is fire-and-forget, so the row
    # itself has to carry enough to open the session.
    references = Column(JSONB(none_as_null=True), nullable=True)

    # Current turn (uuid7 minted by the service); the Postgres mirror of the Redis
    # alive/running lock value. Null when idle/ended. Not a pk — a token-like correlator.
    turn_id = Column(String, nullable=True)

    # Archive is distinct from kill: `deleted_at` (LifecycleDBA) marks a killed/ended session
    # (resumable, still listed); `archived_at` marks a deliberately-hidden one (restorable).
    archived_at = Column(TIMESTAMP(timezone=True), nullable=True)

    # The execution an accepted Stop is waiting on. Written in the same transaction as the
    # command insert, cleared at settlement. Null means nothing is stopping.
    #
    # A column and not a bit inside `flags`, because `flags` is the Redis mirror and every
    # heartbeat rewrites it whole (`streams/service.py`, the unconditional mirror write), so a
    # value stored there would be erased on the next beat. `SessionStreamEdit` carries only
    # flags/tags/meta/turn_id, so the heartbeat path cannot touch this column by accident.
    stopping_turn_id = Column(String, nullable=True)

    # When the row's CURRENT `turn_id` started. It exists for the stale-Stop guard, which has to
    # compare a Stop's arrival time with the running execution's start time, and there was
    # nowhere to read that: `updated_at` is the heartbeat timestamp and moves every 30 seconds,
    # runner-minted turn ids are uuid4 and carry no time, the Redis lock value is a bare turn id
    # that a Lua compare reads whole, and the `session_turns` append is fire-and-forget so a
    # running turn may have no row. Stamped only when the id actually changes, so the repeated
    # heartbeats that restamp the same id never move it.
    turn_started_at = Column(TIMESTAMP(timezone=True), nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint(
            "project_id",
            "session_id",
            name="uq_session_streams_project_session_id",
        ),
        Index(
            "ix_session_streams_project_id_created_at",
            "project_id",
            "created_at",
        ),
        Index(
            "ix_session_streams_project_id_archived_at",
            "project_id",
            "archived_at",
        ),
        Index(
            "ix_session_streams_flags",
            "flags",
            postgresql_using="gin",
        ),
        Index(
            "ix_session_streams_references",
            "references",
            postgresql_using="gin",
            postgresql_ops={"references": "jsonb_path_ops"},
        ),
    )
