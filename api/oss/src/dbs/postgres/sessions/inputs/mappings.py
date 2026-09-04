from typing import Optional
from uuid import UUID

from oss.src.core.sessions.inputs.dtos import PendingInput, PendingInputState
from oss.src.dbs.postgres.sessions.inputs.dbes import SessionInputDBE


def to_pending_input(row: SessionInputDBE) -> PendingInput:
    return PendingInput(
        id=row.id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        deleted_at=row.deleted_at,
        created_by_id=row.created_by_id,
        updated_by_id=row.updated_by_id,
        deleted_by_id=row.deleted_by_id,
        project_id=row.project_id,
        session_id=row.session_id,
        content=row.content,
        position=row.position,
        state=PendingInputState(row.state),
        policy=row.policy,
        idempotency_key=row.idempotency_key,
        request_fingerprint=row.request_fingerprint,
        promoted_execution_id=row.promoted_execution_id,
    )


def new_input_row(
    *, user_id: Optional[UUID], values: dict, position: int
) -> SessionInputDBE:
    return SessionInputDBE(
        **values,
        position=position,
        created_by_id=user_id,
    )
