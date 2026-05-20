"""Admin-only events retention router.

Mounts at ``/admin/events/flush``. Independent from spans retention — own
lock namespace, own cron schedule, own failure mode.
"""

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.caching import acquire_lock, release_lock

from ee.src.core.events.service import EventsService


log = get_module_logger(__name__)


class EventsRouter:
    def __init__(
        self,
        events_service: EventsService,
    ):
        self.events_service = events_service

        self.admin_router = APIRouter()

        self.admin_router.add_api_route(
            "/flush",
            self.flush,
            methods=["POST"],
        )

    @intercept_exceptions()
    async def flush(self):
        """Apply events retention across all plans that define
        ``Counter.EVENTS_INGESTED.retention``. Wrapped in a Redis lock so concurrent
        cron triggers no-op cleanly.
        """
        log.info("[flush-events] [endpoint] Trigger")

        try:
            lock_owner = await acquire_lock(
                namespace="events:flush",
                key={},
                ttl=3600,  # 1 hour
                strict=True,
            )

            if not lock_owner:
                log.info("[flush-events] [endpoint] Skipped (ongoing)")
                return JSONResponse(
                    status_code=status.HTTP_200_OK,
                    content={"status": "skipped"},
                )

            log.info("[flush-events] [endpoint] Lock acquired")

            try:
                log.info("[flush-events] [endpoint] Retention started")
                await self.events_service.flush_events()
                log.info("[flush-events] [endpoint] Retention completed")

                return JSONResponse(
                    status_code=status.HTTP_200_OK,
                    content={"status": "success"},
                )

            except Exception:
                log.error(
                    "[flush-events] [endpoint] Retention failed:",
                    exc_info=True,
                )
                return JSONResponse(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    content={"status": "error", "message": "Retention failed"},
                )

            finally:
                released = await release_lock(
                    namespace="events:flush",
                    key={},
                    owner=lock_owner,
                )
                if released:
                    log.info("[flush-events] [endpoint] Lock released")
                else:
                    log.warn(
                        "[flush-events] [endpoint] Lock release skipped (expired/lost)"
                    )

        except Exception:
            log.error(
                "[flush-events] [endpoint] Fatal error:",
                exc_info=True,
            )
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"status": "error", "message": "Fatal error"},
            )
