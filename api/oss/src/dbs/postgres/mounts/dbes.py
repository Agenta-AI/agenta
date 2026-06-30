from sqlalchemy import (
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UniqueConstraint,
    text,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.mounts.dbas import MountDBA


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
    )
