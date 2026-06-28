from typing import Any, Callable, Optional
from uuid import UUID

from oss.src.core.sessions.interactions.dtos import InteractionData
from oss.src.core.sessions.interactions.service import InteractionsService
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequest,
    WorkflowServiceRequestData,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


class InteractionsDispatcher:
    """Respond-via-invoke logic. When dispatch_fn is supplied, fires detached (no blocking await)."""

    def __init__(
        self,
        *,
        workflows_service: WorkflowsService,
        interactions_service: InteractionsService,
        dispatch_fn: Optional[Callable] = None,
    ) -> None:
        self.workflows_service = workflows_service
        self.interactions_service = interactions_service
        self._dispatch_fn = dispatch_fn

    async def respond(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        interaction_id: UUID,
        answer: Any,
    ) -> None:
        interaction = await self.interactions_service.fetch_interaction(
            project_id=project_id,
            interaction_id=interaction_id,
        )

        data: Optional[InteractionData] = interaction.data
        references = (
            {k: v.model_dump(mode="json") for k, v in data.references.items()}
            if data and data.references
            else None
        )
        selector = (
            data.selector.model_dump(mode="json") if data and data.selector else None
        )
        inputs = answer if isinstance(answer, dict) else {"value": answer}

        invoke_request = WorkflowServiceRequest(
            references=references,
            selector=selector,
            data=WorkflowServiceRequestData(inputs=inputs),
        )

        if self._dispatch_fn is not None:
            # Detached path: hand off to the runner, return immediately.
            await self._dispatch_fn(
                project_id=project_id,
                user_id=user_id,
                request=invoke_request,
            )
            return

        await self.workflows_service.invoke_workflow(
            project_id=project_id,
            user_id=user_id,
            request=invoke_request,
        )
