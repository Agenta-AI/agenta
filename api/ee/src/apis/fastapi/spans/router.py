"""Admin-only spans retention router.

Mounts at ``/admin/spans/flush``. Owned by tracing; replaces the previous
``/admin/billing/usage/flush`` endpoint (which conflated billing and span
retention). Independent from the events retention router.
"""

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.caching import acquire_lock, release_lock

from ee.src.core.tracing.service import TracingRetentionService


log = get_module_logger(__name__)


class SpansRetentionRouter:
    def __init__(
        self,
        tracing_retention_service: TracingRetentionService,
    ):
        self.tracing_retention_service = tracing_retention_service

        self.admin_router = APIRouter()

        self.admin_router.add_api_route(
            "/flush",
            self.flush,
            methods=["POST"],
        )

    @intercept_exceptions()
    async def flush(self):
        """Apply span retention across all plans that define
        ``Counter.TRACES.retention``. Wrapped in a Redis lock so concurrent
        cron triggers no-op cleanly.
        """
        log.info("[flush-spans] [endpoint] Trigger")

        try:
            lock_owner = await acquire_lock(
                namespace="spans:flush",
                key={},
                ttl=3600,  # 1 hour
                strict=True,
            )

            if not lock_owner:
                log.info("[flush-spans] [endpoint] Skipped (ongoing)")
                return JSONResponse(
                    status_code=status.HTTP_200_OK,
                    content={"status": "skipped"},
                )

            log.info("[flush-spans] [endpoint] Lock acquired")

            try:
                log.info("[flush-spans] [endpoint] Retention started")
                await self.tracing_retention_service.flush_spans()
                log.info("[flush-spans] [endpoint] Retention completed")

                return JSONResponse(
                    status_code=status.HTTP_200_OK,
                    content={"status": "success"},
                )

            except Exception:
                log.error(
                    "[flush-spans] [endpoint] Retention failed:",
                    exc_info=True,
                )
                return JSONResponse(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    content={"status": "error", "message": "Retention failed"},
                )

            finally:
                released = await release_lock(
                    namespace="spans:flush",
                    key={},
                    owner=lock_owner,
                )
                if released:
                    log.info("[flush-spans] [endpoint] Lock released")
                else:
                    log.warn(
                        "[flush-spans] [endpoint] Lock release skipped (expired/lost)"
                    )

        except Exception:
            log.error(
                "[flush-spans] [endpoint] Fatal error:",
                exc_info=True,
            )
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"status": "error", "message": "Fatal error"},
            )
