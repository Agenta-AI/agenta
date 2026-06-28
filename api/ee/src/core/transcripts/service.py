"""EE transcripts service (retention).

Mirrors ``ee.src.core.events.service.EventsRetentionService`` — same shape,
different counter and DAO. The OSS counterpart
(``oss.src.core.transcripts.service.TranscriptsService``) owns append/query.
"""

from datetime import datetime, timezone, timedelta

from oss.src.utils.logging import get_module_logger

from ee.src.core.access.entitlements.types import Tracker, Counter
from ee.src.core.access.controls import get_plans
from ee.src.dbs.postgres.transcripts.dao import TranscriptsRetentionDAO


log = get_module_logger(__name__)


class TranscriptsRetentionService:
    def __init__(
        self,
        transcripts_retention_dao: TranscriptsRetentionDAO,
    ):
        self.transcripts_dao = transcripts_retention_dao

    async def flush_transcripts(
        self,
        *,
        max_projects_per_batch: int = 500,
        max_transcripts_per_batch: int = 5000,
    ) -> None:
        log.info("[flush-transcripts] ============================================")
        log.info("[flush-transcripts] Starting transcripts flush job")
        log.info("[flush-transcripts] ============================================")

        total_plans = 0
        total_skipped = 0
        total_transcripts = 0

        for plan, entitlements in get_plans().items():
            total_plans += 1

            if not entitlements:
                log.info(f"[flush-transcripts] [{plan}] Skipped (no entitlements)")
                total_skipped += 1
                continue

            transcripts_quota = (entitlements.get(Tracker.COUNTERS) or {}).get(
                Counter.TRANSCRIPTS_INGESTED
            )

            if not transcripts_quota or transcripts_quota.retention is None:
                log.info(f"[flush-transcripts] [{plan}] Skipped (unlimited retention)")
                total_skipped += 1
                continue

            retention_minutes = transcripts_quota.retention
            cutoff = datetime.now(timezone.utc) - timedelta(minutes=retention_minutes)

            log.info(
                f"[flush-transcripts] [{plan}] Processing with cutoff={cutoff.isoformat()} "
                f"(retention={retention_minutes} minutes)"
            )

            try:
                plan_transcripts = await self._flush_transcripts_for_plan(
                    plan=plan,
                    cutoff=cutoff,
                    max_projects_per_batch=max_projects_per_batch,
                    max_transcripts_per_batch=max_transcripts_per_batch,
                )

                total_transcripts += plan_transcripts

                log.info(
                    f"[flush-transcripts] [{plan}] Completed: {plan_transcripts} transcripts"
                )

            except Exception:
                log.error(
                    f"[flush-transcripts] [{plan}] Failed",
                    exc_info=True,
                )

        log.info("[flush-transcripts] ============================================")
        log.info("[flush-transcripts] FLUSH JOB COMPLETED")
        log.info(f"[flush-transcripts] Total plans  covered: {total_plans}")
        log.info(f"[flush-transcripts] Total plans  skipped: {total_skipped}")
        log.info(f"[flush-transcripts] Total transcripts deleted: {total_transcripts}")
        log.info("[flush-transcripts] ============================================")

    async def _flush_transcripts_for_plan(
        self,
        *,
        plan: str,
        cutoff: datetime,
        max_projects_per_batch: int,
        max_transcripts_per_batch: int,
    ) -> int:
        last_project_id = None
        total_transcripts = 0

        while True:
            project_ids = await self.transcripts_dao.fetch_projects_with_plan(
                plan=plan,
                project_id=last_project_id,
                max_projects=max_projects_per_batch,
            )

            if not project_ids:
                break

            last_project_id = project_ids[-1]

            transcripts_deleted = (
                await self.transcripts_dao.delete_transcripts_before_cutoff(
                    cutoff=cutoff,
                    project_ids=project_ids,
                    max_transcripts=max_transcripts_per_batch,
                )
            )

            total_transcripts += transcripts_deleted

        return total_transcripts
