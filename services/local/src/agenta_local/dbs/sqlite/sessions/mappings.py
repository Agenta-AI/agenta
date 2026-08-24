"""Pure DBE -> DTO converters; naive-UTC timestamps leave the DB aware."""

import json
from datetime import UTC, datetime

from agenta_local.core.sessions.dtos import (
    Message,
    MessageRole,
    Session,
    SessionStatus,
    Turn,
    TurnStatus,
)

from .dbes import MessageDBE, SessionDBE, TurnDBE


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC)


def dbe_to_session(dbe: SessionDBE) -> Session:
    return Session(
        id=dbe.id,
        agent_revision_id=dbe.agent_revision_id,
        title=dbe.title,
        status=SessionStatus(dbe.status),
        created_at=_aware(dbe.created_at),
        updated_at=_aware(dbe.updated_at),
    )


def dbe_to_turn(dbe: TurnDBE) -> Turn:
    error = json.loads(dbe.error_json) if dbe.error_json is not None else None
    return Turn(
        id=dbe.id,
        session_id=dbe.session_id,
        client_turn_id=dbe.client_turn_id,
        input_hash=dbe.input_hash,
        status=TurnStatus(dbe.status),
        error=error,
        started_at=_aware(dbe.started_at) if dbe.started_at is not None else None,
        finished_at=_aware(dbe.finished_at) if dbe.finished_at is not None else None,
    )


def dbe_to_message(dbe: MessageDBE) -> Message:
    return Message(
        id=dbe.id,
        session_id=dbe.session_id,
        turn_id=dbe.turn_id,
        sequence=dbe.sequence,
        role=MessageRole(dbe.role),
        content=json.loads(dbe.content_json),
        created_at=_aware(dbe.created_at),
    )
