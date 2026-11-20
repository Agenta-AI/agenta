"""Whether a person sent a turn, and when a server input must wait for a person.

`enqueue_session_input` and the queue promotion at a turn end apply the hold rule, and the
cap of turns in a row in that rule reads `is_sent_by_person`. Later the answer at the
approval gate reads it too, so each fact is derived in one place.
"""

from typing import Any, Awaitable, Callable, Optional
from uuid import UUID

from oss.src.core.access.dtos import RunOrigin
from oss.src.core.sessions.executions.dtos import SessionExecutionSettlement
from oss.src.core.sessions.executions.interfaces import SessionExecutionsDAOInterface
from oss.src.core.sessions.inputs.dtos import PendingInputKind
from oss.src.core.sessions.inputs.interfaces import SessionInputsDAOInterface
from oss.src.core.sessions.streams.interfaces import SessionStreamsDAOInterface
from oss.src.core.sessions.turns.dtos import SessionTurnQuery
from oss.src.core.sessions.turns.interfaces import SessionTurnsDAOInterface
from oss.src.core.shared.dtos import Windowing


# Run origins of turns that no person sent: an agent in another session wrote the
# message, a trigger fired it, or it is part of an evaluation or a blocking call.
_ORIGINS_NOT_SENT_BY_PERSON = frozenset(
    {
        RunOrigin.CALLING_SESSION,
        RunOrigin.SCHEDULE,
        RunOrigin.SUBSCRIPTION,
        RunOrigin.EVALUATION,
        RunOrigin.CHILD,
    }
)


async def turn_first_execution(
    *,
    executions_dao: SessionExecutionsDAOInterface,
    project_id: UUID,
    session_id: str,
    execution: SessionExecutionSettlement,
    transaction: Optional[Any] = None,
) -> Optional[SessionExecutionSettlement]:
    """The execution that started the turn of `execution`, or None when the chain is broken.

    Each approval resume is a new execution whose parent is the paused one. Walk the
    parents back to the execution that started the turn: the first one that was not
    created by an approval. A queued input's continuation also has a parent (the turn
    before it), but it starts its own turn, so the walk stops there. The chain is broken
    when a parent row is missing or an execution id comes back (a cycle)."""
    visited = {execution.execution_id}
    while (
        execution.source_interaction_id is not None
        and execution.parent_execution_id is not None
    ):
        if execution.parent_execution_id in visited:
            return None
        visited.add(execution.parent_execution_id)
        parent = await executions_dao.fetch_execution(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution.parent_execution_id,
            transaction=transaction,
        )
        if parent is None:
            return None
        execution = parent
    return execution


async def is_sent_by_person(
    *,
    executions_dao: SessionExecutionsDAOInterface,
    inputs_dao: SessionInputsDAOInterface,
    turns_dao: SessionTurnsDAOInterface,
    project_id: UUID,
    session_id: str,
    execution_id: str,
) -> bool:
    """True when a person sent the turn of `execution_id`, from the app, a channel or
    an API key. False when a server input started it, when its run origin is one of
    `_ORIGINS_NOT_SENT_BY_PERSON`, when the turn has no row or no run origin, or when
    its chain of approval continuations is broken.

    A person's message into an idle session writes no input row, so no row reads as a
    `message`. Every lookup is scoped to `project_id` and `session_id`."""
    execution = await executions_dao.fetch_execution(
        project_id=project_id,
        session_id=session_id,
        execution_id=execution_id,
    )
    first_id = execution_id
    if execution is not None:
        # A first execution may have no row yet: it gets one when it settles. A
        # continuation always has one.
        first = await turn_first_execution(
            executions_dao=executions_dao,
            project_id=project_id,
            session_id=session_id,
            execution=execution,
        )
        if first is None:
            return False
        first_id = first.execution_id
    promoted = await inputs_dao.fetch_by_execution_id(
        project_id=project_id,
        session_id=session_id,
        execution_id=first_id,
    )
    if promoted is not None and promoted.kind != PendingInputKind.message:
        return False
    try:
        turn_id = UUID(first_id)
    except ValueError:
        return False
    turn = await turns_dao.find_turn(
        project_id=project_id,
        session_id=session_id,
        turn_id=turn_id,
    )
    if turn is None or turn.context is None:
        return False
    return turn.context.origin not in _ORIGINS_NOT_SENT_BY_PERSON


async def server_input_waits(
    *,
    streams_dao: SessionStreamsDAOInterface,
    executions_dao: SessionExecutionsDAOInterface,
    inputs_dao: SessionInputsDAOInterface,
    turns_dao: SessionTurnsDAOInterface,
    cancelled_by_steer: Callable[..., Awaitable[bool]],
    project_id: UUID,
    session_id: str,
    turns_without_person_limit: int,
) -> bool:
    """The one rule for a server input: it starts no turn when a person ended the
    session, when a person stopped its latest execution, or when no person sent any of
    its last `turns_without_person_limit` turns. It then waits in the queue and runs
    after the person's next turn.

    A Steer also stops an execution, but its reply runs next, so it is not a person
    stopping the session."""
    stream = await streams_dao.get_by_session_id_including_archived(
        project_id=project_id,
        session_id=session_id,
    )
    if stream is not None and stream.deleted_at is not None:
        return True
    # `turn_id` on the stream is the session's latest execution, approval
    # continuations included; it is never cleared when the turn ends.
    if stream is not None and stream.turn_id:
        latest = await executions_dao.fetch_execution(
            project_id=project_id,
            session_id=session_id,
            execution_id=stream.turn_id,
        )
        if (
            latest is not None
            and latest.terminal_outcome == "stopped"
            and not await cancelled_by_steer(
                project_id=project_id,
                session_id=session_id,
                execution_id=stream.turn_id,
            )
        ):
            return True
    turns = await turns_dao.query_turns(
        project_id=project_id,
        query=SessionTurnQuery(session_id=session_id),
        windowing=Windowing(limit=turns_without_person_limit, order="descending"),
    )
    if len(turns) < turns_without_person_limit:
        return False
    for turn in turns:
        if turn.turn_id is not None and await is_sent_by_person(
            executions_dao=executions_dao,
            inputs_dao=inputs_dao,
            turns_dao=turns_dao,
            project_id=project_id,
            session_id=session_id,
            execution_id=str(turn.turn_id),
        ):
            return False
    return True
