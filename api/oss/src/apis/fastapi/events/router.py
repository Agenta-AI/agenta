from uuid import UUID

from fastapi import APIRouter, Request, status

from oss.src.apis.fastapi.events.models import (
    EventQueryRequest,
    EventsQueryResponse,
    EventResponse,
)
from oss.src.core.events.dtos import EventQueryDTO
from oss.src.core.events.service import EventsService
from oss.src.utils.exceptions import intercept_exceptions


class EventsRouter:
    def __init__(self, events_service: EventsService):
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
        query = EventQueryDTO(**query_request.model_dump(mode="json"))
        event_dtos = await self.service.query(
            project_id=UUID(request.state.project_id),
            query=query,
        )
        return EventsQueryResponse(
            count=len(event_dtos),
            events=[EventResponse(**e.model_dump(mode="json")) for e in event_dtos],
        )
