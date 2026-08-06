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

    # Per-execution correlator; nullable for rows written before producers supplied it.
    turn_id = Column(UUID(as_uuid=True), nullable=True)

    # Spine: NOT NULL — every turn is written with stream_id in hand (from the heartbeat).
    stream_id = Column(UUID(as_uuid=True), nullable=False)

    turn_index = Column(Integer, nullable=False)

    # Enum-validated at the DTO (HarnessKind); plain varchar column here.
    harness_kind = Column(String, nullable=False)

    agent_session_id = Column(String, nullable=True)
    sandbox_id = Column(String, nullable=True)

    # eval_runs pattern: list of {id, slug, version} dicts, GIN jsonb_path_ops, .contains().
    references = Column(JSONB(none_as_null=True), nullable=True)

    # Bridge — nullable. trace_id is a 128-bit OTel trace id (fits UUID); span_id is a
    # 64-bit OTel span id (16 hex), NOT a UUID — stored as text (see OTelSpanId).
    trace_id = Column(UUID(as_uuid=True), nullable=True)
    span_id = Column(String, nullable=True)

    start_time = Column(TIMESTAMP(timezone=True), nullable=True)
    end_time = Column(TIMESTAMP(timezone=True), nullable=True)
