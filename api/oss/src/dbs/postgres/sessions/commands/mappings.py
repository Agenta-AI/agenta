from typing import Optional
from uuid import UUID

from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandCreate,
    SessionCommandKind,
    SessionCommandOutcome,
    SessionCommandState,
)
from oss.src.dbs.postgres.sessions.commands.dbes import SessionCommandDBE


def map_command_dto_to_dbe_create(
    *,
    user_id: Optional[UUID],
    command: SessionCommandCreate,
) -> SessionCommandDBE:
    return SessionCommandDBE(
        project_id=command.project_id,
        #
        created_by_id=user_id,
        # Stamped, not defaulted: the stale-Stop guard compares this value, so the row must
        # carry exactly the instant that was compared.
        **({"created_at": command.created_at} if command.created_at else {}),
        #
        session_id=command.session_id,
        kind=command.kind.value,
        target_turn_id=command.target_turn_id,
        expected_turn_id=command.expected_turn_id,
        #
        state=command.state.value,
        claim_count=0,
        outcome=command.outcome.value if command.outcome else None,
        settled_at=command.settled_at,
        idempotency_key=command.idempotency_key,
        #
        data=command.data,
    )


def map_command_dbe_to_dto(dbe: SessionCommandDBE) -> SessionCommand:
    return SessionCommand(
        id=dbe.id,
        #
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
        deleted_at=dbe.deleted_at,
        created_by_id=dbe.created_by_id,
        updated_by_id=dbe.updated_by_id,
        deleted_by_id=dbe.deleted_by_id,
        #
        project_id=dbe.project_id,
        session_id=dbe.session_id,
        kind=SessionCommandKind(dbe.kind),
        #
        target_turn_id=dbe.target_turn_id,
        expected_turn_id=dbe.expected_turn_id,
        data=dbe.data,
        #
        state=SessionCommandState(dbe.state),
        claimed_by=dbe.claimed_by,
        claim_expires_at=dbe.claim_expires_at,
        claim_count=dbe.claim_count or 0,
        #
        outcome=SessionCommandOutcome(dbe.outcome) if dbe.outcome else None,
        idempotency_key=dbe.idempotency_key,
        settled_at=dbe.settled_at,
        #
        tags=dbe.tags,
        meta=dbe.meta,
    )
