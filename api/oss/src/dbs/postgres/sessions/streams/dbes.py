from sqlalchemy import (
    Boolean,
    Column,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    String,
    TIMESTAMP,
    UniqueConstraint,
    func,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    LifecycleDBA,
    ProjectScopeDBA,
    StatusDBA,
)


class SessionStreamDBE(Base, IdentifierDBA, ProjectScopeDBA, LifecycleDBA, StatusDBA):
    """Ephemeral run/liveness facet for a session.

    1:1 with session_id (unique constraint). sandbox_id is NOT stored here —
    it lives in session_states (sessions-persistence worktree).
    """

    __tablename__ = "session_streams"

    # Bare string correlator — NOT an FK (sessions may be external).
    session_id = Column(String, nullable=False)

    # Is a client currently watching the live view?
    attached = Column(Boolean, nullable=False, default=False)

    # Do we believe the sandbox is still alive (drives orphan sweep)?
    sandbox_live = Column(Boolean, nullable=False, default=False)

    # Heartbeat — drives orphan detection.
    last_seen_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=True,
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint(
            "session_id",
            name="uq_session_streams_session_id",
        ),
        Index(
            "ix_session_streams_project_id_created_at",
            "project_id",
            "created_at",
        ),
        Index(
            "ix_session_streams_session_id",
            "session_id",
        ),
        Index(
            "ix_session_streams_sandbox_live_last_seen_at",
            "sandbox_live",
            "last_seen_at",
        ),
    )
