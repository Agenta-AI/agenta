from sqlalchemy import (
    Column,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    String,
    UniqueConstraint,
)

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
    ``name``/``description`` (HeaderDBA) are written only on the rename edit, never
    on a flag-mirror write, so heartbeats don't churn them.
    sandbox_id is NOT stored here (it lives in session_states).
    """

    __tablename__ = "session_streams"

    # Bare string correlator — NOT an FK (sessions may be external).
    session_id = Column(String, nullable=False)

    # Current turn (uuid7 minted by the service); the Postgres mirror of the Redis
    # alive/running lock value. Null when idle/ended. Not a pk — a token-like correlator.
    turn_id = Column(String, nullable=True)

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
            "ix_session_streams_flags",
            "flags",
            postgresql_using="gin",
        ),
    )
