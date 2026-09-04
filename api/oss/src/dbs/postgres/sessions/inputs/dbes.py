from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    ForeignKeyConstraint,
    Index,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    LifecycleDBA,
    ProjectScopeDBA,
)


class SessionInputDBE(Base, ProjectScopeDBA, LifecycleDBA, IdentifierDBA):
    __tablename__ = "session_inputs"

    session_id = Column(String, nullable=False)
    content = Column(JSONB(none_as_null=True), nullable=False)
    position = Column(BigInteger, nullable=False)
    state = Column(String, nullable=False, default="pending", server_default="pending")
    policy = Column(String, nullable=False)
    idempotency_key = Column(String, nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    promoted_execution_id = Column(String, nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        CheckConstraint(
            "state IN ('pending', 'promoted', 'removed')",
            name="ck_session_inputs_state",
        ),
        CheckConstraint(
            "policy IN ('queue', 'steer')", name="ck_session_inputs_policy"
        ),
        Index("uq_session_inputs_id", "id", unique=True),
        Index(
            "uq_session_inputs_idempotency",
            "project_id",
            "session_id",
            "idempotency_key",
            unique=True,
        ),
        Index(
            "uq_session_inputs_position",
            "project_id",
            "session_id",
            "position",
            unique=True,
        ),
        Index(
            "ix_session_inputs_pending",
            "project_id",
            "session_id",
            "position",
            postgresql_where=text("state = 'pending'"),
        ),
    )
