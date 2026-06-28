from typing import Any, Optional
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


class InteractionsWorker:
    """First impl: respond-via-invoke. Becomes detached-invoke consumer when runner-scalability lands."""

    def __init__(
        self,
        *,
        workflows_service: WorkflowsService,
        interactions_service: InteractionsService,
    ) -> None:
        self.workflows_service = workflows_service
        self.interactions_service = interactions_service

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

        await self.workflows_service.invoke_workflow(
            project_id=project_id,
            user_id=user_id,
            request=invoke_request,
        )
