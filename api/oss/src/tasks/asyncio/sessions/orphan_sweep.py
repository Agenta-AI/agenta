"""Orphan sweep — SCA-6.

Periodically scans session_streams for rows whose last_seen_at is stale but
sandbox_live is True (the owning runner died mid-run). Marks each orphan as
ended so the sandbox can be reaped.

Called from the FastAPI lifespan; runs as a background asyncio task.
"""

import asyncio
from datetime import datetime, timezone, timedelta

from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.shared.engine import TransactionsEngine
from oss.src.dbs.postgres.sessions.dbes import SessionStreamDBE
from oss.src.core.sessions.dtos import StreamStatusCode, SessionStreamStatus

from sqlalchemy import select

log = get_module_logger(__name__)

# A stream whose last_seen_at is older than this is considered orphaned.
ORPHAN_THRESHOLD_SECONDS: int = 300  # 5 minutes

# How often the sweep runs.
SWEEP_INTERVAL_SECONDS: int = 60


async def run_orphan_sweep(engine: TransactionsEngine) -> None:
    """Single sweep pass: mark stale sandbox_live rows as ended."""
    threshold = datetime.now(timezone.utc) - timedelta(seconds=ORPHAN_THRESHOLD_SECONDS)

    async with engine.session() as session:
        stmt = select(SessionStreamDBE).where(
            SessionStreamDBE.deleted_at.is_(None),
            SessionStreamDBE.sandbox_live.is_(True),
            SessionStreamDBE.last_seen_at < threshold,
        )
        result = await session.execute(stmt)
        orphans = result.scalars().all()

        if not orphans:
            return

        now = datetime.now(timezone.utc)
        for row in orphans:
            row.sandbox_live = False
            row.status = SessionStreamStatus(
                code=StreamStatusCode.ended,
                message="orphan sweep",
            ).model_dump(mode="json")
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
