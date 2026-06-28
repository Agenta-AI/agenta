from typing import Optional
from uuid import UUID

from oss.src.core.sessions.dtos import (
    SessionStream,
    SessionStreamCreate,
    SessionStreamEdit,
    SessionStreamStatus,
)
from oss.src.dbs.postgres.sessions.dbes import SessionStreamDBE


def map_stream_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: Optional[UUID],
    stream: SessionStreamCreate,
) -> SessionStreamDBE:
    return SessionStreamDBE(
        project_id=project_id,
        created_by_id=user_id,
        session_id=stream.session_id,
        attached=stream.attached,
        sandbox_live=stream.sandbox_live,
        status=stream.status.model_dump(mode="json") if stream.status else None,
    )


def map_stream_dbe_to_dto(
    *,
    stream_dbe: SessionStreamDBE,
) -> SessionStream:
    return SessionStream(
        id=stream_dbe.id,
        created_at=stream_dbe.created_at,
        updated_at=stream_dbe.updated_at,
        deleted_at=stream_dbe.deleted_at,
        created_by_id=stream_dbe.created_by_id,
        updated_by_id=stream_dbe.updated_by_id,
        deleted_by_id=stream_dbe.deleted_by_id,
        project_id=stream_dbe.project_id,
        session_id=stream_dbe.session_id,
        attached=stream_dbe.attached,
        sandbox_live=stream_dbe.sandbox_live,
        last_seen_at=stream_dbe.last_seen_at,
        status=SessionStreamStatus.model_validate(stream_dbe.status)
        if stream_dbe.status
        else SessionStreamStatus(),
    )


def map_stream_dto_to_dbe_edit(
    *,
    stream_dbe: SessionStreamDBE,
    user_id: Optional[UUID],
    stream: SessionStreamEdit,
) -> None:
    stream_dbe.updated_by_id = user_id
    if stream.attached is not None:
        stream_dbe.attached = stream.attached
    if stream.sandbox_live is not None:
        stream_dbe.sandbox_live = stream.sandbox_live
    if stream.last_seen_at is not None:
        stream_dbe.last_seen_at = stream.last_seen_at
    if stream.status is not None:
        stream_dbe.status = stream.status.model_dump(mode="json")
