from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UniqueConstraint,
    text,
)

from oss.src.dbs.postgres.sessions.attachments.dbas import SessionAttachmentDBA
from oss.src.dbs.postgres.shared.base import Base


class SessionAttachmentDBE(Base, SessionAttachmentDBA):
    __tablename__ = "session_attachments"

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "mount_id"],
            ["mounts.project_id", "mounts.id"],
            ondelete="CASCADE",
        ),
        PrimaryKeyConstraint("project_id", "id"),
        UniqueConstraint(
            "project_id",
            "session_id",
            "idempotency_key",
            name="uq_session_attachments_idempotency",
        ),
        CheckConstraint(
            "state IN ('pending', 'ready', 'deleting')",
            name="ck_session_attachments_state",
        ),
        CheckConstraint(
            "kind IN ('image', 'audio', 'document', 'other')",
            name="ck_session_attachments_kind",
        ),
        Index(
            "ix_session_attachments_session_state",
            "project_id",
            "session_id",
            "state",
        ),
        Index(
            "ix_session_attachments_project_mount",
            "project_id",
            "mount_id",
        ),
        Index(
            "ix_session_attachments_pending_created",
            "created_at",
            postgresql_where=text("state IN ('pending', 'deleting')"),
        ),
        Index(
            "ix_session_attachments_ready_unreferenced",
            "created_at",
            postgresql_where=text("state = 'ready' AND referenced_at IS NULL"),
        ),
    )
