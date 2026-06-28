from abc import ABC, abstractmethod
from typing import List, Optional
from uuid import UUID

from oss.src.core.sessions.interactions.dtos import (
    Interaction,
    InteractionCreate,
    InteractionQuery,
    InteractionTransition,
)
from oss.src.core.shared.dtos import Windowing


class InteractionsDAOInterface(ABC):
    @abstractmethod
    async def create_interaction(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        interaction: InteractionCreate,
    ) -> Interaction: ...

    @abstractmethod
    async def fetch_interaction(
        self,
        *,
        project_id: UUID,
        #
        interaction_id: UUID,
    ) -> Optional[Interaction]: ...

    @abstractmethod
    async def transition_interaction(
        self,
        *,
        transition: InteractionTransition,
    ) -> Optional[Interaction]: ...

    @abstractmethod
    async def query_interactions(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[InteractionQuery] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[Interaction]: ...
