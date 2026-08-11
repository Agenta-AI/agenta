from datetime import datetime, timezone
from typing import TYPE_CHECKING, List
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from oss.src.utils.exceptions import intercept_exceptions

from oss.src.apis.fastapi.channels.models import (
    AgentaConversationItem,
    AgentaConversationResponse,
    ChannelAgentCreateRequest,
    ChannelAgentEditRequest,
    ChannelAgentQueryRequest,
    ChannelAgentResponse,
    ChannelAgentsResponse,
    ChannelCapabilitiesResponse,
    ChannelConnectionCreateRequest,
    ChannelConnectionEditRequest,
    ChannelConnectionQueryRequest,
    ChannelConnectionResponse,
    ChannelConnectionSetupResponse,
    ChannelConnectionsResponse,
    ChannelConnectionTeardownResponse,
    ChannelGrantCreateRequest,
    ChannelGrantEditRequest,
    ChannelGrantQueryRequest,
    ChannelGrantResponse,
    ChannelGrantsResponse,
    ChannelInboxEventQueryRequest,
    ChannelInboxEventsResponse,
    ChannelOutboxEventQueryRequest,
    ChannelOutboxEventsResponse,
    ChannelPolicyResolveRequest,
    ChannelPolicyResponse,
    ChannelSpaceCandidatesResponse,
    ChannelSpaceCreateRequest,
    ChannelSpaceDiscoverRequest,
    ChannelSpaceEditRequest,
    ChannelSpaceQueryRequest,
    ChannelSpaceResponse,
    ChannelSpacesResponse,
    ChannelThreadQueryRequest,
    ChannelThreadResponse,
    ChannelThreadsResponse,
    ChannelsCatalogResponse,
)
from oss.src.core.channels.dtos import (
    ChannelInboxEventQuery,
    ChannelOutboxEventQuery,
    ChannelThreadQuery,
)
from oss.src.core.channels.types import (
    ChannelAgentNotFound,
    ChannelConnectionIncomplete,
    ChannelConnectionKeyUndeclared,
    ChannelConnectionNotFound,
    ChannelConnectionVerificationFailed,
    ChannelLocatorIncomplete,
    ChannelNotSupported,
    ChannelSpaceNotFound,
    ChannelThreadNotFound,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION

if TYPE_CHECKING:
    from oss.src.core.channels.service import ChannelsService
    from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry


def handle_channel_adapter_exceptions():
    """Unregistered channel -> 404. Mirrors ingress.py's own decorator, which
    this router cannot import without pulling in the public route table."""

    from functools import wraps

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except ChannelNotSupported as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=str(e),
                ) from e

        return wrapper

    return decorator


class ChannelsRouter:
    """The authenticated configuration surface: connections, agents, spaces,
    grants, policy, threads/inbox/outbox observability. Ingress
    (`ChannelsIngressRouter`) is public and mounted separately — this router
    never registers it and never imports its handlers."""

    def __init__(
        self,
        *,
        channels_service: "ChannelsService",
        adapter_registry: "ChannelAdapterRegistry",
    ):
        self.channels_service = channels_service
        self.adapter_registry = adapter_registry

        self.router = APIRouter()

        # --- Catalog -------------------------------------------------------- #
        self.router.add_api_route(
            "/catalog/channels/",
            self.list_channels,
            methods=["GET"],
            operation_id="list_channels",
            response_model=ChannelsCatalogResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/catalog/channels/{channel}/capabilities/",
            self.fetch_channel_capabilities,
            methods=["GET"],
            operation_id="fetch_channel_capabilities",
            response_model=ChannelCapabilitiesResponse,
            response_model_exclude_none=True,
        )

        # --- Connections ------------------------------------------------------ #
        self.router.add_api_route(
            "/connections/",
            self.create_channel_connection,
            methods=["POST"],
            operation_id="create_channel_connection",
            response_model=ChannelConnectionResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connections/query",
            self.query_channel_connections,
            methods=["POST"],
            operation_id="query_channel_connections",
            response_model=ChannelConnectionsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connections/{connection_id}/edit",
            self.edit_channel_connection,
            methods=["POST"],
            operation_id="edit_channel_connection",
            response_model=ChannelConnectionResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connections/{connection_id}/archive",
            self.archive_channel_connection,
            methods=["POST"],
            operation_id="archive_channel_connection",
            response_model=ChannelConnectionTeardownResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connections/{connection_id}/unarchive",
            self.unarchive_channel_connection,
            methods=["POST"],
            operation_id="unarchive_channel_connection",
            response_model=ChannelConnectionTeardownResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/connections/{connection_id}/setup",
            self.fetch_channel_connection_setup,
            methods=["GET"],
            operation_id="fetch_channel_connection_setup",
            response_model=ChannelConnectionSetupResponse,
            response_model_exclude_none=True,
        )

        # --- Agents ----------------------------------------------------------- #
        self.router.add_api_route(
            "/agents/",
            self.create_channel_agent,
            methods=["POST"],
            operation_id="create_channel_agent",
            response_model=ChannelAgentResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/agents/",
            self.list_channel_agents,
            methods=["GET"],
            operation_id="list_channel_agents",
            response_model=ChannelAgentsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/agents/query",
            self.query_channel_agents,
            methods=["POST"],
            operation_id="query_channel_agents",
            response_model=ChannelAgentsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/agents/{agent_id}",
            self.fetch_channel_agent,
            methods=["GET"],
            operation_id="fetch_channel_agent",
            response_model=ChannelAgentResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/agents/{agent_id}",
            self.edit_channel_agent,
            methods=["PUT"],
            operation_id="edit_channel_agent",
            response_model=ChannelAgentResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/agents/{agent_id}",
            self.delete_channel_agent,
            methods=["DELETE"],
            operation_id="delete_channel_agent",
            status_code=status.HTTP_204_NO_CONTENT,
        )
        self.router.add_api_route(
            "/agents/{agent_id}/default",
            self.set_channel_agent_default,
            methods=["POST"],
            operation_id="set_channel_agent_default",
            response_model=ChannelAgentResponse,
            response_model_exclude_none=True,
        )

        # --- Spaces ----------------------------------------------------------- #
        self.router.add_api_route(
            "/spaces/",
            self.create_channel_space,
            methods=["POST"],
            operation_id="create_channel_space",
            response_model=ChannelSpaceResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/spaces/",
            self.list_channel_spaces,
            methods=["GET"],
            operation_id="list_channel_spaces",
            response_model=ChannelSpacesResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/spaces/query",
            self.query_channel_spaces,
            methods=["POST"],
            operation_id="query_channel_spaces",
            response_model=ChannelSpacesResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/spaces/discover",
            self.discover_channel_spaces,
            methods=["POST"],
            operation_id="discover_channel_spaces",
            response_model=ChannelSpaceCandidatesResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/spaces/{space_id}",
            self.fetch_channel_space,
            methods=["GET"],
            operation_id="fetch_channel_space",
            response_model=ChannelSpaceResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/spaces/{space_id}",
            self.edit_channel_space,
            methods=["PUT"],
            operation_id="edit_channel_space",
            response_model=ChannelSpaceResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/spaces/{space_id}",
            self.delete_channel_space,
            methods=["DELETE"],
            operation_id="delete_channel_space",
            status_code=status.HTTP_204_NO_CONTENT,
        )

        # --- Grants ----------------------------------------------------------- #
        self.router.add_api_route(
            "/grants/",
            self.create_channel_grant,
            methods=["POST"],
            operation_id="create_channel_grant",
            response_model=ChannelGrantResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/grants/",
            self.list_channel_grants,
            methods=["GET"],
            operation_id="list_channel_grants",
            response_model=ChannelGrantsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/grants/query",
            self.query_channel_grants,
            methods=["POST"],
            operation_id="query_channel_grants",
            response_model=ChannelGrantsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/grants/{grant_id}",
            self.edit_channel_grant,
            methods=["PUT"],
            operation_id="edit_channel_grant",
            response_model=ChannelGrantResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/grants/{grant_id}",
            self.delete_channel_grant,
            methods=["DELETE"],
            operation_id="delete_channel_grant",
            status_code=status.HTTP_204_NO_CONTENT,
        )
        self.router.add_api_route(
            "/grants/{grant_id}/default",
            self.set_channel_grant_default,
            methods=["POST"],
            operation_id="set_channel_grant_default",
            response_model=ChannelGrantResponse,
            response_model_exclude_none=True,
        )

        # --- Policy: the explain endpoint -------------------------------------- #
        self.router.add_api_route(
            "/policy/resolve",
            self.resolve_channel_policy,
            methods=["POST"],
            operation_id="resolve_channel_policy",
            response_model=ChannelPolicyResponse,
            response_model_exclude_none=True,
        )

        # --- Threads (read + close; never created over the wire) -------------- #
        self.router.add_api_route(
            "/threads/query",
            self.query_channel_threads,
            methods=["POST"],
            operation_id="query_channel_threads",
            response_model=ChannelThreadsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/threads/{thread_id}/close",
            self.close_channel_thread,
            methods=["POST"],
            operation_id="close_channel_thread",
            response_model=ChannelThreadResponse,
            response_model_exclude_none=True,
        )

        # --- Inbox / outbox (read-only observability) -------------------------- #
        self.router.add_api_route(
            "/inbox/events/query",
            self.query_channel_inbox_events,
            methods=["POST"],
            operation_id="query_channel_inbox_events",
            response_model=ChannelInboxEventsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/outbox/events/query",
            self.query_channel_outbox_events,
            methods=["POST"],
            operation_id="query_channel_outbox_events",
            response_model=ChannelOutboxEventsResponse,
            response_model_exclude_none=True,
        )

        # --- Agenta: the read route ---------------------------------------- #
        self.router.add_api_route(
            "/agenta/conversations/{id}",
            self.read_agenta_conversation,
            methods=["GET"],
            operation_id="read_agenta_conversation",
            response_model=AgentaConversationResponse,
            response_model_exclude_none=True,
        )

    async def _check(self, request: Request, permission: Permission) -> None:
        has_permission = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(request.state.project_id),
            permission=permission,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

    # -----------------------------------------------------------------------
    # Catalog
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def list_channels(self, request: Request) -> ChannelsCatalogResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        channels = self.adapter_registry.keys()
        return ChannelsCatalogResponse(count=len(channels), channels=channels)

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def fetch_channel_capabilities(
        self,
        request: Request,
        channel: str,
    ) -> ChannelCapabilitiesResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        capabilities = await self.channels_service.fetch_capabilities(channel=channel)
        return ChannelCapabilitiesResponse(
            count=1 if capabilities else 0,
            capabilities=capabilities,
        )

    # -----------------------------------------------------------------------
    # Connections
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def create_channel_connection(
        self,
        request: Request,
        *,
        body: ChannelConnectionCreateRequest,
    ) -> ChannelConnectionResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        try:
            connection = await self.channels_service.create_connection(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                connection=body.connection,
            )
        except (
            ChannelConnectionVerificationFailed,
            ChannelConnectionIncomplete,
            ChannelConnectionKeyUndeclared,
            ChannelLocatorIncomplete,
        ) as e:
            # the platform's own verification error, surfaced as it gave it
            raise HTTPException(status_code=400, detail=str(e)) from e

        return ChannelConnectionResponse(
            count=1 if connection else 0, connection=connection
        )

    @intercept_exceptions()
    async def query_channel_connections(
        self,
        request: Request,
        *,
        body: ChannelConnectionQueryRequest,
    ) -> ChannelConnectionsResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        connections = await self.channels_service.query_connections(
            project_id=UUID(request.state.project_id),
            #
            connection=body.connection,
            #
            windowing=body.windowing,
        )
        return ChannelConnectionsResponse(
            count=len(connections),
            connections=connections,
        )

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def edit_channel_connection(
        self,
        request: Request,
        *,
        connection_id: UUID,
        body: ChannelConnectionEditRequest,
    ) -> ChannelConnectionResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        if str(connection_id) != str(body.connection.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path connection_id does not match body id",
            )

        try:
            connection = await self.channels_service.edit_connection(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                connection=body.connection,
            )
        except ChannelConnectionVerificationFailed as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        if connection is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Channel connection not found",
            )

        return ChannelConnectionResponse(count=1, connection=connection)

    @intercept_exceptions()
    async def archive_channel_connection(
        self,
        request: Request,
        *,
        connection_id: UUID,
    ) -> ChannelConnectionTeardownResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        connection = await self.channels_service.archive_connection(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            #
            connection_id=connection_id,
        )
        if connection is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Channel connection not found",
            )

        return ChannelConnectionTeardownResponse(
            count=1,
            connection=connection,
            platform_notice=(
                "Archived on our side only. We never own the customer's app, "
                "so nothing was uninstalled or removed on the platform."
            ),
        )

    @intercept_exceptions()
    async def unarchive_channel_connection(
        self,
        request: Request,
        *,
        connection_id: UUID,
    ) -> ChannelConnectionTeardownResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        connection = await self.channels_service.unarchive_connection(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            #
            connection_id=connection_id,
        )
        if connection is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Channel connection not found",
            )

        return ChannelConnectionTeardownResponse(
            count=1,
            connection=connection,
            platform_notice=(
                "Unarchived on our side only; nothing changed on the platform "
                "either way."
            ),
        )

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def fetch_channel_connection_setup(
        self,
        request: Request,
        *,
        connection_id: UUID,
    ) -> ChannelConnectionSetupResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        connection = await self.channels_service.fetch_connection(
            project_id=UUID(request.state.project_id),
            connection_id=connection_id,
        )
        if connection is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Channel connection not found",
            )

        request_url = (
            f"{str(request.base_url).rstrip('/')}/channels/{connection.channel}/events/"
        )

        try:
            setup = await self.channels_service.get_connection_setup(
                project_id=UUID(request.state.project_id),
                connection_id=connection_id,
                request_url=request_url,
            )
        except ChannelConnectionNotFound as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return ChannelConnectionSetupResponse(count=1, setup=setup)

    # -----------------------------------------------------------------------
    # Agents
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def create_channel_agent(
        self,
        request: Request,
        *,
        body: ChannelAgentCreateRequest,
    ) -> ChannelAgentResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        try:
            agent = await self.channels_service.create_agent(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                agent=body.agent,
            )
        except ChannelConnectionNotFound as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return ChannelAgentResponse(count=1 if agent else 0, agent=agent)

    @intercept_exceptions()
    async def list_channel_agents(self, request: Request) -> ChannelAgentsResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        agents = await self.channels_service.query_agents(
            project_id=UUID(request.state.project_id),
        )
        return ChannelAgentsResponse(count=len(agents), agents=agents)

    @intercept_exceptions()
    async def query_channel_agents(
        self,
        request: Request,
        *,
        body: ChannelAgentQueryRequest,
    ) -> ChannelAgentsResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        agents = await self.channels_service.query_agents(
            project_id=UUID(request.state.project_id),
            #
            agent=body.agent,
            #
            windowing=body.windowing,
        )
        return ChannelAgentsResponse(count=len(agents), agents=agents)

    @intercept_exceptions()
    async def fetch_channel_agent(
        self,
        request: Request,
        *,
        agent_id: UUID,
    ) -> ChannelAgentResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        agent = await self.channels_service.fetch_agent(
            project_id=UUID(request.state.project_id),
            #
            agent_id=agent_id,
        )
        if agent is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Channel agent not found",
            )

        return ChannelAgentResponse(count=1, agent=agent)

    @intercept_exceptions()
    async def edit_channel_agent(
        self,
        request: Request,
        *,
        agent_id: UUID,
        body: ChannelAgentEditRequest,
    ) -> ChannelAgentResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        if str(agent_id) != str(body.agent.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path agent_id does not match body id",
            )

        agent = await self.channels_service.edit_agent(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            #
            agent=body.agent,
        )
        if agent is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Channel agent not found",
            )

        return ChannelAgentResponse(count=1, agent=agent)

    @intercept_exceptions()
    async def delete_channel_agent(
        self,
        request: Request,
        *,
        agent_id: UUID,
    ) -> None:
        await self._check(request, Permission.EDIT_CHANNELS)

        deleted = await self.channels_service.delete_agent(
            project_id=UUID(request.state.project_id),
            #
            agent_id=agent_id,
        )
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Channel agent not found",
            )

    @intercept_exceptions()
    async def set_channel_agent_default(
        self,
        request: Request,
        *,
        agent_id: UUID,
    ) -> ChannelAgentResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        try:
            agent = await self.channels_service.set_agent_default(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                agent_id=agent_id,
            )
        except ChannelAgentNotFound as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return ChannelAgentResponse(count=1, agent=agent)

    # -----------------------------------------------------------------------
    # Spaces
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def create_channel_space(
        self,
        request: Request,
        *,
        body: ChannelSpaceCreateRequest,
    ) -> ChannelSpaceResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        try:
            space = await self.channels_service.create_space(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                space=body.space,
            )
        except ChannelConnectionNotFound as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return ChannelSpaceResponse(count=1 if space else 0, space=space)

    @intercept_exceptions()
    async def list_channel_spaces(self, request: Request) -> ChannelSpacesResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        spaces = await self.channels_service.query_spaces(
            project_id=UUID(request.state.project_id),
        )
        return ChannelSpacesResponse(count=len(spaces), spaces=spaces)

    @intercept_exceptions()
    async def query_channel_spaces(
        self,
        request: Request,
        *,
        body: ChannelSpaceQueryRequest,
    ) -> ChannelSpacesResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        spaces = await self.channels_service.query_spaces(
            project_id=UUID(request.state.project_id),
            #
            space=body.space,
            #
            windowing=body.windowing,
        )
        return ChannelSpacesResponse(count=len(spaces), spaces=spaces)

    @intercept_exceptions()
    async def fetch_channel_space(
        self,
        request: Request,
        *,
        space_id: UUID,
    ) -> ChannelSpaceResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        space = await self.channels_service.fetch_space(
            project_id=UUID(request.state.project_id),
            #
            space_id=space_id,
        )
        if space is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Channel space not found",
            )

        return ChannelSpaceResponse(count=1, space=space)

    @intercept_exceptions()
    async def edit_channel_space(
        self,
        request: Request,
        *,
        space_id: UUID,
        body: ChannelSpaceEditRequest,
    ) -> ChannelSpaceResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        if str(space_id) != str(body.space.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path space_id does not match body id",
            )

        space = await self.channels_service.edit_space(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            #
            space=body.space,
        )
        if space is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Channel space not found",
            )

        return ChannelSpaceResponse(count=1, space=space)

    @intercept_exceptions()
    async def delete_channel_space(
        self,
        request: Request,
        *,
        space_id: UUID,
    ) -> None:
        await self._check(request, Permission.EDIT_CHANNELS)

        deleted = await self.channels_service.delete_space(
            project_id=UUID(request.state.project_id),
            #
            space_id=space_id,
        )
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Channel space not found",
            )

    @intercept_exceptions()
    @handle_channel_adapter_exceptions()
    async def discover_channel_spaces(
        self,
        request: Request,
        *,
        body: ChannelSpaceDiscoverRequest,
    ) -> ChannelSpaceCandidatesResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        try:
            candidates = await self.channels_service.discover_spaces(
                project_id=UUID(request.state.project_id),
                connection_id=body.connection_id,
            )
        except ChannelConnectionNotFound as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return ChannelSpaceCandidatesResponse(
            count=len(candidates),
            candidates=candidates,
        )

    # -----------------------------------------------------------------------
    # Grants
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def create_channel_grant(
        self,
        request: Request,
        *,
        body: ChannelGrantCreateRequest,
    ) -> ChannelGrantResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        grant = await self.channels_service.create_grant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            #
            grant=body.grant,
        )
        return ChannelGrantResponse(count=1 if grant else 0, grant=grant)

    @intercept_exceptions()
    async def list_channel_grants(self, request: Request) -> ChannelGrantsResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        grants = await self.channels_service.query_grants(
            project_id=UUID(request.state.project_id),
        )
        return ChannelGrantsResponse(count=len(grants), grants=grants)

    @intercept_exceptions()
    async def query_channel_grants(
        self,
        request: Request,
        *,
        body: ChannelGrantQueryRequest,
    ) -> ChannelGrantsResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        grants = await self.channels_service.query_grants(
            project_id=UUID(request.state.project_id),
            #
            grant=body.grant,
            #
            windowing=body.windowing,
        )
        return ChannelGrantsResponse(count=len(grants), grants=grants)

    @intercept_exceptions()
    async def edit_channel_grant(
        self,
        request: Request,
        *,
        grant_id: UUID,
        body: ChannelGrantEditRequest,
    ) -> ChannelGrantResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        if str(grant_id) != str(body.grant.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path grant_id does not match body id",
            )

        grant = await self.channels_service.edit_grant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            #
            grant=body.grant,
        )
        if grant is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Channel grant not found",
            )

        return ChannelGrantResponse(count=1, grant=grant)

    @intercept_exceptions()
    async def delete_channel_grant(
        self,
        request: Request,
        *,
        grant_id: UUID,
    ) -> None:
        await self._check(request, Permission.EDIT_CHANNELS)

        deleted = await self.channels_service.delete_grant(
            project_id=UUID(request.state.project_id),
            #
            grant_id=grant_id,
        )
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Channel grant not found",
            )

    @intercept_exceptions()
    async def set_channel_grant_default(
        self,
        request: Request,
        *,
        grant_id: UUID,
    ) -> ChannelGrantResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        try:
            grant = await self.channels_service.set_grant_default(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                grant_id=grant_id,
            )
        except ChannelAgentNotFound as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return ChannelGrantResponse(count=1, grant=grant)

    # -----------------------------------------------------------------------
    # Policy
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def resolve_channel_policy(
        self,
        request: Request,
        *,
        body: ChannelPolicyResolveRequest,
    ) -> ChannelPolicyResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        try:
            policy = await self.channels_service.resolve_effective_policy(
                project_id=UUID(request.state.project_id),
                agent_id=body.agent_id,
                space_id=body.space_id,
            )
        except ChannelAgentNotFound as e:
            raise HTTPException(status_code=404, detail=e.message) from e
        except ChannelSpaceNotFound as e:
            raise HTTPException(status_code=404, detail=e.message) from e
        except ChannelConnectionNotFound as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return ChannelPolicyResponse(count=1 if policy else 0, policy=policy)

    # -----------------------------------------------------------------------
    # Threads
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def query_channel_threads(
        self,
        request: Request,
        *,
        body: ChannelThreadQueryRequest,
    ) -> ChannelThreadsResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        threads = await self.channels_service.query_threads(
            project_id=UUID(request.state.project_id),
            #
            thread=body.thread,
            #
            windowing=body.windowing,
        )
        return ChannelThreadsResponse(count=len(threads), threads=threads)

    @intercept_exceptions()
    async def close_channel_thread(
        self,
        request: Request,
        *,
        thread_id: UUID,
    ) -> ChannelThreadResponse:
        await self._check(request, Permission.EDIT_CHANNELS)

        try:
            thread = await self.channels_service.close_thread(
                project_id=UUID(request.state.project_id),
                user_id=UUID(str(request.state.user_id)),
                #
                thread_id=thread_id,
            )
        except ChannelThreadNotFound as e:
            raise HTTPException(status_code=404, detail=e.message) from e

        return ChannelThreadResponse(count=1, thread=thread)

    # -----------------------------------------------------------------------
    # Inbox / outbox observability
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def query_channel_inbox_events(
        self,
        request: Request,
        *,
        body: ChannelInboxEventQueryRequest,
    ) -> ChannelInboxEventsResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        events = await self.channels_service.query_inbox_events(
            project_id=UUID(request.state.project_id),
            #
            event=body.event,
            #
            windowing=body.windowing,
        )
        return ChannelInboxEventsResponse(count=len(events), events=events)

    @intercept_exceptions()
    async def query_channel_outbox_events(
        self,
        request: Request,
        *,
        body: ChannelOutboxEventQueryRequest,
    ) -> ChannelOutboxEventsResponse:
        await self._check(request, Permission.VIEW_CHANNELS)

        events = await self.channels_service.query_outbox_events(
            project_id=UUID(request.state.project_id),
            #
            event=body.event,
            #
            windowing=body.windowing,
        )
        return ChannelOutboxEventsResponse(count=len(events), events=events)

    # -----------------------------------------------------------------------
    # Agenta: the read route
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    async def read_agenta_conversation(
        self,
        request: Request,
        *,
        id: UUID,
    ) -> AgentaConversationResponse:
        """The space's inbox log plus what the outbox posted back, merged and
        ordered by when each was written."""

        await self._check(request, Permission.VIEW_CHANNELS)

        project_id = UUID(request.state.project_id)

        space = await self.channels_service.fetch_space(
            project_id=project_id,
            space_id=id,
        )
        connection = (
            await self.channels_service.fetch_connection(
                project_id=project_id,
                connection_id=space.connection_id,
            )
            if space is not None
            else None
        )
        if space is None or connection is None or connection.channel != "agenta":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Channel space not found",
            )

        inbox = await self.channels_service.query_inbox_events(
            project_id=project_id,
            event=ChannelInboxEventQuery(space_id=id),
        )
        threads = await self.channels_service.query_threads(
            project_id=project_id,
            thread=ChannelThreadQuery(space_id=id),
        )

        outbox = []
        for thread in threads:
            outbox.extend(
                await self.channels_service.query_outbox_events(
                    project_id=project_id,
                    event=ChannelOutboxEventQuery(thread_id=thread.id),
                )
            )

        items: List[AgentaConversationItem] = [
            AgentaConversationItem(
                id=event.id,
                direction="inbound",
                created_at=event.created_at,
                content=event.data.processed.content,
            )
            for event in inbox
        ] + [
            AgentaConversationItem(
                id=event.id,
                direction="outbound",
                created_at=event.created_at,
                content=(event.data.processed or {}).get("content", []),
            )
            for event in outbox
        ]
        _epoch = datetime.min.replace(tzinfo=timezone.utc)
        items.sort(key=lambda item: (item.created_at or _epoch, item.id))

        return AgentaConversationResponse(count=len(items), items=items)
