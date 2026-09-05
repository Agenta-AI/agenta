from typing import Any, List, Optional
from uuid import NAMESPACE_DNS, UUID, uuid5

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
from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.shared.dtos import Windowing
from oss.src.dbs.redis.sessions.contract import (
    WATCH_INTERACTION_PENDING,
    WATCH_INTERACTION_RESOLVED,
)
from oss.src.core.sessions.watch.interfaces import SessionsWatchPublisherInterface


_RECORD_NAMESPACE = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "records")


class SessionInteractionsService:
    def __init__(
        self,
        *,
        interactions_dao: SessionInteractionsDAOInterface,
        watch_publisher: Optional[SessionsWatchPublisherInterface] = None,
        records_service: Optional[RecordsService] = None,
    ) -> None:
        self.interactions_dao = interactions_dao
        self._watch = watch_publisher
        self._records = records_service

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
        transaction: Optional[Any] = None,
        publish: bool = True,
        command_id: Optional[UUID] = None,
    ) -> int:
        cancelled = await self.interactions_dao.cancel_session_pending(
            project_id=project_id,
            session_id=session_id,
            except_turn_id=except_turn_id,
            except_tokens=except_tokens,
            only_turn_id=only_turn_id,
            transaction=transaction,
        )
        if cancelled and command_id is not None and self._records is not None:
            await self._records.append_many(
                events=[
                    SessionRecordEvent(
                        project_id=project_id,
                        session_id=interaction.session_id,
                        record_id=uuid5(
                            _RECORD_NAMESPACE,
                            f"{interaction.session_id}:{interaction.token}:"
                            f"interaction_response:{interaction.turn_id or ''}",
                        ),
                        record_type="interaction_response",
                        record_source="agent",
                        attributes={
                            "type": "interaction_response",
                            "id": interaction.token,
                            "kind": interaction.kind.value,
                            "payload": {
                                "outcome": "cancelled",
                                "turnId": interaction.turn_id,
                                "commandId": str(command_id),
                            },
                        },
                        turn_id=interaction.turn_id,
                    )
                    for interaction in cancelled
                ]
            )
        if cancelled and publish:
            await self.publish_session_pending_cancelled(
                project_id=project_id, session_id=session_id
            )
        return len(cancelled)

    async def publish_session_pending_cancelled(
        self, *, project_id: UUID, session_id: str
    ) -> None:
        await self._publish_interaction(
            project_id=project_id,
            session_id=session_id,
            status=WATCH_INTERACTION_RESOLVED,
        )

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
