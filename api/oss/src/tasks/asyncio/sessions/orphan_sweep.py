"""Execution watchdog (formerly the orphan sweep) — SCA-6.

Every accepted execution must reach exactly one durable terminal outcome. The runner writes
that outcome on every path it controls, but it cannot write one when it is gone: its container
restarts, its process dies, or its `run()` never returns. The session then keeps the Redis
`alive`/`running` nest of a turn nobody is running, the transcript stops mid-turn, and the
session refuses a new message until a threshold far away expires.

This pass closes that hole. It scans `session_streams` for rows whose mirror still says
`is_alive` but whose heartbeat (`updated_at`) is stale, and for each one it:

1. writes the terminal records the dead runner owed, marked `execution_lost`;
2. collapses the row's flags so the session reads as ended;
3. clears the Redis nest and tombstones the turn, so a late beat cannot re-nest it;
4. publishes the watch notification, so an open browser refreshes without a reload.

Step 1 is what makes the outcome durable, and it is deliberately first: a crash between the
steps leaves the row a candidate for the next pass, which is recoverable, whereas collapsing
the flags first would hide the row forever with no ending ever written.

Two thresholds, not one. A RUNNING row beats every 30 seconds, so a short silence means the
runner died. An ALIVE-but-idle row is a different animal: between turns, and while a turn is
parked awaiting a human, the runner stops beating entirely but keeps the sandbox warm for the
approval TTL. Settling those on the short threshold would end a session the user was about to
resume. Both thresholds are settings; see `SessionWatchdogConfig` in `oss/src/utils/env.py`.

Called from the FastAPI lifespan; runs as a background asyncio task.
"""

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple
from uuid import UUID, uuid5, NAMESPACE_URL

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.shared.engine import TransactionsEngine
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.records.streaming import publish_record
from oss.src.core.sessions.streams.dtos import (
    SessionStreamFlags,
)
from oss.src.core.sessions.watch.interfaces import SessionsWatchPublisherInterface
from oss.src.dbs.redis.sessions.contract import WATCH_LIFECYCLE_ENDED
from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.dbs.redis.sessions.locks import (
    force_cancel_alive,
    clear_running,
    force_clear_owner,
    mark_turn_superseded,
)

from sqlalchemy import and_, func, not_, or_, select

log = get_module_logger(__name__)

# A RUNNING stream whose heartbeat (updated_at) is older than this is lost: a live turn beats
# every `heartbeat_interval_seconds`, so one interval plus the configured grace of silence
# means the owning runner is gone. 30 + 90 = 120 seconds by default, which is three missed
# beats. Raise AGENTA_SESSIONS_WATCHDOG_GRACE_SECONDS if healthy turns are being settled.
ORPHAN_THRESHOLD_SECONDS: int = (
    env.sessions.heartbeat_interval_seconds
    + env.agenta.sessions.watchdog.running_grace_seconds
)

# Alive-but-idle rows (between turns, or parked awaiting approval) get a longer grace: the
# runner stops beating while a turn is parked, and it keeps that sandbox warm for the
# approval TTL (30 min). Sweeping those at two minutes would declare a resumable session dead.
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
            attributes={"type": "done"},
            turn_id=turn_id,
        ),
    ]


async def _unsettled_turns(
    *,
    records_service: Optional[RecordsService],
    candidates: Sequence[Tuple[UUID, str, str]],
) -> Set[Tuple[UUID, str, str]]:
    """Of these `(project_id, session_id, turn_id)` triples, the ones with no terminal record.

    A runner can die AFTER writing its outcome but BEFORE its final `is_running=false`
    heartbeat lands — the last beat is best-effort and untimed. Such a turn is already
    settled; the row still needs collapsing, but writing a second, contradictory ending
    would corrupt the transcript. One query per project, never one per candidate.
    """
    if not candidates:
        return set()

    if records_service is None:
        # No records plane wired (minimal test compositions): settle the row, write nothing.
        return set()

    by_project: Dict[UUID, List[Tuple[str, str]]] = {}
    for project_id, session_id, turn_id in candidates:
        by_project.setdefault(project_id, []).append((session_id, turn_id))

    unsettled: Set[Tuple[UUID, str, str]] = set()
    for project_id, keys in by_project.items():
        try:
            settled = await records_service.settled_turns(
                project_id=project_id, keys=keys
            )
        except Exception:
            # A failed lookup must not produce a duplicate ending. Skip the write; the row
            # is still collapsed below, and the next pass will not see it again.
            log.warning(
                "watchdog: terminal-record lookup failed; skipping record write",
                project_id=str(project_id),
                exc_info=True,
            )
            continue

        for session_id, turn_id in keys:
            if (session_id, turn_id) not in settled:
                unsettled.add((project_id, session_id, turn_id))

    return unsettled


async def run_orphan_sweep(
    engine: TransactionsEngine,
    lock_engine: LockEngine,
    *,
    records_service: Optional[RecordsService] = None,
    watch_publisher: Optional[SessionsWatchPublisherInterface] = None,
    publish: Any = publish_record,
) -> None:
    """Single watchdog pass: settle every stale is_alive row."""
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

        if not orphans:
            return

        # A row that claimed a RUNNING turn owes that turn an ending. A row that was merely
        # alive between turns owes nothing: its last turn already ended normally.
        claimed: List[Tuple[UUID, str, str]] = [
            (row.project_id, row.session_id, str(row.turn_id))
            for row in orphans
            if row.turn_id and (row.flags or {}).get("is_running") is True
        ]
        unsettled = await _unsettled_turns(
            records_service=records_service, candidates=claimed
        )

        # Durable ending FIRST. A crash after this point leaves the row a candidate for the
        # next pass, which re-reads the record it just wrote and does not write a second.
        now = datetime.now(timezone.utc)
        for project_id, session_id, turn_id in sorted(unsettled, key=lambda t: t[1]):
            for record_event in _lost_turn_records(
                project_id=project_id,
                session_id=session_id,
                turn_id=turn_id,
                now=now,
            ):
                try:
                    await publish(project_id=project_id, record_event=record_event)
                except Exception:
                    log.warning(
                        "watchdog: failed to publish a terminal record",
                        project_id=str(project_id),
                        session_id=session_id,
                        turn_id=turn_id,
                        exc_info=True,
                    )

        for row in orphans:
            row.flags = SessionStreamFlags(
                is_alive=False, is_running=False, is_attached=False
            ).model_dump(mode="json")
            row.updated_at = now
            log.warning(
                "watchdog: settled a session_stream whose runner went silent",
                extra={
                    "session_id": row.session_id,
                    "stream_id": str(row.id),
                    "turn_id": str(row.turn_id) if row.turn_id else None,
                    "lost": (row.project_id, row.session_id, str(row.turn_id))
                    in unsettled,
                },
            )

        await session.commit()

        # Bring the Redis locks the SEND gate reads in sync with the rows just written.
        for row in orphans:
            project_id = str(row.project_id)
            displaced_alive = await force_cancel_alive(
                lock_engine, project_id=project_id, session_id=row.session_id
            )
            displaced_running = await clear_running(
                lock_engine, project_id=project_id, session_id=row.session_id
            )
            # A swept turn is declared dead; tombstone it so a late beat from it cannot
            # re-nest the session it was just evicted from.
            for turn_id in {t for t in (displaced_alive, displaced_running) if t}:
                await mark_turn_superseded(
                    lock_engine,
                    project_id=project_id,
                    session_id=row.session_id,
                    turn_id=turn_id,
                )
            # A swept session is dead; free its affinity like kill does.
            await force_clear_owner(
                lock_engine, project_id=project_id, session_id=row.session_id
            )

        # Tell every open reader the session ended. Without this a browser sitting on the
        # settled turn keeps showing it as running until the user reloads. Best effort: the
        # publisher never raises and never re-drives the settle above.
        if watch_publisher is not None:
            for row in orphans:
                try:
                    await watch_publisher.lifecycle(
                        project_id=str(row.project_id),
                        session_id=row.session_id,
                        state=WATCH_LIFECYCLE_ENDED,
                    )
                    # The session channel reaches a tab that has this session open. A list
                    # row lives on the project channel, so publish there too, or every other
                    # tab keeps the session marked running until its own poll comes round.
                    await watch_publisher.changed(
                        project_id=str(row.project_id),
                        entity="session",
                        id=row.session_id,
                    )
                except Exception:
                    log.warning(
                        "watchdog: watch publish failed",
                        session_id=row.session_id,
                        exc_info=True,
                    )

        log.info(
            "watchdog: settled %d sessions (%d turns marked lost)",
            len(orphans),
            len(unsettled),
        )


async def orphan_sweep_loop(
    engine: TransactionsEngine,
    lock_engine: LockEngine,
    *,
    records_service: Optional[RecordsService] = None,
    watch_publisher: Optional[SessionsWatchPublisherInterface] = None,
) -> None:
    """Infinite loop; runs as a background asyncio task during app lifespan."""
    while True:
        try:
            await run_orphan_sweep(
                engine,
                lock_engine,
                records_service=records_service,
                watch_publisher=watch_publisher,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("watchdog: error during sweep pass")
        # Floored: a zero or negative interval would turn the loop into a hot spin.
        await asyncio.sleep(max(SWEEP_INTERVAL_SECONDS, 1))
