from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.mounts.dbas import MountDBA
from oss.src.dbs.postgres.shared.dbas import LifecycleDBA, ProjectScopeDBA


class MountDBE(Base, MountDBA):
    __tablename__ = "mounts"

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint(
            "project_id",
            "slug",
            name="uq_mounts_project_id_slug",
        ),
        Index(
            "ix_mounts_project_id_created_at",
            "project_id",
            "created_at",
        ),
        Index(
            "ix_mounts_project_id_deleted_at",
            "project_id",
            "deleted_at",
        ),
        Index(
            "ix_mounts_project_id_session_id",
            "project_id",
            "session_id",
            postgresql_where=text("session_id IS NOT NULL"),
        ),
        Index(
            "uq_mounts_project_id_agent_id",
            "project_id",
            "agent_id",
            unique=True,
            postgresql_where=text("agent_id IS NOT NULL"),
        ),
    )


class MountVisibilityDBE(Base, ProjectScopeDBA, LifecycleDBA):
    """Who may open one drive: `project` (the role decides) or `private` (its owner).

    Unlike `agent_access`, a shared drive may have no owner, so every drive the API
    creates gets an explicit row. A drive with `agent_id` and no row follows its agent.
    """

    __tablename__ = "mount_visibility"

    mount_id = Column(UUID(as_uuid=True), nullable=False)
    visibility = Column(String, nullable=False)
    owner_user_id = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "mount_id"),
        ForeignKeyConstraint(
            ["project_id", "mount_id"],
            ["mounts.project_id", "mounts.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "visibility IN ('private', 'project')",
            name="ck_mount_visibility_value",
        ),
        CheckConstraint(
            "visibility <> 'private' OR owner_user_id IS NOT NULL",
            name="ck_mount_visibility_private_owner",
        ),
        Index(
            "ix_mount_visibility_project_id_owner_user_id",
            "project_id",
            "owner_user_id",
        ),
    )
