from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    String,
    TIMESTAMP,
    func,
)
from sqlalchemy.dialects.postgresql import UUID

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import LifecycleDBA, ProjectScopeDBA


class AgentAccessDBE(Base, ProjectScopeDBA, LifecycleDBA):
    """The access policy of one agent.

    No row means the agent is project-visible and has no owner. An ownerless agent never
    gets a row, so `owner_user_id` is never null. The owner has no foreign key, like every
    `created_by_id`: a deleted user is not an active member, so the agent locks.
    """

    __tablename__ = "agent_access"

    artifact_id = Column(UUID(as_uuid=True), nullable=False)
    visibility = Column(String, nullable=False)
    owner_user_id = Column(UUID(as_uuid=True), nullable=False)

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "artifact_id"),
        ForeignKeyConstraint(
            ["project_id", "artifact_id"],
            ["workflow_artifacts.project_id", "workflow_artifacts.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "visibility IN ('private', 'project')",
            name="ck_agent_access_visibility",
        ),
        Index(
            "ix_agent_access_project_id_owner_user_id",
            "project_id",
            "owner_user_id",
        ),
    )


class SessionGrantDBE(Base, ProjectScopeDBA):
    """A named Viewer or Participant grant on one session. The owner is never a grant."""

    __tablename__ = "session_grants"

    stream_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    role = Column(String, nullable=False)
    created_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=True,
    )
    created_by_id = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "stream_id", "user_id"),
        ForeignKeyConstraint(
            ["project_id", "stream_id"],
            ["session_streams.project_id", "session_streams.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "role IN ('viewer', 'participant')",
            name="ck_session_grants_role",
        ),
        Index(
            "ix_session_grants_project_id_user_id",
            "project_id",
            "user_id",
        ),
    )
