from typing import List, Optional
from uuid import UUID

from oss.src.core.sessions.interactions.dtos import (
    SessionInteraction,
    SessionInteractionCreate,
    SessionInteractionQuery,
    SessionInteractionTransition,
)
from oss.src.core.sessions.interactions.interfaces import (
    SessionInteractionsDAOInterface,
)
from oss.src.core.sessions.interactions.types import InteractionNotFound
from oss.src.core.shared.dtos import Windowing


class SessionInteractionsService:
    def __init__(self, *, interactions_dao: SessionInteractionsDAOInterface) -> None:
        self.interactions_dao = interactions_dao

    async def create_interaction(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        interaction: SessionInteractionCreate,
    ) -> SessionInteraction:
        return await self.interactions_dao.create_interaction(
            project_id=project_id,
            user_id=user_id,
            interaction=interaction,
        )

    async def fetch_interaction(
        self,
        *,
        project_id: UUID,
        #
        interaction_id: UUID,
    ) -> SessionInteraction:
        result = await self.interactions_dao.fetch_interaction(
            project_id=project_id,
            interaction_id=interaction_id,
        )
        if result is None:
            raise InteractionNotFound(f"Interaction {interaction_id} not found")
        return result

    async def transition_interaction(
        self,
        *,
        transition: SessionInteractionTransition,
    ) -> Optional[SessionInteraction]:
        result = await self.interactions_dao.transition_interaction(
            transition=transition,
        )
        if result is None:
            raise InteractionNotFound(
                f"Interaction with token {transition.token!r} not found or already terminal"
            )
        return result

    async def query_interactions(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[SessionInteractionQuery] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[SessionInteraction]:
        return await self.interactions_dao.query_interactions(
            project_id=project_id,
            query=query,
            windowing=windowing,
        )
