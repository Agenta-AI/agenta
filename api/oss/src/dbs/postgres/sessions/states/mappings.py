from oss.src.core.sessions.states.dtos import (
    SessionState,
    SessionStateData,
    SessionStateFlags,
)
from oss.src.dbs.postgres.sessions.states.dbes import SessionStateDBE


def dbe_to_dto(dbe: SessionStateDBE) -> SessionState:
    data = SessionStateData.model_validate(dbe.data) if dbe.data else None
    return SessionState(
        id=dbe.id,
        project_id=dbe.project_id,
        session_id=dbe.session_id,
        data=data,
        sandbox_id=dbe.sandbox_id,
        flags=SessionStateFlags.model_validate(dbe.flags)
        if dbe.flags
        else SessionStateFlags(),
        tags=dbe.tags,
        meta=dbe.meta,
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
        deleted_at=dbe.deleted_at,
        created_by_id=dbe.created_by_id,
        updated_by_id=dbe.updated_by_id,
        deleted_by_id=dbe.deleted_by_id,
    )
