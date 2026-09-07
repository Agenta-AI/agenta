from sqlalchemy import (
    Column,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    String,
    text,
)
from sqlalchemy import TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID

from oss.src.dbs.postgres.shared.base import Base


class SessionExecutionDBE(Base):
    __tablename__ = "session_executions"

    project_id = Column(UUID(as_uuid=True), nullable=False)
    session_id = Column(String, nullable=False)
    execution_id = Column(String, nullable=False)
    terminal_outcome = Column(String, nullable=False)
    settled_by = Column(String, nullable=False)
    settled_at = Column(TIMESTAMP(timezone=True), nullable=False)
    ending_written_at = Column(TIMESTAMP(timezone=True), nullable=True)
    redis_reconciled_at = Column(TIMESTAMP(timezone=True), nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "session_id", "execution_id"),
        Index(
            "ix_session_executions_project_session",
            "project_id",
            "session_id",
        ),
        Index(
            "ix_session_executions_ending_unwritten",
            "settled_at",
            postgresql_where=text("ending_written_at IS NULL"),
        ),
        Index(
            "ix_session_executions_redis_unreconciled",
            "settled_at",
            postgresql_where=text(
                "settled_by = 'runner' AND terminal_outcome = 'stopped' "
                "AND redis_reconciled_at IS NULL"
            ),
        ),
    )
