from datetime import datetime, timezone, timedelta

from oss.src.utils.logging import get_module_logger

from ee.src.core.entitlements.types import Tracker, Counter
from ee.src.core.entitlements.controls import get_plans
from ee.src.dbs.postgres.tracing.dao import TracingRetentionDAO


log = get_module_logger(__name__)


class TracingRetentionService:
    def __init__(
        self,
        tracing_retention_dao: TracingRetentionDAO,
    ):
        self.tracing_dao = tracing_retention_dao

    async def flush_spans(
        self,
        *,
        max_projects_per_batch: int = 500,
        max_traces_per_batch: int = 5000,
    ) -> None:
        log.info("[flush] ============================================")
        log.info("[flush] Starting spans flush job")
        log.info("[flush] ============================================")

        total_plans = 0
        total_skipped = 0
        total_traces = 0
        total_spans = 0

        for plan, entitlements in get_plans().items():
            total_plans += 1

            if not entitlements:
                log.info(f"[flush] [{plan}] Skipped (no entitlements)")
                total_skipped += 1
                continue

            traces_quota = (entitlements.get(Tracker.COUNTERS) or {}).get(
                Counter.TRACES_INGESTED
            )

            if not traces_quota or traces_quota.retention is None:
                log.info(f"[flush] [{plan}] Skipped (unlimited retention)")
                total_skipped += 1
                continue

            retention_minutes = traces_quota.retention
            cutoff = datetime.now(timezone.utc) - timedelta(minutes=retention_minutes)

            log.info(
                f"[flush] [{plan}] Processing with cutoff={cutoff.isoformat()} (retention={retention_minutes} minutes)"
            )

            try:
                plan_traces, plan_spans = await self._flush_spans_for_plan(
                    plan=plan,
                    cutoff=cutoff,
                    max_projects_per_batch=max_projects_per_batch,
                    max_traces_per_batch=max_traces_per_batch,
                )

                total_traces += plan_traces
                total_spans += plan_spans

                log.info(
                    f"[flush] [{plan}] ✅ Completed: {plan_traces} traces, {plan_spans} spans"
                )

            except Exception:
                log.error(
                    f"[flush] [{plan}] ❌ Failed",
                    exc_info=True,
                )

        log.info("[flush] ============================================")
        log.info("[flush] ✅ FLUSH JOB COMPLETED")
        log.info(f"[flush] Total plans  covered: {total_plans}")
        log.info(f"[flush] Total plans  skipped: {total_skipped}")
        log.info(f"[flush] Total traces deleted: {total_traces}")
        log.info(f"[flush] Total spans  deleted: {total_spans}")
        log.info("[flush] ============================================")

    async def _flush_spans_for_plan(
        self,
        *,
        plan: str,
        cutoff: datetime,
        max_projects_per_batch: int,
        max_traces_per_batch: int,
    ) -> tuple[int, int]:
        last_project_id = None
        batch_idx = 0
        total_traces = 0
        total_spans = 0

        while True:
            project_ids = await self.tracing_dao.fetch_projects_with_plan(
                plan=plan,
                project_id=last_project_id,
                max_projects=max_projects_per_batch,
            )

            if not project_ids:
                break

            batch_idx += 1
            last_project_id = project_ids[-1]

            traces, spans = await self.tracing_dao.delete_traces_before_cutoff(
                cutoff=cutoff,
                project_ids=project_ids,
                max_traces=max_traces_per_batch,
            )

            total_traces += traces
            total_spans += spans

            # if traces > 0:
            #     log.debug(
            #         f"[flush] [{plan.value}] Chunk #{batch_idx}: {traces} traces, {spans} spans"
            #     )

        return total_traces, total_spans
