from typing import Optional
from uuid import UUID

from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamCreate,
    SessionStreamEdit,
    SessionStreamFlags,
    SessionStreamHeaderEdit,
)
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE


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
        name=stream.name,
        description=stream.description,
        flags=stream.flags.model_dump(mode="json") if stream.flags else None,
        tags=stream.tags,
        meta=stream.meta,
        turn_id=stream.turn_id,
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
        name=stream_dbe.name,
        description=stream_dbe.description,
        turn_id=stream_dbe.turn_id,
        archived_at=stream_dbe.archived_at,
        flags=SessionStreamFlags.model_validate(stream_dbe.flags)
        if stream_dbe.flags
        else SessionStreamFlags(),
        tags=stream_dbe.tags,
        meta=stream_dbe.meta,
    )


def map_stream_dto_to_dbe_edit(
    *,
    stream_dbe: SessionStreamDBE,
    user_id: Optional[UUID],
    stream: SessionStreamEdit,
) -> None:
    stream_dbe.updated_by_id = user_id
    if stream.name is not None:
        stream_dbe.name = stream.name
    if stream.description is not None:
        stream_dbe.description = stream.description
    if stream.flags is not None:
        stream_dbe.flags = stream.flags.model_dump(mode="json")
    if stream.tags is not None:
        stream_dbe.tags = stream.tags
    if stream.meta is not None:
        stream_dbe.meta = stream.meta
    if stream.turn_id is not None:
        stream_dbe.turn_id = stream.turn_id


def map_stream_dto_to_dbe_header_edit(
    *,
    stream_dbe: SessionStreamDBE,
    user_id: Optional[UUID],
    header: SessionStreamHeaderEdit,
) -> None:
    """The rename edit: only ever touches name/description — never flags/turn_id."""
    stream_dbe.updated_by_id = user_id
    if header.name is not None:
        stream_dbe.name = header.name
    if header.description is not None:
        stream_dbe.description = header.description
