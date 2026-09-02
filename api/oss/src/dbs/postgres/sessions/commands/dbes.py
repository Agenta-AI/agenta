from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UniqueConstraint,
    text,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.sessions.commands.dbas import SessionCommandDBA


class SessionCommandDBE(Base, SessionCommandDBA):
    __tablename__ = "session_commands"

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        # The caller's retry identity. Postgres treats nulls as distinct in a unique index, so a
        # command with no client key never collides with another.
        UniqueConstraint(
            "project_id",
            "session_id",
            "idempotency_key",
            name="uq_session_commands_idempotency",
        ),
        CheckConstraint("kind IN ('cancel')", name="ck_session_commands_kind"),
        CheckConstraint(
            "state IN ('pending', 'claimed', 'applied', 'obsolete')",
            name="ck_session_commands_state",
        ),
        # The claim query's index, and the open-command collapse read at admission. Partial on
        # the open states because a settled command is never claimed again.
        Index(
            "ix_session_commands_open",
            "project_id",
            "session_id",
            "created_at",
            postgresql_where=text(
                "state IN ('pending', 'claimed') AND deleted_at IS NULL"
            ),
        ),
        # The settlement sweep's index: expired leases, nothing else.
        Index(
            "ix_session_commands_claims",
            "claim_expires_at",
            postgresql_where=text("state = 'claimed' AND deleted_at IS NULL"),
        ),
        Index(
            "ix_session_commands_project_session",
            "project_id",
            "session_id",
            "created_at",
        ),
        # The runner reports an outcome with the command id ALONE (it holds no project
        # credential), so that read needs an index that does not lead with the project.
        Index(
            "ix_session_commands_id",
            "id",
        ),
    )
