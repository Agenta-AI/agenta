from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger

from oss.src.apis.fastapi.interactions.models import (
    InteractionCreateRequest,
    InteractionQueryRequest,
    InteractionRespondRequest,
    InteractionResponse,
    InteractionsResponse,
    InteractionTransitionRequest,
)
from oss.src.core.interactions.service import InteractionsService
from oss.src.core.interactions.types import InteractionNotFound
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequest,
    WorkflowServiceRequestData,
)
from oss.src.core.workflows.service import WorkflowsService

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class InteractionsRouter:
    def __init__(
        self,
        *,
        interactions_service: InteractionsService,
        workflows_service: WorkflowsService,
    ) -> None:
        self.interactions_service = interactions_service
        self.workflows_service = workflows_service

        self.router = APIRouter()
        self.admin_router = APIRouter()

        # --- user-facing read tier ---
        self.router.add_api_route(
            "/query",
            self.query_interactions,
            methods=["POST"],
            operation_id="query_interactions",
        )
        self.router.add_api_route(
            "/{interaction_id}",
            self.fetch_interaction,
            methods=["GET"],
            operation_id="fetch_interaction",
        )
        self.router.add_api_route(
            "/{interaction_id}/respond",
            self.respond_interaction,
            methods=["POST"],
            operation_id="respond_interaction",
        )

        # --- admin (runner-only) write tier ---
        self.admin_router.add_api_route(
            "/",
            self.create_interaction,
            methods=["POST"],
            operation_id="admin_create_interaction",
        )
        self.admin_router.add_api_route(
            "/transition",
            self.transition_interaction,
            methods=["POST"],
            operation_id="admin_transition_interaction",
        )

    @intercept_exceptions()
    async def create_interaction(
        self,
        request: Request,
        body: InteractionCreateRequest,
    ) -> InteractionResponse:
        if not getattr(request.state, "admin", False):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

        interaction = await self.interactions_service.create_interaction(
            project_id=body.interaction.project_id,
            interaction=body.interaction,
        )
        return InteractionResponse(count=1, interaction=interaction)

    @intercept_exceptions()
    async def transition_interaction(
        self,
        request: Request,
        body: InteractionTransitionRequest,
    ) -> InteractionResponse:
        if not getattr(request.state, "admin", False):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

        try:
            interaction = await self.interactions_service.transition_interaction(
                transition=body.transition,
            )
        except InteractionNotFound:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interaction not found or already terminal",
            )
        return InteractionResponse(count=1, interaction=interaction)

    @intercept_exceptions()
    async def query_interactions(
        self,
        request: Request,
        body: InteractionQueryRequest,
    ) -> InteractionsResponse:
        project_id: UUID = request.state.project_id

        authorized = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        )
        if not authorized:
            raise FORBIDDEN_EXCEPTION

        interactions = await self.interactions_service.query_interactions(
            project_id=project_id,
            query=body.query,
            windowing=body.windowing,
        )
        return InteractionsResponse(count=len(interactions), interactions=interactions)

    @intercept_exceptions()
    async def fetch_interaction(
        self,
        request: Request,
        interaction_id: UUID,
    ) -> InteractionResponse:
        project_id: UUID = request.state.project_id

        authorized = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        )
        if not authorized:
            raise FORBIDDEN_EXCEPTION

        try:
            interaction = await self.interactions_service.fetch_interaction(
                project_id=project_id,
                interaction_id=interaction_id,
            )
        except InteractionNotFound:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interaction not found",
            )
        return InteractionResponse(count=1, interaction=interaction)

    @intercept_exceptions()
    async def respond_interaction(
        self,
        request: Request,
        interaction_id: UUID,
        body: InteractionRespondRequest,
    ) -> InteractionResponse:
        project_id: UUID = request.state.project_id
        user_id: UUID = request.state.user_id

        authorized = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not authorized:
            raise FORBIDDEN_EXCEPTION

        try:
            interaction = await self.interactions_service.fetch_interaction(
                project_id=project_id,
                interaction_id=interaction_id,
            )
        except InteractionNotFound:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interaction not found",
            )

        if interaction.status and interaction.status.code != "pending":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Interaction is no longer pending",
            )

        references = (
            {
                k: v.model_dump(mode="json")
                for k, v in interaction.data.references.items()
            }
            if interaction.data and interaction.data.references
            else None
        )
        selector = (
            interaction.data.selector.model_dump(mode="json")
            if interaction.data and interaction.data.selector
            else None
        )
        answer = body.answer or {}

        invoke_request = WorkflowServiceRequest(
            references=references,
            selector=selector,
            data=WorkflowServiceRequestData(inputs=answer),
        )

        await self.workflows_service.invoke_workflow(
            project_id=project_id,
            user_id=user_id,
            request=invoke_request,
        )

        return InteractionResponse(count=1, interaction=interaction)
