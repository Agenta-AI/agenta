from typing import List, Optional
from uuid import UUID

from oss.src.core.shared.dtos import Reference
from oss.src.core.sessions.turns.dtos import (
    HarnessKind,
    SessionTurn,
    SessionTurnCreate,
)
from oss.src.dbs.postgres.sessions.turns.dbes import SessionTurnDBE


def _references_to_json(
    references: Optional[List[Reference]],
) -> Optional[List[dict]]:
    if not references:
        return None
    return [
        reference.model_dump(mode="json", exclude_none=True) for reference in references
    ]


def _references_from_json(
    references: Optional[List[dict]],
) -> Optional[List[Reference]]:
    if not references:
        return None
    return [Reference.model_validate(reference) for reference in references]


def map_turn_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: Optional[UUID],
    #
    turn: SessionTurnCreate,
) -> SessionTurnDBE:
    return SessionTurnDBE(
        project_id=project_id,
        created_by_id=user_id,
        #
        session_id=turn.session_id,
        stream_id=turn.stream_id,
        turn_index=turn.turn_index,
        harness_kind=turn.harness_kind.value,
        agent_session_id=turn.agent_session_id,
        sandbox_id=turn.sandbox_id,
        references=_references_to_json(turn.references),
        trace_id=turn.trace_id,
        span_id=turn.span_id,
        start_time=turn.start_time,
        end_time=turn.end_time,
    )


def map_turn_dbe_to_dto(
    *,
    turn_dbe: SessionTurnDBE,
) -> SessionTurn:
    return SessionTurn(
        id=turn_dbe.id,
        #
        created_at=turn_dbe.created_at,
        updated_at=turn_dbe.updated_at,
        deleted_at=turn_dbe.deleted_at,
        created_by_id=turn_dbe.created_by_id,
        updated_by_id=turn_dbe.updated_by_id,
        deleted_by_id=turn_dbe.deleted_by_id,
        #
        project_id=turn_dbe.project_id,
        session_id=turn_dbe.session_id,
        stream_id=turn_dbe.stream_id,
        turn_index=turn_dbe.turn_index,
        harness_kind=HarnessKind(turn_dbe.harness_kind),
        agent_session_id=turn_dbe.agent_session_id,
        sandbox_id=turn_dbe.sandbox_id,
        references=_references_from_json(turn_dbe.references),
        trace_id=turn_dbe.trace_id,
        span_id=turn_dbe.span_id,
        start_time=turn_dbe.start_time,
        end_time=turn_dbe.end_time,
    )
