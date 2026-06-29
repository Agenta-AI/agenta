"""EE records service (retention).

Mirrors ``ee.src.core.events.service.EventsRetentionService`` — same shape,
different counter and DAO. The OSS counterpart
(``oss.src.core.sessions.records.service.RecordsService``) owns append/query.
"""

from datetime import datetime, timezone, timedelta

from oss.src.utils.logging import get_module_logger

from ee.src.core.access.entitlements.types import Tracker, Counter
from ee.src.core.access.controls import get_plans
from ee.src.dbs.postgres.sessions.records.dao import RecordsRetentionDAO


log = get_module_logger(__name__)


class RecordsRetentionService:
    def __init__(
        self,
        records_retention_dao: RecordsRetentionDAO,
    ):
        self.records_dao = records_retention_dao

    async def flush_records(
        self,
        *,
        max_projects_per_batch: int = 500,
        max_records_per_batch: int = 5000,
    ) -> None:
        log.info("[flush-records] ============================================")
        log.info("[flush-records] Starting records flush job")
        log.info("[flush-records] ============================================")

        total_plans = 0
        total_skipped = 0
        total_records = 0

        for plan, entitlements in get_plans().items():
            total_plans += 1

            if not entitlements:
                log.info(f"[flush-records] [{plan}] Skipped (no entitlements)")
                total_skipped += 1
                continue

            records_quota = (entitlements.get(Tracker.COUNTERS) or {}).get(
                Counter.RECORDS_INGESTED
            )

            if not records_quota or records_quota.retention is None:
                log.info(f"[flush-records] [{plan}] Skipped (unlimited retention)")
                total_skipped += 1
                continue

            retention_minutes = records_quota.retention
            cutoff = datetime.now(timezone.utc) - timedelta(minutes=retention_minutes)

            log.info(
                f"[flush-records] [{plan}] Processing with cutoff={cutoff.isoformat()} "
                f"(retention={retention_minutes} minutes)"
            )

            try:
                plan_records = await self._flush_records_for_plan(
                    plan=plan,
                    cutoff=cutoff,
                    max_projects_per_batch=max_projects_per_batch,
                    max_records_per_batch=max_records_per_batch,
                )

                total_records += plan_records

                log.info(f"[flush-records] [{plan}] Completed: {plan_records} records")

            except Exception:
                log.error(
                    f"[flush-records] [{plan}] Failed",
                    exc_info=True,
                )

        log.info("[flush-records] ============================================")
        log.info("[flush-records] FLUSH JOB COMPLETED")
        log.info(f"[flush-records] Total plans  covered: {total_plans}")
        log.info(f"[flush-records] Total plans  skipped: {total_skipped}")
        log.info(f"[flush-records] Total records deleted: {total_records}")
        log.info("[flush-records] ============================================")

    async def _flush_records_for_plan(
        self,
        *,
        plan: str,
        cutoff: datetime,
        max_projects_per_batch: int,
        max_records_per_batch: int,
    ) -> int:
        last_project_id = None
        total_records = 0

        while True:
            project_ids = await self.records_dao.fetch_projects_with_plan(
                plan=plan,
                project_id=last_project_id,
                max_projects=max_projects_per_batch,
            )

            if not project_ids:
                break

            last_project_id = project_ids[-1]

            records_deleted = await self.records_dao.delete_records_before_cutoff(
                cutoff=cutoff,
                project_ids=project_ids,
                max_records=max_records_per_batch,
            )

            total_records += records_deleted

        return total_records
