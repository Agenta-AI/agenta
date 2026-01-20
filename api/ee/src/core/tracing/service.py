from datetime import datetime, timezone, timedelta

from oss.src.utils.logging import get_module_logger

from ee.src.core.subscriptions.types import Plan
from ee.src.core.entitlements.types import ENTITLEMENTS, Tracker, Counter
from ee.src.dbs.postgres.tracing.dao import TracingDAO


log = get_module_logger(__name__)


class TracingService:
    def __init__(
        self,
        tracing_dao: TracingDAO,
    ):
        self.tracing_dao = tracing_dao

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

        for plan in Plan:
            total_plans += 1

            entitlements = ENTITLEMENTS.get(plan)

            if not entitlements:
                log.info(f"[flush] [{plan.value}] Skipped (no entitlements)")
                total_skipped += 1
                continue

            traces_quota = entitlements.get(Tracker.COUNTERS, {}).get(Counter.TRACES)

            if not traces_quota or traces_quota.retention is None:
                log.info(f"[flush] [{plan.value}] Skipped (unlimited retention)")
                total_skipped += 1
                continue

            retention_minutes = traces_quota.retention
            cutoff = datetime.now(timezone.utc) - timedelta(minutes=retention_minutes)

            log.info(
                f"[flush] [{plan.value}] Processing with cutoff={cutoff.isoformat()} (retention={retention_minutes} minutes)"
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
                    f"[flush] [{plan.value}] ✅ Completed: {plan_traces} traces, {plan_spans} spans"
                )

            except Exception:
                log.error(
                    f"[flush] [{plan.value}] ❌ Failed",
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
        plan: Plan,
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
                plan=plan.value,
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
