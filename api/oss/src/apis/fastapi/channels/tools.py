"""The routes the channel agent tools call. The runner reaches them with the
run's own credential and fills the self-targeting fields (the workflow
artifact, the session, the tool call) from trusted run context, hidden from
the model. Every request model is closed, so a model that adds a routing
field is refused before anything is read."""

from functools import wraps
from typing import TYPE_CHECKING
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from oss.src.apis.fastapi.channels.models import (
    ChannelToolsAvailabilityRequest,
    ChannelToolsAvailabilityResponse,
    ChannelDestinationsQueryRequest,
)
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.channels.tools.dtos import ChannelDestinationsPage
from oss.src.core.channels.tools.types import (
    ChannelToolsNotFound,
    ChannelToolsRefused,
)
from oss.src.utils.exceptions import intercept_exceptions

if TYPE_CHECKING:
    from oss.src.core.channels.tools.service import ChannelToolsService


def handle_channel_tools_exceptions():
    """A refusal is the model's to read: its message says what to do next.
    Not found says nothing about whether the reference exists elsewhere."""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except ChannelToolsNotFound as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail=e.message
                ) from e
            except ChannelToolsRefused as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail=e.message
                ) from e

        return wrapper

    return decorator


class ChannelToolsRouter:
    def __init__(self, *, tools_service: "ChannelToolsService") -> None:
        self.tools_service = tools_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/tools/availability",
            self.fetch_channel_tools_availability,
            methods=["POST"],
            operation_id="fetch_channel_tools_availability",
            response_model=ChannelToolsAvailabilityResponse,
        )
        self.router.add_api_route(
            "/tools/destinations/query",
            self.query_channel_destinations,
            methods=["POST"],
            operation_id="query_channel_destinations",
            response_model=ChannelDestinationsPage,
        )

    async def _check(self, request: Request) -> UUID:
        allowed = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(request.state.project_id),
            permission=Permission.RUN_CHANNELS,
        )
        if not allowed:
            raise FORBIDDEN_EXCEPTION
        return UUID(str(request.state.project_id))

    @intercept_exceptions()
    async def fetch_channel_tools_availability(
        self,
        request: Request,
        *,
        body: ChannelToolsAvailabilityRequest,
    ) -> ChannelToolsAvailabilityResponse:
        """Whether this agent is connected to an active, verified bot: the
        condition the Agenta tools kit reads before adding the channel tools
        to a run."""

        project_id = await self._check(request)
        available = await self.tools_service.is_available(
            project_id=project_id, artifact_id=body.artifact_id
        )
        return ChannelToolsAvailabilityResponse(available=available)

    @intercept_exceptions()
    @handle_channel_tools_exceptions()
    async def query_channel_destinations(
        self,
        request: Request,
        *,
        body: ChannelDestinationsQueryRequest,
    ) -> ChannelDestinationsPage:
        project_id = await self._check(request)
        return await self.tools_service.list_destinations(
            project_id=project_id,
            artifact_id=body.artifact_id,
            query=body.query,
            limit=body.limit,
            cursor=body.cursor,
        )
