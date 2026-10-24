from typing import Optional
from uuid import UUID

from oss.src.core.sessions.turns.dtos import (
    HarnessKind,
    SessionTurn,
    SessionTurnCreate,
)
from oss.src.dbs.postgres.sessions.references import (
    references_from_json,
    references_to_json,
)
from oss.src.core.access.dtos import (
    RunApproval,
    RunContext,
    RunEnvelope,
    RunOrigin,
    RunSender,
)
from oss.src.dbs.postgres.access.mappings import map_principal_columns
from oss.src.dbs.postgres.sessions.turns.dbes import SessionTurnDBE


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
        turn_id=turn.turn_id,
        stream_id=turn.stream_id,
        turn_index=turn.turn_index,
        harness_kind=turn.harness_kind.value,
        agent_session_id=turn.agent_session_id,
        sandbox_id=turn.sandbox_id,
        references=references_to_json(turn.references),
        trace_id=turn.trace_id,
        span_id=turn.span_id,
        start_time=turn.start_time,
        end_time=turn.end_time,
        #
        **map_turn_attribution_to_columns(envelope=turn.envelope),
    )


def map_turn_attribution_to_columns(*, envelope: Optional[RunEnvelope]) -> dict:
    """The eight attribution columns of a turn, from the run envelope it ran under.
    All None when there is no envelope."""

    if envelope is None:
        return {
            "principal_kind": None,
            "principal_id": None,
            "sender_user_id": None,
            "sender_external_key": None,
            "origin": None,
            "origin_id": None,
            "parent_run_id": None,
            "approved_by": None,
        }
    principal = envelope.authority.principal
    sender = envelope.sender
    context = envelope.context
    return {
        "principal_kind": principal.kind.value,
        "principal_id": principal.id,
        "sender_user_id": sender.user_id if sender else None,
        "sender_external_key": sender.external_key if sender else None,
        "origin": context.origin.value,
        "origin_id": context.origin_id,
        "parent_run_id": context.parent_run_id,
        "approved_by": (
            envelope.approved_by.model_dump(mode="json")
            if envelope.approved_by
            else None
        ),
    }


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
        turn_id=turn_dbe.turn_id,
        stream_id=turn_dbe.stream_id,
        turn_index=turn_dbe.turn_index,
        harness_kind=HarnessKind(turn_dbe.harness_kind),
        agent_session_id=turn_dbe.agent_session_id,
        sandbox_id=turn_dbe.sandbox_id,
        references=references_from_json(turn_dbe.references),
        trace_id=turn_dbe.trace_id,
        span_id=turn_dbe.span_id,
        start_time=turn_dbe.start_time,
        end_time=turn_dbe.end_time,
        #
        **map_turn_attribution_dbe_to_dto(turn_dbe=turn_dbe),
    )


def map_turn_attribution_dbe_to_dto(*, turn_dbe: SessionTurnDBE) -> dict:
    """The attribution group of a turn row; every field `None` for older rows."""

    principal = map_principal_columns(
        kind=turn_dbe.principal_kind, id=turn_dbe.principal_id
    )
    sender = None
    if turn_dbe.sender_user_id is not None or turn_dbe.sender_external_key:
        sender = RunSender(
            user_id=turn_dbe.sender_user_id,
            external_key=turn_dbe.sender_external_key,
        )
    context = None
    if turn_dbe.origin is not None:
        try:
            context = RunContext(
                run_id=str(turn_dbe.turn_id) if turn_dbe.turn_id else None,
                parent_run_id=turn_dbe.parent_run_id,
                origin=RunOrigin(turn_dbe.origin),
                origin_id=turn_dbe.origin_id,
            )
        except ValueError:
            context = None
    approved_by = None
    if turn_dbe.approved_by:
        try:
            approved_by = RunApproval.model_validate(turn_dbe.approved_by)
        except ValueError:
            approved_by = None
    return {
        "principal": principal,
        "sender": sender,
        "context": context,
        "approved_by": approved_by,
    }
