from typing import Optional

from pydantic import ValidationError

from oss.src.utils.logging import get_module_logger
from oss.src.core.sessions.states.dtos import (
    SessionState,
    SessionStateData,
    SessionStateFlags,
)
from oss.src.dbs.postgres.sessions.states.dbes import SessionStateDBE

log = get_module_logger(__name__)


def _parse_state_data(dbe: SessionStateDBE) -> Optional[SessionStateData]:
    if not dbe.data:
        return None

    try:
        return SessionStateData.model_validate(dbe.data)
    except ValidationError as e:
        log.error(
            "[SESSION_STATES] Corrupt session_states.data; degrading to None",
            session_id=dbe.session_id,
            project_id=dbe.project_id,
            raw_data=dbe.data,
            error=str(e),
        )
        return None


def dbe_to_dto(dbe: SessionStateDBE) -> SessionState:
    data = _parse_state_data(dbe)
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
