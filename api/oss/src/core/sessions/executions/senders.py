"""Whether a person sent a turn: one predicate for every rule that needs it.

The cap of turns in a row in `enqueue_session_input` reads it, and later the answer at
the approval gate does too, so the fact is derived in one place.
"""

from uuid import UUID

from oss.src.core.access.dtos import RunOrigin
from oss.src.core.sessions.executions.interfaces import SessionExecutionsDAOInterface
from oss.src.core.sessions.inputs.dtos import PendingInputKind
from oss.src.core.sessions.inputs.interfaces import SessionInputsDAOInterface
from oss.src.core.sessions.turns.interfaces import SessionTurnsDAOInterface


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

# A guard on the parent walk; a real turn has a few approval continuations at most.
_MAX_CONTINUATIONS = 64


async def first_execution_id(
    *,
    executions_dao: SessionExecutionsDAOInterface,
    project_id: UUID,
    session_id: str,
    execution_id: str,
) -> str:
    """The first execution of the turn that `execution_id` belongs to.

    An approval continuation is a new execution whose row names its parent. The first
    execution may have no row yet (it gets one when it settles)."""
    current = execution_id
    seen = {current}
    for _ in range(_MAX_CONTINUATIONS):
        row = await executions_dao.fetch_execution(
            project_id=project_id,
            session_id=session_id,
            execution_id=current,
        )
        parent = row.parent_execution_id if row is not None else None
        if not parent or parent in seen:
            return current
        seen.add(parent)
        current = parent
    return current


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
    `_ORIGINS_NOT_SENT_BY_PERSON`, or when the turn has no row or no run origin.

    A person's message into an idle session writes no input row, so no row reads as a
    `message`. Every lookup is scoped to `project_id` and `session_id`."""
    first = await first_execution_id(
        executions_dao=executions_dao,
        project_id=project_id,
        session_id=session_id,
        execution_id=execution_id,
    )
    promoted = await inputs_dao.fetch_by_execution_id(
        project_id=project_id,
        session_id=session_id,
        execution_id=first,
    )
    if promoted is not None and promoted.kind != PendingInputKind.message:
        return False
    try:
        turn_id = UUID(first)
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
