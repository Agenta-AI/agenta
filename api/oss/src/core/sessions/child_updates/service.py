"""The producer of child updates (design D5).

For each turn-ended signal it checks whether the execution is a turn that a calling
session sent into a child session, and if so it writes one `child_update` input into the
calling session: the marked text of D33 plus the structured part `child_update`. When the
turn ended, it also writes the result file of D8 into the calling session's working
folder. It works inside the signal's `project_id` only, and it takes the update's
authority from server-owned rows only.
"""

import asyncio
from copy import deepcopy
from typing import Any, Awaitable, Callable, Dict, List, Optional, Protocol, Tuple
from uuid import UUID

from oss.src.core.access.dtos import RunContext, RunEnvelope, RunOrigin
from oss.src.core.sessions.child_updates.dtos import (
    ChildCancelledBy,
    ChildTurnAgent,
    ChildTurnError,
    ChildTurnResult,
    ChildTurnRevision,
    ChildTurnStatus,
    ChildTurnWaitingFor,
)
from oss.src.core.sessions.child_updates.form import (
    ERROR_MESSAGE_LIMIT,
    LAST_MESSAGE_LIMIT,
    child_update_message,
    cut_text,
    one_line,
)
from oss.src.core.sessions.child_updates.result_file import (
    last_message,
    render_result_file,
    result_file_path,
    turn_messages,
)
from oss.src.core.sessions.executions.dtos import SessionExecutionSettlement
from oss.src.core.sessions.executions.interfaces import SessionExecutionsDAOInterface
from oss.src.core.sessions.inputs.dtos import PendingInput, PendingInputKind
from oss.src.core.sessions.inputs.interfaces import SessionInputsDAOInterface
from oss.src.core.sessions.interactions.references import keyed_references
from oss.src.core.sessions.records.dtos import TERMINAL_RECORD_TYPE, SessionRecord
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.starts.dtos import SessionInputEnqueueResult
from oss.src.core.sessions.streams.interfaces import SessionStreamsDAOInterface
from oss.src.core.sessions.turns.dtos import SessionTurn
from oss.src.core.sessions.turns.interfaces import SessionTurnsDAOInterface
from oss.src.core.sharing.admission import QUEUED_DISPATCH_BOUNDARY
from oss.src.core.shared.idempotency import resource_identity
from oss.src.dbs.redis.sessions.contract import validate_session_id
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

CHILD_UPDATE_KEY_PREFIX = "ag:child_update:"

# The signal can outrun the commit of the turn's last records (the channels outbox
# measured about 150 ms): one read plus two re-reads, 0.8 s apart, as the outbox does.
_ENDING_READ_ATTEMPTS = 3
_ENDING_READ_BACKOFF_SECONDS = 0.8

# A guard on the parent walk; a real turn has a few approval continuations at most.
_MAX_EXECUTIONS_PER_TURN = 64

_STILL_RUNNING_NAMESPACE = "session-still-running"


def child_update_key(*, child_session_id: str, execution_id: str) -> str:
    """One row per child execution in the calling session (design D6)."""
    return f"{CHILD_UPDATE_KEY_PREFIX}{child_session_id}:{execution_id}"


def still_running_schedule_id(
    *, project_id: UUID, calling_session_id: str, child_input_id: UUID
) -> UUID:
    """The id of the still-running schedule of one child input (design D7). The start
    and send handlers create the schedule with it, and the producer deletes it by it, so
    neither needs a lookup and a retried call creates nothing new."""
    return resource_identity(
        project_id,
        _STILL_RUNNING_NAMESPACE,
        f"{calling_session_id}:{child_input_id}",
        "schedule",
    )


class _StartsService(Protocol):
    async def enqueue_session_input(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
        kind: PendingInputKind,
        content: Dict[str, Any],
        idempotency_key: str,
        run_envelope: RunEnvelope,
        dispatch_boundary: str,
        calling_turn_id: Optional[str] = None,
    ) -> SessionInputEnqueueResult: ...


class _ResultFileWriter(Protocol):
    async def get_or_create_session_cwd(
        self, *, project_id: UUID, user_id: UUID, session_id: str
    ) -> Any: ...

    async def write_file(
        self, *, project_id: UUID, mount_id: UUID, path: str, content: bytes
    ) -> Any: ...


AgentLookup = Callable[[UUID, UUID], Awaitable[Optional[ChildTurnAgent]]]
ScheduleDelete = Callable[[UUID, UUID], Awaitable[bool]]


class SessionChildUpdatesService:
    def __init__(
        self,
        *,
        streams_dao: SessionStreamsDAOInterface,
        inputs_dao: SessionInputsDAOInterface,
        executions_dao: SessionExecutionsDAOInterface,
        turns_dao: SessionTurnsDAOInterface,
        records_service: RecordsService,
        starts_service: _StartsService,
        result_files: Optional[_ResultFileWriter] = None,
        agent_lookup: Optional[AgentLookup] = None,
        delete_still_running_schedule: Optional[ScheduleDelete] = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._streams = streams_dao
        self._inputs = inputs_dao
        self._executions = executions_dao
        self._turns = turns_dao
        self._records = records_service
        self._starts = starts_service
        self._result_files = result_files
        self._agent_lookup = agent_lookup
        self._delete_still_running_schedule = delete_still_running_schedule
        self._sleep = sleep

    async def handle_turn_ended(
        self, *, project_id: UUID, session_id: str, execution_id: str
    ) -> Optional[SessionInputEnqueueResult]:
        """Write the child update of one ended or paused execution, once.

        Returns None when the execution reports to nobody or the update cannot be
        written for a reason no retry fixes (each such case is logged). Raises only on
        an error the caller judges with `is_short_failure`."""
        context = dict(
            project_id=str(project_id),
            session_id=session_id,
            execution_id=execution_id,
        )

        # 1. Only a turn that a calling session sent into a child session reports.
        child = await self._streams.get_by_session_id_including_archived(
            project_id=project_id, session_id=session_id
        )
        if child is None or child.calling_session is None:
            return None
        calling_session_id = child.calling_session.id

        chain, child_input = await self._turn_executions(
            project_id=project_id,
            session_id=session_id,
            execution_id=execution_id,
        )
        envelope = child_input.run_envelope if child_input is not None else None
        if (
            child_input is None
            or envelope is None
            or child_input.kind != PendingInputKind.message
            or envelope.context.origin != RunOrigin.CALLING_SESSION
        ):
            # A person's turn in the child (an idle send writes no row; a queued one has
            # origin `web`), or a turn that a child update started: no report.
            return None
        if (
            envelope.context.origin_id != calling_session_id
            or envelope.authority.project_id != project_id
        ):
            log.warning(
                "[CHILD-UPDATES] child input names another calling session or project",
                **context,
            )
            return None

        user_id = self._acting_user(child_input)
        if user_id is None:
            log.warning("[CHILD-UPDATES] child input has no acting user", **context)
            return None

        # 2. One row per child execution, whatever its content.
        key = child_update_key(child_session_id=session_id, execution_id=execution_id)
        existing = await self._inputs.fetch_by_idempotency_key(
            project_id=project_id,
            session_id=calling_session_id,
            idempotency_key=key,
        )
        if existing is not None:
            return await self._finish_existing(existing=existing, context=context)

        calling = await self._streams.get_by_session_id_including_archived(
            project_id=project_id, session_id=calling_session_id
        )
        if calling is None:
            log.warning(
                "[CHILD-UPDATES] calling session no longer exists",
                calling_session_id=calling_session_id,
                **context,
            )
            return None

        calling_turn = await self._calling_turn(
            project_id=project_id,
            calling_session_id=calling_session_id,
            child_input=child_input,
        )
        if calling_turn is None or calling_turn.context is None:
            log.warning(
                "[CHILD-UPDATES] calling turn has no row; no update is written",
                calling_session_id=calling_session_id,
                calling_turn_id=child_input.calling_turn_id,
                **context,
            )
            return None

        ending = await self._read_ending(
            project_id=project_id, session_id=session_id, chain=chain
        )
        if ending is None:
            log.error(
                "[CHILD-UPDATES] no ending found for the execution; no update is written",
                **context,
            )
            return None
        status, execution_records, execution = ending

        # 3. The still-running update is no longer needed. Safe on retry.
        if self._delete_still_running_schedule is not None:
            await self._delete_still_running_schedule(
                project_id,
                still_running_schedule_id(
                    project_id=project_id,
                    calling_session_id=calling_session_id,
                    child_input_id=child_input.id,
                ),
            )

        child_turn = await self._turns.find_turn(
            project_id=project_id, session_id=session_id, turn_id=UUID(chain[0])
        )
        messages = turn_messages(execution_records)
        result = await self._result(
            project_id=project_id,
            session_id=session_id,
            turn_id=chain[0],
            status=status,
            execution=execution,
            records=execution_records[-1],
            messages=messages,
            child_turn=child_turn,
        )

        # 4. The result file, when the turn ended. A failure leaves no `result_path`.
        if status != ChildTurnStatus.paused:
            result.result_path = await self._write_result_file(
                project_id=project_id,
                user_id=user_id,
                calling_session_id=calling_session_id,
                child_session_id=session_id,
                child_turn=child_turn,
                child_input=child_input,
                result=result,
                messages=messages,
                context=context,
            )

        # 5. The update, through the one helper, with the calling turn's authority.
        update_envelope = RunEnvelope(
            authority=envelope.authority,
            sender=envelope.sender,
            context=RunContext(
                origin=calling_turn.context.origin,
                origin_id=calling_turn.context.origin_id,
            ),
            approved_by=None,
        )
        content = {
            "session_id": calling_session_id,
            "references": keyed_references(calling_turn.references)
            or keyed_references(calling.references),
            "data": {"inputs": {"messages": [child_update_message(result)]}},
        }
        return await self._starts.enqueue_session_input(
            project_id=project_id,
            user_id=user_id,
            session_id=calling_session_id,
            kind=PendingInputKind.child_update,
            content=content,
            idempotency_key=key,
            run_envelope=update_envelope,
            dispatch_boundary=QUEUED_DISPATCH_BOUNDARY,
        )

    async def _finish_existing(
        self, *, existing: PendingInput, context: Dict[str, str]
    ) -> Optional[SessionInputEnqueueResult]:
        """The update was written before. Send its own stored row through the helper
        again, so a dispatch that an earlier delivery left unfinished completes; the
        helper writes nothing new for a key it knows. New content is never written."""
        user_id = existing.created_by_id
        if existing.run_envelope is None or user_id is None:
            return None
        log.info("[CHILD-UPDATES] update already written", **context)
        return await self._starts.enqueue_session_input(
            project_id=existing.project_id,
            user_id=user_id,
            session_id=existing.session_id,
            kind=existing.kind,
            content=deepcopy(existing.content),
            idempotency_key=existing.idempotency_key,
            run_envelope=existing.run_envelope,
            dispatch_boundary=QUEUED_DISPATCH_BOUNDARY,
        )

    @staticmethod
    def _acting_user(child_input: PendingInput) -> Optional[UUID]:
        if child_input.created_by_id is not None:
            return child_input.created_by_id
        sender = child_input.run_envelope.sender if child_input.run_envelope else None
        return sender.user_id if sender is not None else None

    async def _turn_executions(
        self, *, project_id: UUID, session_id: str, execution_id: str
    ) -> Tuple[List[str], Optional[PendingInput]]:
        """The executions of the turn, first to `execution_id`, and the input row that
        started the turn. The walk follows each execution's parent and stops at an
        execution that an input row promoted, because that execution starts its turn.

        It gives the same first execution as `turn_first_execution` for an approval
        continuation and for a promoted queued input. It does not use that function
        because it also needs every execution of the turn, and because it also follows
        the replacement of a lost continuation (a parent and no `source_interaction_id`),
        where `turn_first_execution` stops."""
        chain = [execution_id]
        current = execution_id
        for _ in range(_MAX_EXECUTIONS_PER_TURN):
            started_by = await self._inputs.fetch_by_execution_id(
                project_id=project_id, session_id=session_id, execution_id=current
            )
            if started_by is not None:
                return chain, started_by
            row = await self._executions.fetch_execution(
                project_id=project_id, session_id=session_id, execution_id=current
            )
            parent = row.parent_execution_id if row is not None else None
            if not parent or parent in chain:
                return chain, None
            chain.insert(0, parent)
            current = parent
        return chain, None

    async def _calling_turn(
        self, *, project_id: UUID, calling_session_id: str, child_input: PendingInput
    ) -> Optional[SessionTurn]:
        """The calling turn's row, by the child input's server-owned `calling_turn_id`,
        never by `parent_run_id`."""
        if not child_input.calling_turn_id:
            return None
        try:
            turn_id = UUID(child_input.calling_turn_id)
        except ValueError:
            return None
        return await self._turns.find_turn(
            project_id=project_id, session_id=calling_session_id, turn_id=turn_id
        )

    async def _read_ending(
        self, *, project_id: UUID, session_id: str, chain: List[str]
    ) -> Optional[
        Tuple[
            ChildTurnStatus,
            List[List[SessionRecord]],
            Optional[SessionExecutionSettlement],
        ]
    ]:
        """The status of the newest execution, and the records of each execution of the
        turn. Re-reads a few times while the ending is not yet visible."""
        execution_id = chain[-1]
        for attempt in range(_ENDING_READ_ATTEMPTS):
            # The records of this turn's executions only, not of the whole session.
            records = await self._records.get_execution_records(
                project_id=project_id, session_id=session_id, execution_ids=chain
            )
            by_execution: Dict[str, List[SessionRecord]] = {key: [] for key in chain}
            for record in records:
                if record.turn_id in by_execution:
                    by_execution[record.turn_id].append(record)
            execution = await self._executions.fetch_execution(
                project_id=project_id, session_id=session_id, execution_id=execution_id
            )
            status = ending_status(
                records=by_execution[execution_id], execution=execution
            )
            # A settled execution can be visible before its last records commit (the
            # record route settles first, and `complete_turn` signals too). Read again
            # until the `done` record is there; after the last read, the settled
            # outcome alone is the ending (a lost run writes no `done`).
            last_attempt = attempt == _ENDING_READ_ATTEMPTS - 1
            has_done = (
                _last(by_execution[execution_id], TERMINAL_RECORD_TYPE) is not None
            )
            if status is not None and (has_done or last_attempt):
                return status, [by_execution[key] for key in chain], execution
            if not last_attempt:
                await self._sleep(_ENDING_READ_BACKOFF_SECONDS)
        return None

    async def _result(
        self,
        *,
        project_id: UUID,
        session_id: str,
        turn_id: str,
        status: ChildTurnStatus,
        execution: Optional[SessionExecutionSettlement],
        records: List[SessionRecord],
        messages: List[Dict],
        child_turn: Optional[SessionTurn],
    ) -> ChildTurnResult:
        text, is_truncated = cut_text(last_message(messages), LAST_MESSAGE_LIMIT)
        references = keyed_references(child_turn.references if child_turn else None)
        agent = None
        workflow_id = _reference_id(references, "workflow")
        if workflow_id is not None and self._agent_lookup is not None:
            agent = await self._agent_lookup(project_id, workflow_id)
        revision_id = _reference_id(references, "workflow_revision")
        revision = (
            ChildTurnRevision(
                id=revision_id,
                version=_reference_version(references, "workflow_revision"),
            )
            if revision_id is not None
            else None
        )
        return ChildTurnResult(
            session_id=session_id,
            agent=agent,
            revision=revision,
            status=status,
            turn_id=turn_id,
            last_message=text or None,
            is_truncated=is_truncated,
            cancelled_by=(
                cancelled_by(records) if status == ChildTurnStatus.cancelled else None
            ),
            error=(
                run_error(records)
                if status in (ChildTurnStatus.failed, ChildTurnStatus.lost)
                else None
            ),
            waiting_for=(
                waiting_for(records=records)
                if status == ChildTurnStatus.paused
                else None
            ),
        )

    async def _write_result_file(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        calling_session_id: str,
        child_session_id: str,
        child_turn: Optional[SessionTurn],
        child_input: PendingInput,
        result: ChildTurnResult,
        messages: List[Dict],
        context: Dict[str, str],
    ) -> Optional[str]:
        if self._result_files is None or child_turn is None:
            if child_turn is None:
                log.warning(
                    "[CHILD-UPDATES] child turn has no row; no result file", **context
                )
            return None
        if not validate_session_id(child_session_id):
            # The id names a folder; a stored id always matches the pattern.
            log.warning(
                "[CHILD-UPDATES] child session id not valid; no result file", **context
            )
            return None
        path = result_file_path(
            child_session_id=child_session_id, turn_index=child_turn.turn_index
        )
        text = render_result_file(
            title=(
                one_line(result.agent.name)
                if result.agent and result.agent.name
                else None
            )
            or f"Child session {child_session_id}",
            turn_index=child_turn.turn_index,
            child_session_id=child_session_id,
            status=result.status.value,
            sent=_sent_text(child_input.content),
            messages=messages,
            started=child_turn.start_time,
            ended=child_turn.end_time,
            usage=child_turn.usage,
            trace_id=str(child_turn.trace_id) if child_turn.trace_id else None,
        )
        try:
            mount = await self._result_files.get_or_create_session_cwd(
                project_id=project_id, user_id=user_id, session_id=calling_session_id
            )
            await self._result_files.write_file(
                project_id=project_id,
                mount_id=mount.id,
                path=path,
                content=text.encode("utf-8"),
            )
        except Exception:  # noqa: BLE001 - the update still goes out, without the path
            log.warning(
                "[CHILD-UPDATES] result file write failed; the update has no path",
                path=path,
                **context,
                exc_info=True,
            )
            return None
        return path


def ending_status(
    *,
    records: List[SessionRecord],
    execution: Optional[SessionExecutionSettlement],
) -> Optional[ChildTurnStatus]:
    """The status of one execution: from its settled outcome (lost, or stopped by a Stop
    or a kill) and else from the stop reason of its `done` record. None while neither is
    visible yet."""
    outcome = execution.terminal_outcome if execution is not None else None
    if outcome == "lost":
        return ChildTurnStatus.lost
    done = _last(records, TERMINAL_RECORD_TYPE)
    stop_reason = (done.attributes or {}).get("stopReason") if done else None
    if stop_reason == "paused":
        return ChildTurnStatus.paused
    if outcome == "stopped" or stop_reason == "cancelled":
        return ChildTurnStatus.cancelled
    if outcome == "failed" or stop_reason == "error":
        return ChildTurnStatus.failed
    if done is not None or outcome == "completed":
        return ChildTurnStatus.completed
    return None


def cancelled_by(records: List[SessionRecord]) -> ChildCancelledBy:
    """`calling_session` when the calling agent used `cancel_session`; every other
    cancel (`steer`, a Stop, a kill: no `cancelledBy`) is a person's."""
    done = _last(records, TERMINAL_RECORD_TYPE)
    value = (done.attributes or {}).get("cancelledBy") if done else None
    return "calling_session" if value == "calling_session" else "person"


def run_error(records: List[SessionRecord]) -> Optional[ChildTurnError]:
    """The `code` and the `message` of the execution's last `error` record, the
    message cut at 300 characters. Never the `detail`."""
    error = _last(records, "error")
    if error is None:
        return None
    attributes = error.attributes or {}
    code = attributes.get("code")
    message = attributes.get("message")
    return ChildTurnError(
        code=str(code) if code is not None else None,
        message=(
            cut_text(str(message), ERROR_MESSAGE_LIMIT)[0]
            if message is not None
            else None
        ),
    )


def waiting_for(*, records: List[SessionRecord]) -> List[ChildTurnWaitingFor]:
    """What a paused execution waits for: its last interaction request."""
    request = _last(records, "interaction_request")
    if request is None:
        return []
    attributes = request.attributes or {}
    payload = attributes.get("payload")
    tool = None
    if isinstance(payload, dict):
        tool = payload.get("toolName")
        tool_call = payload.get("toolCall")
        if not tool and isinstance(tool_call, dict):
            tool = tool_call.get("name") or tool_call.get("title")
    return [
        ChildTurnWaitingFor(
            interaction_id=attributes.get("id"),
            kind=attributes.get("kind"),
            tool=tool if isinstance(tool, str) else None,
        )
    ]


def _last(records: List[SessionRecord], record_type: str) -> Optional[SessionRecord]:
    for record in reversed(records):
        if record.record_type == record_type:
            return record
    return None


def _reference_id(references: Optional[Dict[str, Any]], key: str) -> Optional[UUID]:
    value = (references or {}).get(key) or {}
    try:
        return UUID(str(value["id"])) if value.get("id") else None
    except ValueError:
        return None


def _reference_version(references: Optional[Dict[str, Any]], key: str) -> Optional[str]:
    value = (references or {}).get(key) or {}
    version = value.get("version")
    return str(version) if version is not None else None


def _sent_text(content: Dict[str, Any]) -> Optional[str]:
    """The message the calling session sent: the last message of the child input."""
    messages = ((content.get("data") or {}).get("inputs") or {}).get("messages") or []
    if not messages or not isinstance(messages[-1], dict):
        return None
    text = messages[-1].get("content")
    if isinstance(text, str):
        return text
    if isinstance(text, list):
        return "\n".join(
            block.get("text", "")
            for block in text
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return None
