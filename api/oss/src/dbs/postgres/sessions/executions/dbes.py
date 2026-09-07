from sqlalchemy import (
    Column,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID

from oss.src.dbs.postgres.shared.base import Base


class SessionExecutionDBE(Base):
    __tablename__ = "session_executions"

    project_id = Column(UUID(as_uuid=True), nullable=False)
    session_id = Column(String, nullable=False)
    execution_id = Column(String, nullable=False)
    state = Column(String, nullable=False, default="active", server_default="active")
    parent_execution_id = Column(String, nullable=True)
    source_interaction_id = Column(UUID(as_uuid=True), nullable=True)
    error = Column(JSONB(none_as_null=True), nullable=True)
    terminal_outcome = Column(String, nullable=True)
    settled_by = Column(String, nullable=True)
    settled_at = Column(TIMESTAMP(timezone=True), nullable=True)
    ending_written_at = Column(TIMESTAMP(timezone=True), nullable=True)
    redis_reconciled_at = Column(TIMESTAMP(timezone=True), nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "session_id", "execution_id"),
        Index(
            "uq_session_executions_source_interaction",
            "project_id",
            "source_interaction_id",
            unique=True,
            postgresql_where=text("source_interaction_id IS NOT NULL"),
        ),
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
