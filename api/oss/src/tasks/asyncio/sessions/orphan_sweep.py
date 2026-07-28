"""Orphan sweep — SCA-6.

Periodically scans session_streams for rows whose mirror says is_alive but whose
heartbeat (updated_at) is stale — the owning runner died mid-turn and its Redis
alive lock has expired. Marks each orphan ended + collapses its flags so the
sandbox can be reaped.

Called from the FastAPI lifespan; runs as a background asyncio task.
"""

import asyncio
from datetime import datetime, timezone, timedelta

from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.shared.engine import TransactionsEngine
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.core.sessions.streams.dtos import (
    SessionStreamFlags,
)
from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.dbs.redis.sessions.locks import (
    force_cancel_alive,
    clear_running,
    force_clear_owner,
)

from sqlalchemy import and_, func, not_, or_, select

log = get_module_logger(__name__)

# A RUNNING stream whose heartbeat (updated_at) is older than this is orphaned: a live turn
# beats every 30s, so this much silence means the owning runner died.
ORPHAN_THRESHOLD_SECONDS: int = 300  # 5 minutes

# Alive-but-idle rows (between turns, or parked awaiting approval) get a longer grace: the
# runner stops beating while a turn is parked, and it keeps that sandbox warm for the
# approval TTL (30 min). Sweeping those at 5 min would declare a resumable session dead.
IDLE_THRESHOLD_SECONDS: int = 1800  # 30 minutes

# How often the sweep runs.
SWEEP_INTERVAL_SECONDS: int = 60

# Rows swept per pass. A backlog drains over successive passes instead of one huge commit.
SWEEP_BATCH_SIZE: int = 500


async def run_orphan_sweep(engine: TransactionsEngine, lock_engine: LockEngine) -> None:
    """Single sweep pass: mark stale is_alive rows as ended."""
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

        now = datetime.now(timezone.utc)
        for row in orphans:
            row.flags = SessionStreamFlags(
                is_alive=False, is_running=False, is_attached=False
            ).model_dump(mode="json")
            row.updated_at = now
            log.warning(
                "orphan_sweep: marking session_stream ended",
                extra={"session_id": row.session_id, "stream_id": str(row.id)},
            )

        await session.commit()

        # Bring the Redis locks the SEND gate reads in sync with the rows just written.
        for row in orphans:
            project_id = str(row.project_id)
            await force_cancel_alive(
                lock_engine, project_id=project_id, session_id=row.session_id
            )
            await clear_running(
                lock_engine, project_id=project_id, session_id=row.session_id
            )
            # A swept session is dead; free its affinity like kill does.
            await force_clear_owner(
                lock_engine, project_id=project_id, session_id=row.session_id
            )

        log.info("orphan_sweep: marked %d orphans ended", len(orphans))


async def orphan_sweep_loop(
    engine: TransactionsEngine, lock_engine: LockEngine
) -> None:
    """Infinite loop; runs as a background asyncio task during app lifespan."""
    while True:
        try:
            await run_orphan_sweep(engine, lock_engine)
        except Exception:
            log.exception("orphan_sweep: error during sweep pass")
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
