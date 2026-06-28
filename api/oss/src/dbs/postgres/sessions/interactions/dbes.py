from sqlalchemy import (
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UniqueConstraint,
    text,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.sessions.interactions.dbas import SessionInteractionDBA


class SessionInteractionDBE(Base, SessionInteractionDBA):
    __tablename__ = "session_interactions"

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint(
            "project_id",
            "session_id",
            "token",
            name="uq_session_interactions_project_session_token",
        ),
        Index(
            "ix_session_interactions_project_id_created_at",
            "project_id",
            "created_at",
        ),
        Index(
            "ix_session_interactions_project_id_session_id",
            "project_id",
            "session_id",
        ),
        Index(
            "ix_session_interactions_token",
            "project_id",
            "session_id",
            "token",
        ),
        Index(
            "ix_session_interactions_pending",
            "project_id",
            postgresql_where=text(
                "(status->>'code') = 'pending' AND deleted_at IS NULL"
            ),
        ),
    )
