from sqlalchemy import Column, Integer, String, TIMESTAMP, UUID
from sqlalchemy.dialects.postgresql import JSONB

from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    LifecycleDBA,
    ProjectScopeDBA,
)


class SessionTurnDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
):
    __abstract__ = True

    # Bare string correlator — NOT an FK (sessions may be external). Spine: NOT NULL.
    session_id = Column(String, nullable=False)

    # Spine: NOT NULL — every turn is written with stream_id in hand (from the heartbeat).
    stream_id = Column(UUID(as_uuid=True), nullable=False)

    turn_index = Column(Integer, nullable=False)

    # Enum-validated at the DTO (Harness); plain varchar column here.
    harness = Column(String, nullable=False)

    agent_session_id = Column(String, nullable=True)
    sandbox_id = Column(String, nullable=True)

    # eval_runs pattern: list of {id, slug, version} dicts, GIN jsonb_path_ops, .contains().
    references = Column(JSONB(none_as_null=True), nullable=True)

    # Bridge — nullable.
    trace_id = Column(UUID(as_uuid=True), nullable=True)
    root_span_id = Column(UUID(as_uuid=True), nullable=True)

    start_time = Column(TIMESTAMP(timezone=True), nullable=True)
    end_time = Column(TIMESTAMP(timezone=True), nullable=True)
