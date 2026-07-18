from sqlalchemy import (
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.sessions.turns.dbas import SessionTurnDBA


class SessionTurnDBE(Base, SessionTurnDBA):
    """One row per turn — the transcript twin of a trace. 1:many by session_id.

    No data/flags/tags/meta: every field is first-class/queryable. Resume state
    (agent_session_id/sandbox_id/turn_index) is read off the latest row, not folded.
    """

    __tablename__ = "session_turns"

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "stream_id"],
            ["session_streams.project_id", "session_streams.id"],
            ondelete="NO ACTION",
        ),
        PrimaryKeyConstraint("project_id", "id"),
        Index(
            "ix_session_turns_project_id_session_id",
            "project_id",
            "session_id",
        ),
        Index(
            "ix_session_turns_project_id_session_id_turn_index",
            "project_id",
            "session_id",
            "turn_index",
            unique=True,
        ),
        Index(
            "ix_session_turns_references",
            "references",
            postgresql_using="gin",
            postgresql_ops={"references": "jsonb_path_ops"},
        ),
    )
