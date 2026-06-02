"""EE events service (retention).

Walks the effective plan map and, for each plan that defines a non-null
``Counter.EVENTS_INGESTED.retention``, deletes events older than the
retention cutoff for projects whose org subscribes to that plan.

Parallel to ``ee.src.core.tracing.service.TracingRetentionService`` (same shape,
different counter and DAO). The OSS counterpart
(``oss.src.core.events.service.EventsService``) owns ingest/query.
"""

from datetime import datetime, timezone, timedelta

from oss.src.utils.logging import get_module_logger

from ee.src.core.entitlements.types import Tracker, Counter
from ee.src.core.entitlements.controls import get_plans
from ee.src.dbs.postgres.events.dao import EventsRetentionDAO


log = get_module_logger(__name__)


class EventsRetentionService:
    def __init__(
        self,
        events_retention_dao: EventsRetentionDAO,
    ):
        self.events_dao = events_retention_dao

    async def flush_events(
        self,
        *,
        max_projects_per_batch: int = 500,
        max_events_per_batch: int = 5000,
    ) -> None:
        log.info("[flush-events] ============================================")
        log.info("[flush-events] Starting events flush job")
        log.info("[flush-events] ============================================")

        total_plans = 0
        total_skipped = 0
        total_events = 0

        for plan, entitlements in get_plans().items():
            total_plans += 1

            if not entitlements:
                log.info(f"[flush-events] [{plan}] Skipped (no entitlements)")
                total_skipped += 1
                continue

            events_quota = (entitlements.get(Tracker.COUNTERS) or {}).get(
                Counter.EVENTS_INGESTED
            )

            if not events_quota or events_quota.retention is None:
                log.info(f"[flush-events] [{plan}] Skipped (unlimited retention)")
                total_skipped += 1
                continue

            retention_minutes = events_quota.retention
            cutoff = datetime.now(timezone.utc) - timedelta(minutes=retention_minutes)

            log.info(
                f"[flush-events] [{plan}] Processing with cutoff={cutoff.isoformat()} "
                f"(retention={retention_minutes} minutes)"
            )

            try:
                plan_events = await self._flush_events_for_plan(
                    plan=plan,
                    cutoff=cutoff,
                    max_projects_per_batch=max_projects_per_batch,
                    max_events_per_batch=max_events_per_batch,
                )

                total_events += plan_events

                log.info(f"[flush-events] [{plan}] ✅ Completed: {plan_events} events")

            except Exception:
                log.error(
                    f"[flush-events] [{plan}] ❌ Failed",
                    exc_info=True,
                )

        log.info("[flush-events] ============================================")
        log.info("[flush-events] ✅ FLUSH JOB COMPLETED")
        log.info(f"[flush-events] Total plans  covered: {total_plans}")
        log.info(f"[flush-events] Total plans  skipped: {total_skipped}")
        log.info(f"[flush-events] Total events deleted: {total_events}")
        log.info("[flush-events] ============================================")

    async def _flush_events_for_plan(
        self,
        *,
        plan: str,
        cutoff: datetime,
        max_projects_per_batch: int,
        max_events_per_batch: int,
    ) -> int:
        last_project_id = None
        total_events = 0

        while True:
            project_ids = await self.events_dao.fetch_projects_with_plan(
                plan=plan,
                project_id=last_project_id,
                max_projects=max_projects_per_batch,
            )

            if not project_ids:
                break

            last_project_id = project_ids[-1]

            events_deleted = await self.events_dao.delete_events_before_cutoff(
                cutoff=cutoff,
                project_ids=project_ids,
                max_events=max_events_per_batch,
            )

            total_events += events_deleted

        return total_events
