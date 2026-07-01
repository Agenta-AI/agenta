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
    SessionStreamStatus,
)

from sqlalchemy import select

log = get_module_logger(__name__)

# A stream whose heartbeat (updated_at) is older than this is considered orphaned.
ORPHAN_THRESHOLD_SECONDS: int = 300  # 5 minutes

# How often the sweep runs.
SWEEP_INTERVAL_SECONDS: int = 60


async def run_orphan_sweep(engine: TransactionsEngine) -> None:
    """Single sweep pass: mark stale is_alive rows as ended."""
    threshold = datetime.now(timezone.utc) - timedelta(seconds=ORPHAN_THRESHOLD_SECONDS)

    async with engine.session() as session:
        stmt = select(SessionStreamDBE).where(
            SessionStreamDBE.deleted_at.is_(None),
            SessionStreamDBE.flags["is_alive"].astext == "true",
            SessionStreamDBE.updated_at < threshold,
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
            row.status = SessionStreamStatus.ended.value
            row.updated_at = now
            log.warning(
                "orphan_sweep: marking session_stream ended",
                extra={"session_id": row.session_id, "stream_id": str(row.id)},
            )

        await session.commit()
        log.info("orphan_sweep: marked %d orphans ended", len(orphans))


async def orphan_sweep_loop(engine: TransactionsEngine) -> None:
    """Infinite loop; runs as a background asyncio task during app lifespan."""
    while True:
        try:
            await run_orphan_sweep(engine)
        except Exception:
            log.exception("orphan_sweep: error during sweep pass")
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
