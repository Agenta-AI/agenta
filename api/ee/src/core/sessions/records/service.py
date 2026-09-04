"""EE session-record retention."""

from datetime import datetime, timezone, timedelta

from oss.src.utils.logging import get_module_logger

from ee.src.dbs.postgres.sessions.records.dao import RecordsRetentionDAO
from oss.src.utils.env import env


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

        retention_days = env.sessions.history_retention_days
        if retention_days is None:
            log.info("[flush-records] Skipped (session history retention is unlimited)")
            return

        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        log.info(
            f"[flush-records] Processing with cutoff={cutoff.isoformat()} "
            f"(retention={retention_days} days)"
        )

        total_records = await self._flush_records(
            cutoff=cutoff,
            max_projects_per_batch=max_projects_per_batch,
            max_records_per_batch=max_records_per_batch,
        )

        log.info("[flush-records] ============================================")
        log.info("[flush-records] FLUSH JOB COMPLETED")
        log.info(f"[flush-records] Total records deleted: {total_records}")
        log.info("[flush-records] ============================================")

    async def _flush_records(
        self,
        *,
        cutoff: datetime,
        max_projects_per_batch: int,
        max_records_per_batch: int,
    ) -> int:
        last_project_id = None
        total_records = 0

        while True:
            project_ids = await self.records_dao.fetch_projects(
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
