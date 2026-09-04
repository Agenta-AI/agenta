from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple
from uuid import UUID

from oss.src.core.sessions.records.dtos import (
    RECORD_SETTLED_BY_ATTRIBUTE,
    SETTLED_BY_WATCHDOG,
    TERMINAL_RECORD_TYPE,
    SessionDurableEventsReplay,
    SessionMessagePreview,
    SessionRecord,
    SessionRecordEvent,
    SessionRecordsPage,
    SessionRecordsReadState,
)
from oss.src.core.sessions.executions.dtos import SessionExecutionSettlement
from oss.src.core.sessions.executions.interfaces import SessionExecutionsDAOInterface
from oss.src.core.sessions.records.events import durable_events_from_records
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def _written_by_watchdog(event: SessionRecordEvent) -> bool:
    """Did the platform write this record, rather than a runner?

    Only the watchdog stamps the marker, and only the platform can: the ingest route builds
    `SessionRecordEvent` field by field out of the request body and never reads this key off
    the wire, so a runner cannot present itself as the watchdog to get past the guard below.
    """
    return (event.attributes or {}).get(
        RECORD_SETTLED_BY_ATTRIBUTE
    ) == SETTLED_BY_WATCHDOG


class RecordsService:
    def __init__(
        self,
        records_dao: RecordsDAOInterface,
        executions_dao: Optional[SessionExecutionsDAOInterface] = None,
    ):
        self.records_dao = records_dao
        self.executions_dao = executions_dao

    async def append(
        self,
        *,
        event: SessionRecordEvent,
        session: Optional[Any] = None,
    ) -> Optional[SessionRecord]:
        return await self.records_dao.append(event=event, session=session)

    async def append_many(
        self,
        *,
        events: List[SessionRecordEvent],
    ) -> List[SessionRecord]:
        """Append a batch, quarantining anything that arrives after the platform ended its turn.

        RFC "Required behavior / Execution" item 3: after an execution reaches its terminal
        outcome, later non-terminal output for it is rejected or quarantined. This is where
        that happens, because ingest is the only place both writers meet.

        The case is real and was caught live. A runner wedges, the watchdog writes the turn's
        `error` and `done` on its behalf, and the runner then THAWS and submits everything it
        had buffered — a tool call, its result, a `usage`, and a second `done`. Nothing
        downstream could refuse it: the runner-side gate in `server.ts` knows only about
        endings that request wrote itself, and the reader was left with a failure notice
        followed by the work the agent went on to do.

        Quarantine rather than reject, deliberately. The tail is real work: a late `usage`
        carries token accounting that is real money, and the tool result is the first thing a
        support engineer asks for. A dropped record cannot be looked at later; a marked one
        can, and it is already invisible to every read that rebuilds a transcript.
        """
        if not events:
            return []

        guarded = await self._handle_late_events(events=events)
        records = await self.records_dao.append_many(events=guarded)
        await self._settle_completed_continuations(records=records)
        await self._mark_endings_written(events=guarded)
        return records

    async def _mark_endings_written(
        self,
        *,
        events: List[SessionRecordEvent],
    ) -> None:
        if self.executions_dao is None or not env.agenta.sessions.durable_stop:
            return

        endings: Dict[UUID, Set[Tuple[str, str]]] = {}
        for event in events:
            if (
                event.record_type != TERMINAL_RECORD_TYPE
                or not event.turn_id
                or event.quarantined_at is not None
            ):
                continue
            endings.setdefault(event.project_id, set()).add(
                (event.session_id, event.turn_id)
            )

        for project_id, keys in endings.items():
            try:
                await self.executions_dao.mark_endings_written(
                    project_id=project_id,
                    keys=sorted(keys),
                )
            except Exception:
                log.warning(
                    "[RECORDS] Execution ending marker update failed; record remains appended",
                    project_id=str(project_id),
                    exc_info=True,
                )

    async def _settle_completed_continuations(
        self,
        *,
        records: List[SessionRecord],
    ) -> None:
        """Make a runner's durable ending the continuation's durable outcome.

        The runner flushes its terminal record before releasing its heartbeat. Without this
        bridge, an admitted continuation remained ``running`` forever; once its heartbeat went
        stale, recovery could replay work that had already completed. Only an effective runner
        ending qualifies: paused turns remain continuable, watchdog endings are not successful
        completion, and quarantined late endings already lost the Stop/watchdog race.

        Record persistence is the source of truth and happened immediately above. Settlement is
        best effort here because records and executions use different database engines; the
        watchdog repeats the reconciliation before it collapses stale ownership.
        """
        if self.executions_dao is None or not env.agenta.sessions.durable_approvals:
            return

        candidates = {
            (record.project_id, record.session_id, record.turn_id)
            for record in records
            if record.record_type == TERMINAL_RECORD_TYPE
            and record.turn_id
            and record.quarantined_at is None
            and (record.attributes or {}).get(RECORD_SETTLED_BY_ATTRIBUTE)
            != SETTLED_BY_WATCHDOG
            and (record.attributes or {}).get("stopReason") != "paused"
        }
        for project_id, session_id, execution_id in candidates:
            try:
                execution = await self.executions_dao.fetch_execution(
                    project_id=project_id,
                    session_id=session_id,
                    execution_id=execution_id,
                )
                if (
                    execution is None
                    or (
                        execution.source_interaction_id is None
                        and execution.parent_execution_id is None
                    )
                    or execution.terminal_outcome is not None
                ):
                    continue
                await self.executions_dao.settle(
                    project_id=project_id,
                    session_id=session_id,
                    execution_id=execution_id,
                    terminal_outcome="completed",
                    settled_by="runner",
                )
            except Exception:
                log.warning(
                    "[RECORDS] Continuation completion settlement failed",
                    project_id=str(project_id),
                    session_id=session_id,
                    turn_id=execution_id,
                    exc_info=True,
                )

    async def _handle_late_events(
        self,
        *,
        events: List[SessionRecordEvent],
    ) -> List[SessionRecordEvent]:
        """Stamp `quarantined_at` on every event belonging to a settled turn.

        Scoped as narrowly as the invariant allows, in three ways.

        * Only turns the WATCHDOG ended. A turn that reached its own honest ending — an
          ordinary Stop, a normal completion — is untouched, so the runner's single ending
          always lands and a `usage` that trails its own `done` through the stream is still
          ordinary history.
        * Only records the watchdog did not write. Its own `error` is not a terminal record,
          so a redelivery of it after its `done` had landed would otherwise quarantine the
          very ending it belongs to.
        * Terminal records included. A late `done` is quarantined like the rest of the tail,
          which is what keeps ONE effective ending: folding it into the watchdog's would
          rewrite the record the user has already read, and hide that two writers disagreed.

        A batch that carries the watchdog's own `done` settles that turn for the rest of the
        same batch. Ingest batches up to fifty messages, and the thawed runner's tail can
        share one with the ending that beat it by a second.

        A failed lookup quarantines nothing and appends everything. Losing a record is worse
        than showing one that should have been hidden, and the next delivery gets another go.
        """
        if self.executions_dao is not None and env.agenta.sessions.durable_stop:
            return await self._handle_by_execution_state(events=events)

        candidates: Dict[UUID, Set[Tuple[str, str]]] = {}
        for event in events:
            if not event.turn_id or _written_by_watchdog(event):
                continue
            candidates.setdefault(event.project_id, set()).add(
                (event.session_id, event.turn_id)
            )

        if not candidates:
            return events

        settled: Dict[UUID, Set[Tuple[str, str]]] = {}
        for project_id, keys in candidates.items():
            try:
                settled[project_id] = await self.records_dao.settled_turns(
                    project_id=project_id,
                    keys=sorted(keys),
                    settled_by=SETTLED_BY_WATCHDOG,
                )
            except Exception:
                log.warning(
                    "[RECORDS] Late-record lookup failed; appending the batch unguarded",
                    project_id=str(project_id),
                    exc_info=True,
                )
                settled[project_id] = set()

        for event in events:
            if (
                _written_by_watchdog(event)
                and event.record_type == TERMINAL_RECORD_TYPE
                and event.turn_id
            ):
                settled.setdefault(event.project_id, set()).add(
                    (event.session_id, event.turn_id)
                )

        now = datetime.now(timezone.utc)
        guarded: List[SessionRecordEvent] = []
        for event in events:
            is_late = (
                event.turn_id is not None
                and not _written_by_watchdog(event)
                and (event.session_id, event.turn_id)
                in settled.get(event.project_id, set())
            )
            if not is_late:
                guarded.append(event)
                continue

            action = env.agenta.sessions.late_output
            log.warning(
                "[RECORDS] %s a record for a turn the watchdog had already ended",
                "Rejected" if action == "reject" else "Quarantined",
                project_id=str(event.project_id),
                session_id=event.session_id,
                turn_id=event.turn_id,
                record_type=event.record_type,
                record_id=str(event.record_id) if event.record_id else None,
            )
            if action == "reject":
                continue
            guarded.append(event.model_copy(update={"quarantined_at": now}))

        return guarded

    async def _handle_by_execution_state(
        self,
        *,
        events: List[SessionRecordEvent],
    ) -> List[SessionRecordEvent]:
        candidates: Dict[UUID, Set[Tuple[str, str]]] = {}
        for event in events:
            if event.turn_id:
                candidates.setdefault(event.project_id, set()).add(
                    (event.session_id, event.turn_id)
                )

        if not candidates:
            return events

        settled: Dict[UUID, Dict[Tuple[str, str], SessionExecutionSettlement]] = {}
        for project_id, keys in candidates.items():
            try:
                settled[project_id] = await self.executions_dao.query_settled(
                    project_id=project_id,
                    keys=sorted(keys),
                )
            except Exception:
                log.warning(
                    "[RECORDS] Terminal execution lookup failed; appending the batch unguarded",
                    project_id=str(project_id),
                    exc_info=True,
                )
                settled[project_id] = {}

        now = datetime.now(timezone.utc)
        guarded: List[SessionRecordEvent] = []
        for event in events:
            if not event.turn_id:
                guarded.append(event)
                continue
            terminal = settled.get(event.project_id, {}).get(
                (event.session_id, event.turn_id)
            )
            if terminal is None:
                guarded.append(event)
                continue

            writer = "watchdog" if _written_by_watchdog(event) else "runner"
            is_late = terminal.settled_by != writer and terminal.terminal_outcome in (
                "lost",
                "stopped",
            )
            if not is_late:
                guarded.append(event)
                continue

            action = env.agenta.sessions.late_output
            log.warning(
                "[RECORDS] %s a record for an execution that is already terminal",
                "Rejected" if action == "reject" else "Quarantined",
                project_id=str(event.project_id),
                session_id=event.session_id,
                turn_id=event.turn_id,
                record_type=event.record_type,
                record_id=str(event.record_id) if event.record_id else None,
            )
            if action == "quarantine":
                guarded.append(event.model_copy(update={"quarantined_at": now}))

        return guarded

    async def get_records(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> List[SessionRecord]:
        return await self.records_dao.get_records(
            project_id=project_id,
            session_id=session_id,
        )

    async def get_event(
        self,
        *,
        project_id: UUID,
        record_id: UUID,
    ) -> Optional[SessionRecord]:
        return await self.records_dao.get_event(
            project_id=project_id,
            record_id=record_id,
        )

    async def get_records_page(
        self,
        *,
        project_id: UUID,
        session_id: str,
        offset: int,
        limit: int,
        through_sequence: int,
    ) -> SessionRecordsPage:
        return await self.records_dao.get_records_page(
            project_id=project_id,
            session_id=session_id,
            offset=offset,
            limit=limit,
            through_sequence=through_sequence,
        )

    async def get_read_state(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> SessionRecordsReadState:
        return await self.records_dao.get_read_state(
            project_id=project_id,
            session_id=session_id,
        )

    async def get_events_after(
        self,
        *,
        project_id: UUID,
        session_id: str,
        after: int,
    ):
        replay = await self.records_dao.get_records_after(
            project_id=project_id,
            session_id=session_id,
            after=after,
        )
        return SessionDurableEventsReplay(
            events=durable_events_from_records(
                replay.records,
                include_legacy=after == 0,
                watermark=replay.watermark,
            ),
            watermark=replay.watermark,
        )

    async def latest_message_per_session(
        self,
        *,
        project_id: UUID,
        session_ids: List[str],
    ) -> Dict[str, SessionMessagePreview]:
        """One batched lookup for a whole page — never one call per row."""
        if not session_ids:
            return {}

        return await self.records_dao.latest_message_per_session(
            project_id=project_id,
            session_ids=session_ids,
        )

    async def settled_turns(
        self,
        *,
        project_id: UUID,
        keys: Sequence[Tuple[str, str]],
        settled_by: Optional[str] = None,
    ) -> Set[Tuple[str, str]]:
        """One batched lookup for a whole watchdog pass — never one call per candidate."""
        if not keys:
            return set()

        return await self.records_dao.settled_turns(
            project_id=project_id,
            keys=keys,
            settled_by=settled_by,
        )

    async def runner_completed_turns(
        self,
        *,
        project_id: UUID,
        keys: Sequence[Tuple[str, str]],
    ) -> Set[Tuple[str, str]]:
        return await self.records_dao.runner_completed_turns(
            project_id=project_id,
            keys=keys,
        )
