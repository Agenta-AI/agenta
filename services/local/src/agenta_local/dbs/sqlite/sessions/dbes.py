from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from agenta_local.dbs.sqlite.shared.base import Base
from agenta_local.dbs.sqlite.shared.types import utc_now


class SessionDBE(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'archived')", name="ck_sessions_status_valid"
        ),
    )

    id: Mapped[str] = mapped_column(String(), primary_key=True)
    agent_revision_id: Mapped[str] = mapped_column(
        ForeignKey("agent_revisions.id", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(String(), nullable=True)
    status: Mapped[str] = mapped_column(
        String(), nullable=False, default="active", server_default="active"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(), default=utc_now, onupdate=utc_now
    )


class TurnDBE(Base):
    __tablename__ = "turns"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed', 'cancelled',"
            " 'interrupted')",
            name="ck_turns_status_valid",
        ),
        UniqueConstraint(
            "session_id", "client_turn_id", name="uq_turns_session_client_turn"
        ),
        Index(
            "uq_turns_one_active_per_session",
            "session_id",
            unique=True,
            sqlite_where=text("status IN ('pending', 'running')"),
        ),
    )

    id: Mapped[str] = mapped_column(String(), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.id", ondelete="RESTRICT"), nullable=False
    )
    client_turn_id: Mapped[str] = mapped_column(String(), nullable=False)
    input_hash: Mapped[str] = mapped_column(String(), nullable=False)
    status: Mapped[str] = mapped_column(String(), nullable=False, default="pending")
    error_json: Mapped[str | None] = mapped_column(Text(), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)


class MessageDBE(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint(
            "role IN ('user', 'assistant', 'system')", name="ck_messages_role_valid"
        ),
        UniqueConstraint("session_id", "sequence", name="uq_messages_session_sequence"),
    )

    id: Mapped[str] = mapped_column(String(), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.id", ondelete="RESTRICT"), nullable=False
    )
    turn_id: Mapped[str] = mapped_column(
        ForeignKey("turns.id", ondelete="RESTRICT"), nullable=False
    )
    sequence: Mapped[int] = mapped_column(Integer(), nullable=False)
    role: Mapped[str] = mapped_column(String(), nullable=False)
    content_json: Mapped[str] = mapped_column(Text(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utc_now)
