from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from agenta_local.dbs.sqlite.shared.base import Base
from agenta_local.dbs.sqlite.shared.types import utc_now


class AgentRevisionDBE(Base):
    __tablename__ = "agent_revisions"
    __table_args__ = (
        UniqueConstraint(
            "agent_id", "version", name="uq_agent_revisions_agent_version"
        ),
    )

    id: Mapped[str] = mapped_column(String(), primary_key=True)
    agent_id: Mapped[str] = mapped_column(
        ForeignKey(
            "agents.id",
            deferrable=True,
            initially="DEFERRED",
        ),
        nullable=False,
    )
    version: Mapped[int]
    instructions: Mapped[str] = mapped_column(Text(), nullable=False)
    model_json: Mapped[str] = mapped_column(Text(), nullable=False)
    execution_json: Mapped[str] = mapped_column(Text(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utc_now)


class AgentDBE(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(), primary_key=True)
    name: Mapped[str] = mapped_column(String(), nullable=False)
    current_revision_id: Mapped[str] = mapped_column(
        ForeignKey(
            "agent_revisions.id",
            deferrable=True,
            initially="DEFERRED",
        ),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(), default=utc_now, onupdate=utc_now
    )
