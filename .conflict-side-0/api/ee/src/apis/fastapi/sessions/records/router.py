"""EE records router.

Mounts record reading at ``/sessions/records/query`` (and ``/{id}``)
and admin retention at ``/admin/records/flush``. Retention is independent
from spans and events: own lock namespace, own cron schedule, own failure mode.
"""

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.locking import acquire_lock, release_lock

from ee.src.core.sessions.records.service import RecordsRetentionService


log = get_module_logger(__name__)


class RecordsRetentionRouter:
    def __init__(
        self,
        records_retention_service: RecordsRetentionService,
    ):
        self.records_retention_service = records_retention_service

        self.admin_router = APIRouter()

        self.admin_router.add_api_route(
            "/flush",
            self.flush,
            methods=["POST"],
        )

    @intercept_exceptions()
    async def flush(self):
        """Apply record retention across all plans that define
        ``Counter.RECORDS_INGESTED.retention``. Redis-locked so concurrent
        cron triggers no-op cleanly.
        """
        log.info("[flush-records] [endpoint] Trigger")

        try:
            lock_owner = await acquire_lock(
                namespace="records:flush",
                key={},
                ttl=3600,
                strict=True,
            )

            if not lock_owner:
                log.info("[flush-records] [endpoint] Skipped (ongoing)")
                return JSONResponse(
                    status_code=status.HTTP_200_OK,
                    content={"status": "skipped"},
                )

            log.info("[flush-records] [endpoint] Lock acquired")

            try:
                log.info("[flush-records] [endpoint] Retention started")
                await self.records_retention_service.flush_records()
                log.info("[flush-records] [endpoint] Retention completed")

                return JSONResponse(
                    status_code=status.HTTP_200_OK,
                    content={"status": "success"},
                )

            except Exception:
                log.error(
                    "[flush-records] [endpoint] Retention failed:",
                    exc_info=True,
                )
                return JSONResponse(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    content={"status": "error", "message": "Retention failed"},
                )

            finally:
                released = await release_lock(
                    namespace="records:flush",
                    key={},
                    owner=lock_owner,
                )
                if released:
                    log.info("[flush-records] [endpoint] Lock released")
                else:
                    log.warn(
                        "[flush-records] [endpoint] Lock release skipped (expired/lost)"
                    )

        except Exception:
            log.error(
                "[flush-records] [endpoint] Fatal error:",
                exc_info=True,
            )
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"status": "error", "message": "Fatal error"},
            )
