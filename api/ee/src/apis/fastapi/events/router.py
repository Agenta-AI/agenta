"""EE events routers.

Mounts user-facing audit-log querying at ``/events/query`` and admin retention
at ``/admin/events/flush``. Retention is independent from spans retention: own
lock namespace, own cron schedule, own failure mode.
"""

from uuid import UUID
from typing import Union

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.caching import acquire_lock, release_lock
from oss.src.core.events.service import EventsService

from ee.src.apis.fastapi.events.models import EventQueryRequest, EventsQueryResponse
from ee.src.core.events.service import EventsRetentionService
from ee.src.models.shared_models import Permission
from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION
from ee.src.utils.entitlements import (
    check_entitlements,
    NOT_ENTITLED_RESPONSE,
    Flag,
    Tracker,
)


log = get_module_logger(__name__)


class EventsRouter:
    def __init__(
        self,
        events_service: EventsService,
    ):
        self.events_service = events_service

        self.router = APIRouter()

        self.router.add_api_route(
            "/query",
            self.query_events,
            methods=["POST"],
            operation_id="query_events_rpc",
            status_code=status.HTTP_200_OK,
            response_model=EventsQueryResponse,
            response_model_exclude_none=True,
        )

    @intercept_exceptions()
    async def query_events(
        self,
        request: Request,
        *,
        query_request: EventQueryRequest,
    ) -> Union[EventsQueryResponse, JSONResponse]:
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_EVENTS,
        ):
            raise FORBIDDEN_EXCEPTION

        check, _, _ = await check_entitlements(
            key=Flag.AUDIT,
        )
        if not check:
            return NOT_ENTITLED_RESPONSE(Tracker.FLAGS)

        events = await self.events_service.query(
            project_id=UUID(request.state.project_id),
            event=query_request.event,
            windowing=query_request.windowing,
        )
        return EventsQueryResponse(
            count=len(events),
            events=events,
        )


class EventsRetentionRouter:
    def __init__(
        self,
        events_retention_service: EventsRetentionService,
    ):
        self.events_retention_service = events_retention_service

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
                await self.events_retention_service.flush_events()
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
