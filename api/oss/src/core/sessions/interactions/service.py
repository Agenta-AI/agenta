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
from oss.src.dbs.redis.sessions.contract import (
    WATCH_INTERACTION_PENDING,
    WATCH_INTERACTION_RESOLVED,
)
from oss.src.core.sessions.watch.interfaces import SessionsWatchPublisherInterface


class SessionInteractionsService:
    def __init__(
        self,
        *,
        interactions_dao: SessionInteractionsDAOInterface,
        watch_publisher: Optional[SessionsWatchPublisherInterface] = None,
    ) -> None:
        self.interactions_dao = interactions_dao
        self._watch = watch_publisher

    async def _publish_interaction(
        self, *, project_id: UUID, session_id: str, status: str
    ) -> None:
        # Fire-and-forget relay notification; the publisher never raises.
        if self._watch is not None:
            await self._watch.interaction(
                project_id=str(project_id),
                session_id=session_id,
                status=status,
            )

    async def create_interaction(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        interaction: SessionInteractionCreate,
    ) -> SessionInteraction:
        created = await self.interactions_dao.create_interaction(
            project_id=project_id,
            user_id=user_id,
            interaction=interaction,
        )
        await self._publish_interaction(
            project_id=project_id,
            session_id=interaction.session_id,
            status=WATCH_INTERACTION_PENDING,
        )
        return created

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
        await self._publish_interaction(
            project_id=transition.project_id,
            session_id=transition.session_id,
            status=WATCH_INTERACTION_RESOLVED,
        )
        return result

    async def cancel_session_pending(
        self,
        *,
        project_id: UUID,
        session_id: str,
        except_turn_id: Optional[str] = None,
        except_tokens: Optional[List[str]] = None,
        only_turn_id: Optional[str] = None,
    ) -> int:
        cancelled = await self.interactions_dao.cancel_session_pending(
            project_id=project_id,
            session_id=session_id,
            except_turn_id=except_turn_id,
            except_tokens=except_tokens,
            only_turn_id=only_turn_id,
        )
        if cancelled:
            await self._publish_interaction(
                project_id=project_id,
                session_id=session_id,
                status=WATCH_INTERACTION_RESOLVED,
            )
        return cancelled

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

    async def delete_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> int:
        """Hard delete every interaction for a session (S7 delete fan-out, WP5)."""
        return await self.interactions_dao.delete_by_session_id(
            project_id=project_id,
            session_id=session_id,
        )
