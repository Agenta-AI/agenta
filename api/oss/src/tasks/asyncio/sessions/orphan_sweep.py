"""Execution watchdog (formerly the orphan sweep) — SCA-6.

Every accepted execution must reach exactly one durable terminal outcome. The runner writes
that outcome on every path it controls, but it cannot write one when it is gone: its container
restarts, its process dies, or its `run()` never returns. The session then keeps the Redis
`alive`/`running` nest of a turn nobody is running, the transcript stops mid-turn, and the
session refuses a new message until a threshold far away expires.

This pass closes that hole. It scans `session_streams` for rows whose mirror still says
`is_alive` but whose heartbeat (`updated_at`) is stale, and for each one it:

1. compare-and-sets the stale stream generation so a renewed turn cannot be settled;
2. settles the execution and writes the terminal records the dead runner owed;
3. clears the Redis nest and tombstones the turn, so a late beat cannot re-nest it;
4. publishes the watch notification, so an open browser refreshes without a reload.

Steps 1 and 2 share one Postgres transaction. Terminal records publish before its commit with
stable ids, so a crash rolls the stream and execution changes back and the next pass safely
re-publishes the same records.

Two thresholds, not one. A RUNNING row beats every 30 seconds, so a short silence means the
runner died. An ALIVE-but-idle row is a different animal: between turns, and while a turn is
parked awaiting a human, the runner sends a final beat with `is_running: false` and then stops
beating on purpose. That state is resumable, so it is never given a terminal record here.
Both thresholds are settings; see `SessionWatchdogConfig` in `oss/src/utils/env.py`.

WHAT THIS PASS CANNOT SEE, and why the runner needs its own detector. This scan keys off
heartbeat age, and a turn whose SANDBOX died keeps beating perfectly well: the runner is
healthy, only the machine under it is gone. Such a row never becomes stale and is invisible
here for ever. That case is issue #6418 and it is closed on the runner side, by the sandbox
liveness probe in `services/runner/src/engines/sandbox_agent/sandbox-liveness.ts`. This pass
covers the complementary case, where the RUNNER is what disappeared and nothing on that side
can write anything at all.

Called from the FastAPI lifespan; runs as a background asyncio task.
"""

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple
from uuid import UUID, uuid5, NAMESPACE_URL

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.sessions.executions.dbes import SessionExecutionDBE
from oss.src.dbs.postgres.shared.engine import TransactionsEngine
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.core.sessions.records.dtos import (
    RECORD_SETTLED_BY_ATTRIBUTE,
    SETTLED_BY_WATCHDOG,
    TERMINAL_RECORD_TYPE,
    SessionRecordEvent,
)
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.records.streaming import publish_record
from oss.src.core.sessions.streams.dtos import (
    SessionStreamFlags,
)
from oss.src.core.sessions.watch.interfaces import SessionsWatchPublisherInterface
from oss.src.dbs.redis.sessions.contract import WATCH_LIFECYCLE_ENDED
from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.dbs.redis.sessions.locks import (
    clear_running,
    force_cancel_alive,
    force_clear_owner,
    get_owner_value,
    mark_turn_superseded,
    release_watchdog_turn,
)

from sqlalchemy import and_, func, not_, or_, select, tuple_, update as sa_update

log = get_module_logger(__name__)

# A RUNNING stream whose heartbeat is older than this is lost.
#
# The rule is HEARTBEAT AGE, deliberately, and not the Redis lease. The `alive` and `running`
# keys carry a one-hour TTL (`env.sessions.alive_ttl_seconds`), so waiting for a lease to
# expire would mean waiting an hour. The runner beats every 30 seconds and the beat is
# mirrored onto `session_streams.updated_at`, so the age of that column is what actually says
# whether anyone is still running the turn. 90 seconds is three missed beats.
#
# Raise AGENTA_SESSIONS_WATCHDOG_STALE_HEARTBEAT_SECONDS if healthy turns are being settled.
ORPHAN_THRESHOLD_SECONDS: int = env.agenta.sessions.watchdog.stale_heartbeat_seconds

# Alive-but-NOT-running rows are RECLAIMED on a different, much longer clock. Between turns, and
# while a turn is parked awaiting a human, the runner sends one final beat with `is_running:
# false` and then stops beating on purpose; that state is resumable, so collapsing it is keyed
# to the 30-minute approval TTL rather than to three missed beats.
#
# It does NOT decide whether such a row owes its turn an ending. It used to, on the premise that
# a not-running row's last turn had already reached a terminal record — a premise a durable Stop
# broke, because settlement clears `is_running` before the runner has written that record. The
# ending is now decided by asking the records plane, on the ninety-second clock. See the second
# selection in `run_orphan_sweep`.
IDLE_THRESHOLD_SECONDS: int = env.agenta.sessions.watchdog.idle_grace_seconds

# How often the watchdog runs.
SWEEP_INTERVAL_SECONDS: int = env.agenta.sessions.watchdog.interval_seconds

# Rows swept per pass. A backlog drains over successive passes instead of one huge commit.
SWEEP_BATCH_SIZE: int = env.agenta.sessions.watchdog.batch_size

# The error class the watchdog stamps on the turn it settles. One of the `RunErrorCode`
# values in services/runner/src/engines/sandbox_agent/errors.ts; the client reads it to offer
# a retry rather than parsing the message.
LOST_ERROR_CODE = "execution_lost"

# The line the user reads in place of the answer the dead runner never gave. Identical to
# `EXECUTION_LOST_MESSAGE` in services/runner/src/engines/sandbox_agent/errors.ts, which the
# runner writes for the same class when a turn will not unwind: one outcome must not reach
# the user in two different wordings depending on which side noticed it.
LOST_ERROR_MESSAGE = "The agent stopped responding and the run was closed. Send the message again to retry."

# Records are attributed to the agent, matching every record the runner writes for a turn.
RECORD_SOURCE_AGENT = "agent"

# Both records carry this marker, and it is the ONLY thing that distinguishes the watchdog's
# ending from a runner's. That matters twice at ingest: a record arriving for a turn this
# marker has already closed is quarantined rather than appended, and the watchdog's own two
# records are exempt from that rule so a redelivery cannot quarantine the ending itself. See
# `RecordsService.append_many`.
SETTLED_BY = {RECORD_SETTLED_BY_ATTRIBUTE: SETTLED_BY_WATCHDOG}


def _watchdog_record_id(
    *,
    project_id: str,
    session_id: str,
    turn_id: str,
    suffix: str,
) -> UUID:
    """A stable id per (turn, record), so re-running the watchdog upserts instead of appending.

    The ingest path is `INSERT ... ON CONFLICT (project_id, record_id) DO UPDATE`, so two
    passes — or two API replicas sweeping at once — write the same two rows, never four.
    """
    return uuid5(
        NAMESPACE_URL,
        f"agenta:sessions:watchdog:{project_id}:{session_id}:{turn_id}:{suffix}",
    )


def _lost_turn_records(
    *,
    project_id: UUID,
    session_id: str,
    turn_id: str,
    now: datetime,
) -> List[SessionRecordEvent]:
    """The two records a runner writes when a turn ends badly, written on its behalf.

    Shape and order mirror `run-turn.ts`'s error path exactly: an `error` event carrying the
    class a client can act on, then the terminal `done`. A lone `done` would render as a
    clean finish, which is the opposite of what happened.

    The two are ordered explicitly. The transcript sorts on (`timestamp`, `created_at`,
    `record_index`), and one write batch shares a single `created_at`, so two records stamped
    at the same instant with no index would come back in whatever order Postgres chose. A
    `done` read before its `error` closes the turn early, and the failure then renders as a
    stray bubble beside a turn that claims it got no response.
    """
    project = str(project_id)

    return [
        SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_id=_watchdog_record_id(
                project_id=project,
                session_id=session_id,
                turn_id=turn_id,
                suffix="error",
            ),
            timestamp=now,
            record_index=0,
            record_type="error",
            record_source=RECORD_SOURCE_AGENT,
            attributes={
                "type": "error",
                "message": LOST_ERROR_MESSAGE,
                "code": LOST_ERROR_CODE,
                **SETTLED_BY,
            },
            turn_id=turn_id,
        ),
        SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_id=_watchdog_record_id(
                project_id=project,
                session_id=session_id,
                turn_id=turn_id,
                suffix="done",
            ),
            timestamp=now + timedelta(milliseconds=1),
            record_index=1,
            record_type="done",
            record_source=RECORD_SOURCE_AGENT,
            attributes={"type": "done", **SETTLED_BY},
            turn_id=turn_id,
        ),
    ]


def _stopped_turn_records(
    *,
    project_id: UUID,
    session_id: str,
    turn_id: str,
    now: datetime,
) -> List[SessionRecordEvent]:
    return [
        SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_id=_watchdog_record_id(
                project_id=str(project_id),
                session_id=session_id,
                turn_id=turn_id,
                suffix="done",
            ),
            timestamp=now,
            record_index=0,
            record_type=TERMINAL_RECORD_TYPE,
            record_source=RECORD_SOURCE_AGENT,
            attributes={"type": "done", "stopReason": "cancelled", **SETTLED_BY},
            turn_id=turn_id,
        )
    ]


async def _unsettled_turns(
    *,
    records_service: Optional[RecordsService],
    candidates: Sequence[Tuple[UUID, str, str]],
) -> Tuple[
    Set[Tuple[UUID, str, str]],
    Set[Tuple[UUID, str, str]],
    Set[Tuple[UUID, str, str]],
]:
    """Partition candidates into turns without and with a terminal record.

    A runner can die AFTER writing its outcome but BEFORE its final `is_running=false`
    heartbeat lands — the last beat is best-effort and untimed. Such a turn is already
    settled; the row still needs collapsing, but writing a second, contradictory ending
    would corrupt the transcript. One query per project, never one per candidate.
    """
    if not candidates:
        return set(), set(), set()

    if records_service is None:
        # No records plane wired (minimal test compositions): settle the row, write nothing.
        return set(), set(), set()

    by_project: Dict[UUID, List[Tuple[str, str]]] = {}
    for project_id, session_id, turn_id in candidates:
        by_project.setdefault(project_id, []).append((session_id, turn_id))

    unsettled: Set[Tuple[UUID, str, str]] = set()
    ended: Set[Tuple[UUID, str, str]] = set()
    deferred: Set[Tuple[UUID, str, str]] = set()
    for project_id, keys in by_project.items():
        try:
            settled = await records_service.settled_turns(
                project_id=project_id, keys=keys
            )
        except Exception:
            log.warning(
                "watchdog: terminal-record lookup failed; deferring project candidates",
                project_id=str(project_id),
                exc_info=True,
            )
            deferred.update(
                (project_id, session_id, turn_id) for session_id, turn_id in keys
            )
            continue

        for session_id, turn_id in keys:
            key = (project_id, session_id, turn_id)
            if (session_id, turn_id) in settled:
                ended.add(key)
            else:
                unsettled.add(key)

    return unsettled, ended, deferred


async def _mark_endings_written(
    *,
    session: Any,
    keys: Set[Tuple[UUID, str, str]],
    written_at: datetime,
) -> None:
    if not keys:
        return
    await session.execute(
        sa_update(SessionExecutionDBE)
        .where(
            tuple_(
                SessionExecutionDBE.project_id,
                SessionExecutionDBE.session_id,
                SessionExecutionDBE.execution_id,
            ).in_(keys),
            SessionExecutionDBE.ending_written_at.is_(None),
        )
        .values(ending_written_at=written_at)
    )


async def _reconcile_completed_executions(
    *,
    commands_service: Optional[Any],
    candidates: Sequence[Tuple[UUID, str, str]],
) -> Set[Tuple[UUID, str, str]]:
    """Return persisted endings whose execution could not be terminalized yet."""
    if commands_service is None:
        return set(candidates)
    failed: Set[Tuple[UUID, str, str]] = set()
    for project_id, session_id, turn_id in candidates:
        try:
            reconciled = await commands_service.settle_execution_completed(
                project_id=project_id,
                session_id=session_id,
                execution_id=turn_id,
            )
        except Exception:
            reconciled = False
            log.warning(
                "watchdog: failed to settle a completed continuation execution",
                project_id=str(project_id),
                session_id=session_id,
                turn_id=turn_id,
                exc_info=True,
            )
        if not reconciled:
            failed.add((project_id, session_id, turn_id))
    return failed


async def _runner_completed_executions(
    *,
    records_service: RecordsService,
    candidates: Sequence[Tuple[UUID, str, str]],
) -> Tuple[Set[Tuple[UUID, str, str]], Set[Tuple[UUID, str, str]]]:
    by_project: Dict[UUID, List[Tuple[str, str]]] = {}
    for project_id, session_id, turn_id in candidates:
        by_project.setdefault(project_id, []).append((session_id, turn_id))
    completed: Set[Tuple[UUID, str, str]] = set()
    failed: Set[Tuple[UUID, str, str]] = set()
    for project_id, keys in by_project.items():
        try:
            matches = await records_service.runner_completed_turns(
                project_id=project_id,
                keys=keys,
            )
        except Exception:
            log.warning(
                "watchdog: runner-completion lookup failed",
                project_id=str(project_id),
                exc_info=True,
            )
            failed.update(
                (project_id, session_id, turn_id) for session_id, turn_id in keys
            )
            continue
        completed.update(
            (project_id, session_id, turn_id) for session_id, turn_id in matches
        )
    return completed, failed


async def _settle_abandoned_commands(
    commands_service: Optional[Any],
    now: datetime,
) -> int:
    """Settle every Stop command whose runner accepted it and never reported.

    Delegates the decision to the commands plane, which owns the command state machine, so
    this sweep and a runner report can never write two different terminal outcomes for the
    same command. Never raises: an abandoned command must not stop the pass that settles
    executions.
    """
    if commands_service is None:
        return 0
    try:
        return await commands_service.settle_abandoned_commands(now=now)
    except Exception:
        log.warning("watchdog: failed to settle abandoned commands", exc_info=True)
        return 0


async def _repair_terminal_redis(commands_service: Optional[Any]) -> int:
    if commands_service is None:
        return 0
    try:
        return await commands_service.repair_terminal_redis()
    except Exception:
        log.warning("watchdog: failed to repair terminal Redis state", exc_info=True)
        return 0


async def run_orphan_sweep(
    engine: TransactionsEngine,
    lock_engine: LockEngine,
    *,
    records_service: Optional[RecordsService] = None,
    watch_publisher: Optional[SessionsWatchPublisherInterface] = None,
    commands_service: Optional[Any] = None,
    publish: Any = publish_record,
) -> None:
    """Single watchdog pass: settle every stale is_alive row, then every abandoned command.

    `commands_service` is a `SessionCommandsService`. It is optional and typed loosely so this
    module keeps no import edge on the commands plane, which would be a cycle. When it is
    given, this pass is also the one writer that settles a Stop the runner never reported.
    """
    now_utc = datetime.now(timezone.utc)
    threshold = now_utc - timedelta(seconds=ORPHAN_THRESHOLD_SECONDS)
    idle_threshold = now_utc - timedelta(seconds=IDLE_THRESHOLD_SECONDS)
    # coalesce, not a bare `updated_at`: a row never updated since creation has updated_at
    # NULL, and `NULL < threshold` is NULL — such a row could never be swept, however long
    # it had claimed to be alive.
    last_beat = func.coalesce(SessionStreamDBE.updated_at, SessionStreamDBE.created_at)
    is_running = SessionStreamDBE.flags.contains({"is_running": True})

    async with engine.session() as session:
        stmt = (
            select(SessionStreamDBE)
            .where(
                SessionStreamDBE.deleted_at.is_(None),
                SessionStreamDBE.flags.contains({"is_alive": True}),
                or_(
                    and_(is_running, last_beat < threshold),
                    and_(not_(is_running), last_beat < idle_threshold),
                ),
            )
            .limit(SWEEP_BATCH_SIZE)
        )
        result = await session.execute(stmt)
        orphans = result.scalars().all()

        # Capture what the collapse and its Redis/watch follow-up need as plain values NOW,
        # before any nested `engine.session()` in this pass runs. The records lookup and the
        # command settlement below each open `engine.session()`, which returns the SAME
        # current-task-scoped session and, in its `finally`, calls `session.close()` (see
        # `TransactionsEngine.session`). That close detaches every ORM row loaded here, so a
        # later `row.flags = ...` mutation is tracked by no session and is silently dropped at
        # commit -- the flags UPDATE is never emitted, while a Core UPDATE (the command
        # settle's `stopping_turn_id`) still lands. That is the finding-7 bug: the row kept
        # `is_running: true` after the sweep. The collapse below writes through a Core UPDATE
        # keyed by these ids, and the Redis/watch steps read these tuples, never the rows.
        orphan_rows: List[Tuple[UUID, UUID, str, Optional[str], Optional[datetime]]] = [
            (
                row.id,
                row.project_id,
                row.session_id,
                str(row.turn_id) if row.turn_id else None,
                row.updated_at,
            )
            for row in orphans
        ]

        # Current stopped turns get their missing ending on the short clock without collapsing
        # a parked session, whose reclamation stays on the longer idle grace.
        ending_stmt = (
            select(SessionStreamDBE)
            .where(
                SessionStreamDBE.deleted_at.is_(None),
                SessionStreamDBE.flags.contains({"is_alive": True}),
                not_(is_running),
                SessionStreamDBE.turn_id.is_not(None),
                last_beat < threshold,
            )
            .limit(SWEEP_BATCH_SIZE)
        )
        ending_only = (await session.execute(ending_stmt)).scalars().all()

        # A stream row names only its current turn. Older terminal executions must remain
        # visible after that row advances, or their missing transcript ending is permanent.
        terminal_executions = []
        if records_service is not None:
            terminal_stmt = (
                select(SessionExecutionDBE)
                .where(
                    SessionExecutionDBE.terminal_outcome.in_(("stopped", "lost")),
                    SessionExecutionDBE.ending_written_at.is_(None),
                    SessionExecutionDBE.settled_at < threshold,
                )
                .order_by(SessionExecutionDBE.settled_at.desc())
                .limit(SWEEP_BATCH_SIZE)
            )
            terminal_executions = (await session.execute(terminal_stmt)).scalars().all()

        # A row that claimed a RUNNING turn owes that turn an ending. So does a stopped row
        # whose runner never wrote one; see the note above.
        seen: Set[Tuple[UUID, str, str]] = set()
        claimed: List[Tuple[UUID, str, str]] = []
        for row in [*orphans, *ending_only]:
            if not row.turn_id:
                continue
            key = (row.project_id, row.session_id, str(row.turn_id))
            if key in seen:
                continue
            seen.add(key)
            claimed.append(key)
        terminal_turns: Set[Tuple[UUID, str, str]] = set()
        terminal_outcomes: Dict[Tuple[UUID, str, str], str] = {}
        for execution in terminal_executions:
            key = (
                execution.project_id,
                execution.session_id,
                execution.execution_id,
            )
            terminal_turns.add(key)
            terminal_outcomes[key] = execution.terminal_outcome
            if key in seen:
                continue
            seen.add(key)
            claimed.append(key)
        unsettled, ended, deferred = await _unsettled_turns(
            records_service=records_service, candidates=claimed
        )
        if deferred:
            orphan_rows = [
                row
                for row in orphan_rows
                if row[3] is None or (row[1], row[2], row[3]) not in deferred
            ]
        await _mark_endings_written(
            session=session,
            keys=ended & terminal_turns,
            written_at=now_utc,
        )

        # A runner can persist `done` and die before the post-append execution settlement.
        # Reconcile that durable proof before clearing its stale heartbeat; otherwise the next
        # Send would see a recoverable continuation and replay already-completed work.
        completion_failures: Set[Tuple[UUID, str, str]] = set()
        if (
            records_service is not None
            and commands_service is not None
            and env.agenta.sessions.durable_stop
        ):
            runner_completed, completion_failures = await _runner_completed_executions(
                records_service=records_service,
                candidates=claimed,
            )
            completion_failures.update(
                await _reconcile_completed_executions(
                    commands_service=commands_service,
                    candidates=sorted(runner_completed, key=lambda t: t[1]),
                )
            )
            if completion_failures:
                orphan_rows = [
                    row
                    for row in orphan_rows
                    if (row[1], row[2], str(row[3]))
                    not in completion_failures
                ]

        if not orphan_rows and not unsettled:
            # No stale row and nothing owed an ending, but a command can still be abandoned:
            # its execution may have ended normally between the claim and the report.
            if not deferred:
                await _settle_abandoned_commands(commands_service, now_utc)
                await _repair_terminal_redis(commands_service)
            return

        now = datetime.now(timezone.utc)

        # Capture the affinity generation before the guarded database update. Redis cleanup
        # compares this replica and the swept turn atomically after commit, so a new Send or
        # Steer generation cannot be deleted.
        observed_owners: Dict[Tuple[UUID, str, str], Optional[str]] = {}
        owner_keys = {
            (project_id, session_id, turn_id)
            for project_id, session_id, turn_id in unsettled
        }
        owner_keys.update(
            (project_id, session_id, turn_id)
            for _row_id, project_id, session_id, turn_id, _updated_at in orphan_rows
            if turn_id is not None
        )
        for project_id, session_id, turn_id in sorted(
            owner_keys, key=lambda key: key[1]
        ):
            observed_owners[(project_id, session_id, turn_id)] = await get_owner_value(
                lock_engine,
                project_id=str(project_id),
                session_id=session_id,
            )

        # Win the stale stream generation before settling its execution or publishing records.
        # The update and execution settlement share this transaction; an exception rolls both
        # back, while record ids make a publish-before-commit retry idempotent.
        collapsed_flags = SessionStreamFlags(
            is_alive=False, is_running=False, is_attached=False
        ).model_dump(mode="json")
        collapsed_rows: List[
            Tuple[UUID, UUID, str, Optional[str], Optional[datetime]]
        ] = []
        skipped_orphan_turns: Set[Tuple[UUID, str, str]] = set()
        for (
            row_id,
            project_uuid,
            session_id,
            turn_id,
            observed_updated_at,
        ) in orphan_rows:
            conditions = [
                SessionStreamDBE.id == row_id,
                SessionStreamDBE.project_id == project_uuid,
                SessionStreamDBE.session_id == session_id,
                SessionStreamDBE.deleted_at.is_(None),
                (
                    SessionStreamDBE.turn_id == turn_id
                    if turn_id is not None
                    else SessionStreamDBE.turn_id.is_(None)
                ),
                (
                    SessionStreamDBE.updated_at == observed_updated_at
                    if observed_updated_at is not None
                    else SessionStreamDBE.updated_at.is_(None)
                ),
            ]
            result = await session.execute(
                sa_update(SessionStreamDBE)
                .where(*conditions)
                .values(flags=collapsed_flags, updated_at=now)
                .execution_options(synchronize_session=False)
            )
            if result.rowcount != 1:
                if turn_id is not None:
                    skipped_orphan_turns.add((project_uuid, session_id, turn_id))
                log.info(
                    "watchdog: orphan stream advanced during sweep; leaving it untouched",
                    session_id=session_id,
                    turn_id=turn_id,
                )
                continue
            collapsed_rows.append(
                (row_id, project_uuid, session_id, turn_id, observed_updated_at)
            )
            log.warning(
                "watchdog: settled a session_stream whose runner went silent",
                extra={
                    "session_id": session_id,
                    "stream_id": str(row_id),
                    "turn_id": turn_id,
                    "lost": (project_uuid, session_id, turn_id) in unsettled,
                },
            )

        terminal_winners: Set[Tuple[UUID, str, str]] = set()
        endings_written: Set[Tuple[UUID, str, str]] = set()
        for project_id, session_id, turn_id in sorted(unsettled, key=lambda t: t[1]):
            key = (project_id, session_id, turn_id)
            if key in skipped_orphan_turns:
                continue
            if (
                key not in terminal_turns
                and env.agenta.sessions.durable_stop
                and commands_service is not None
                and not await commands_service.settle_execution_lost(
                    project_id=project_id,
                    session_id=session_id,
                    execution_id=turn_id,
                    settled_at=now,
                    transaction=session,
                )
            ):
                continue
            terminal_winners.add(key)
            record_events = (
                _stopped_turn_records(
                    project_id=project_id,
                    session_id=session_id,
                    turn_id=turn_id,
                    now=now,
                )
                if terminal_outcomes.get(key) == "stopped"
                else _lost_turn_records(
                    project_id=project_id,
                    session_id=session_id,
                    turn_id=turn_id,
                    now=now,
                )
            )
            for record_event in record_events:
                published = False
                try:
                    published = await publish(
                        project_id=project_id, record_event=record_event
                    )
                except Exception:
                    log.warning(
                        "watchdog: failed to publish a terminal record",
                        project_id=str(project_id),
                        session_id=session_id,
                        turn_id=turn_id,
                        exc_info=True,
                    )
                if published and record_event.record_type == TERMINAL_RECORD_TYPE:
                    endings_written.add(key)

        await _mark_endings_written(
            session=session,
            keys=endings_written,
            written_at=now,
        )

        unsettled = terminal_winners

        # A lost turn whose stream row the went-silent collapse did NOT touch must still be
        # brought to rest here, in this same pass, or the SEND gate refuses the next message
        # until the runner returns -- which, for a lost turn, may be never. The RFC's rule is
        # that the settlement writes the ending, clears `is_running`, releases `alive`, and
        # updates the mirror together. The collapse above owns the rows the orphan query
        # matched; this owns every other lost turn (a row the query did not return, or an
        # older execution whose row has since advanced). Everything here is guarded on
        # `turn_id`, so a row that now names a NEWER running turn is never disturbed.
        collapsing = {(p, s, t) for (_id, p, s, t, _u) in collapsed_rows}
        newly_lost = sorted(unsettled - collapsing, key=lambda t: t[1])

        # Clear `is_running` on the DB row that STILL names a lost turn, keeping `is_alive` so
        # the session stays resumable. Guarded on turn_id: a row that advanced to a newer turn
        # is left alone. Observed live on the integration stack: the execution was settled lost
        # but the stream row kept `is_running: true`, and the next Send was refused.
        # Captured as plain values, and written by a Core UPDATE further down, for the same
        # reason the collapse is: the Redis calls that follow this block, and anything a future
        # edit puts between the load and the write, can open a nested `engine.session()`, whose
        # `finally` closes the shared task-scoped session and detaches these rows. A mutation on
        # a detached row is tracked by no session and is dropped at commit with no error.
        running_rows_to_clear: List[
            Tuple[UUID, UUID, str, str, Optional[datetime], Dict[str, Any]]
        ] = []
        if newly_lost:
            rows_to_clear = (
                (
                    await session.execute(
                        select(SessionStreamDBE).where(
                            SessionStreamDBE.deleted_at.is_(None),
                            SessionStreamDBE.flags.contains({"is_running": True}),
                            tuple_(
                                SessionStreamDBE.project_id,
                                SessionStreamDBE.session_id,
                                SessionStreamDBE.turn_id,
                            ).in_(list(newly_lost)),
                        )
                    )
                )
                .scalars()
                .all()
            )
            for row in rows_to_clear:
                flags = dict(row.flags or {})
                flags["is_running"] = False
                running_rows_to_clear.append(
                    (
                        row.id,
                        row.project_id,
                        row.session_id,
                        str(row.turn_id),
                        row.updated_at,
                        flags,
                    )
                )

        # Every write to `session_streams` uses a Core UPDATE. No ORM attribute write on this
        # table survives anywhere in this pass: nested scoped sessions can detach loaded rows.
        running_rows_cleared: List[
            Tuple[UUID, UUID, str, str, Optional[datetime], Dict[str, Any]]
        ] = []
        failed_running_clears: Set[Tuple[UUID, str, str]] = set()
        for (
            row_id,
            project_uuid,
            session_id,
            turn_id,
            observed_updated_at,
            cleared_flags,
        ) in running_rows_to_clear:
            conditions = [
                SessionStreamDBE.id == row_id,
                SessionStreamDBE.project_id == project_uuid,
                SessionStreamDBE.session_id == session_id,
                SessionStreamDBE.turn_id == turn_id,
                SessionStreamDBE.deleted_at.is_(None),
                (
                    SessionStreamDBE.updated_at == observed_updated_at
                    if observed_updated_at is not None
                    else SessionStreamDBE.updated_at.is_(None)
                ),
            ]
            result = await session.execute(
                sa_update(SessionStreamDBE)
                .where(*conditions)
                .values(flags=cleared_flags, updated_at=now)
                .execution_options(synchronize_session=False)
            )
            if result.rowcount != 1:
                failed_running_clears.add((project_uuid, session_id, turn_id))
                log.info(
                    "watchdog: lost-turn stream advanced during sweep; leaving it untouched",
                    session_id=session_id,
                    turn_id=turn_id,
                )
                continue
            running_rows_cleared.append(
                (
                    row_id,
                    project_uuid,
                    session_id,
                    turn_id,
                    observed_updated_at,
                    cleared_flags,
                )
            )

        await session.commit()

        # Redis cleanup is one compare-and-delete operation per session. A new Send or Steer may
        # install another generation after this commit; the script leaves its keys and affinity
        # untouched and tombstones only the swept turn.
        for project_uuid, session_id, turn_id in newly_lost:
            if (project_uuid, session_id, turn_id) in failed_running_clears:
                continue
            (
                released_alive,
                _released_running,
                _released_owner,
            ) = await release_watchdog_turn(
                lock_engine,
                project_id=str(project_uuid),
                session_id=session_id,
                turn_id=turn_id,
                owner_value=observed_owners.get((project_uuid, session_id, turn_id)),
            )
            log.warning(
                "watchdog: wrote the ending a stopped turn's runner never reported",
                extra={
                    "session_id": session_id,
                    "turn_id": turn_id,
                    "released_alive": released_alive,
                },
            )

        for (
            _row_id,
            project_uuid,
            session_id,
            row_turn_id,
            _observed_updated_at,
        ) in collapsed_rows:
            if row_turn_id is None:
                project_id = str(project_uuid)
                displaced_alive = await force_cancel_alive(
                    lock_engine, project_id=project_id, session_id=session_id
                )
                displaced_running = await clear_running(
                    lock_engine, project_id=project_id, session_id=session_id
                )
                for displaced_turn_id in {
                    turn_id
                    for turn_id in (displaced_alive, displaced_running)
                    if turn_id
                }:
                    await mark_turn_superseded(
                        lock_engine,
                        project_id=project_id,
                        session_id=session_id,
                        turn_id=displaced_turn_id,
                    )
                await force_clear_owner(
                    lock_engine, project_id=project_id, session_id=session_id
                )
                continue
            await release_watchdog_turn(
                lock_engine,
                project_id=str(project_uuid),
                session_id=session_id,
                turn_id=row_turn_id,
                owner_value=observed_owners.get(
                    (project_uuid, session_id, row_turn_id)
                ),
            )

        # Tell every open reader the session ended. Without this a browser sitting on the
        # settled turn keeps showing it as running until the user reloads. Best effort: the
        # publisher never raises and never re-drives the settle above.
        if watch_publisher is not None:
            for (
                _row_id,
                project_uuid,
                session_id,
                _turn_id,
                _observed_updated_at,
            ) in collapsed_rows:
                try:
                    await watch_publisher.lifecycle(
                        project_id=str(project_uuid),
                        session_id=session_id,
                        state=WATCH_LIFECYCLE_ENDED,
                    )
                    # The session channel reaches a tab that has this session open. A list
                    # row lives on the project channel, so publish there too, or every other
                    # tab keeps the session marked running until its own poll comes round.
                    await watch_publisher.changed(
                        project_id=str(project_uuid),
                        entity="session",
                        id=session_id,
                    )
                except Exception:
                    log.warning(
                        "watchdog: watch publish failed",
                        session_id=session_id,
                        exc_info=True,
                    )

            # A row whose `is_running` was cleared (but not collapsed) also needs the mirror
            # update, or a browser sitting on it keeps the turn drawn as running until a reload.
            for (
                _row_id,
                project_uuid,
                session_id,
                _turn_id,
                _observed_updated_at,
                _flags,
            ) in running_rows_cleared:
                try:
                    await watch_publisher.changed(
                        project_id=str(project_uuid),
                        entity="session",
                        id=session_id,
                    )
                except Exception:
                    log.warning(
                        "watchdog: watch publish failed",
                        session_id=session_id,
                        exc_info=True,
                    )

        # AFTER the rows above are collapsed, on purpose. A command is only abandoned when its
        # session has stopped beating, and the collapse just made that true for every row in
        # this batch. Running it first would leave the runner-gone case waiting a second pass.
        commands_settled = 0
        if not deferred:
            commands_settled = await _settle_abandoned_commands(
                commands_service, datetime.now(timezone.utc)
            )
            await _repair_terminal_redis(commands_service)

        log.info(
            "watchdog: settled %d sessions (%d turns marked lost, %d commands lost)",
            len(collapsed_rows),
            len(unsettled),
            commands_settled,
        )


async def orphan_sweep_loop(
    engine: TransactionsEngine,
    lock_engine: LockEngine,
    *,
    records_service: Optional[RecordsService] = None,
    watch_publisher: Optional[SessionsWatchPublisherInterface] = None,
    commands_service: Optional[Any] = None,
) -> None:
    """Infinite loop; runs as a background asyncio task during app lifespan."""
    # A pass that never returns would end the watchdog for the life of the process with
    # nothing in the log; observed on the integration stack on 2026-09-03, when the sweep
    # went silent after one pass and never ran again. Bound every pass, log the timeout,
    # and go round again.
    pass_timeout = float(max(SWEEP_INTERVAL_SECONDS * 2, 120))
    while True:
        started = datetime.now(timezone.utc)
        try:
            await asyncio.wait_for(
                run_orphan_sweep(
                    engine,
                    lock_engine,
                    records_service=records_service,
                    watch_publisher=watch_publisher,
                    commands_service=commands_service,
                ),
                timeout=pass_timeout,
            )
        except asyncio.CancelledError:
            raise
        except asyncio.TimeoutError:
            log.error(
                "watchdog: sweep pass timed out after %.0fs; skipping to the next pass",
                pass_timeout,
            )
        except Exception:
            # `log` is a MultiLogger, which has no `exception` method; calling one would
            # raise AttributeError from inside this handler and kill the loop for the life
            # of the process. Use `error(..., exc_info=True)`, the same shape the helpers
            # above use, so the first sweep error is logged and the loop goes round again.
            log.error("watchdog: error during sweep pass", exc_info=True)
        elapsed = (datetime.now(timezone.utc) - started).total_seconds()
        if elapsed > SWEEP_INTERVAL_SECONDS:
            log.warning("watchdog: sweep pass took %.1fs", elapsed)
        # Floored: a zero or negative interval would turn the loop into a hot spin.
        await asyncio.sleep(max(SWEEP_INTERVAL_SECONDS, 1))
