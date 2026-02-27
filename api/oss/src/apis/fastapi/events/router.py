from uuid import UUID

from fastapi import APIRouter, Request, status

from oss.src.utils.common import is_ee
from oss.src.apis.fastapi.events.models import EventQueryRequest, EventsQueryResponse
from oss.src.core.events.service import EventsService
from oss.src.utils.exceptions import intercept_exceptions

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


class EventsRouter:
    def __init__(
        self,
        events_service: EventsService,
    ):
        self.service = events_service

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
        query_request: EventQueryRequest,
    ) -> EventsQueryResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_SPANS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        events = await self.service.query(
            project_id=UUID(request.state.project_id),
            #
            event=query_request.event,
            #
            windowing=query_request.windowing,
        )
        return EventsQueryResponse(
            count=len(events),
            events=events,
        )
