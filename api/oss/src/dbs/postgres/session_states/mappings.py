from oss.src.core.sessions.dtos import SessionState
from oss.src.dbs.postgres.session_states.dbes import SessionStateDBE


def dbe_to_dto(dbe: SessionStateDBE) -> SessionState:
    return SessionState(
        id=dbe.id,
        project_id=dbe.project_id,
        session_id=dbe.session_id,
        data=dbe.data,
        sandbox_id=dbe.sandbox_id,
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
        deleted_at=dbe.deleted_at,
        created_by_id=dbe.created_by_id,
        updated_by_id=dbe.updated_by_id,
        deleted_by_id=dbe.deleted_by_id,
    )
