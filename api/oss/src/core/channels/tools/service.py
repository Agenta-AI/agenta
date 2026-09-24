"""The channel agent tools: list, send, read, and search, on behalf of a
running agent.

The model never names a bot. Every call matches the run's workflow artifact
against the project's bot bindings, re-reads the connection and the bot's
settings, and only then touches a destination.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.channels.dtos import ChannelAgent, ChannelConnection
from oss.src.core.shared.dtos import Reference
from oss.src.core.channels.tools.types import ChannelToolsRefused
from oss.src.utils.logging import get_module_logger

if TYPE_CHECKING:
    from oss.src.core.channels.service import ChannelsService

log = get_module_logger(__name__)

_ARTIFACT_KEYS = ("application", "workflow")
_VARIANT_KEYS = ("application_variant", "workflow_variant")
_REVISION_KEYS = ("application_revision", "workflow_revision")


@dataclass(frozen=True)
class ChannelBot:
    """One bot the run speaks for: its binding and its live connection, with
    credentials resolved for the adapter. Never serialised."""

    agent: ChannelAgent
    connection: ChannelConnection


class ChannelToolsService:
    def __init__(
        self,
        *,
        channels_service: "ChannelsService",
        workflows_service: Optional[Any] = None,
        telegram_binding_service: Optional[Any] = None,
    ) -> None:
        self.channels_service = channels_service
        self.channels_dao = channels_service.channels_dao
        self.workflows_service = workflows_service
        self.telegram_binding_service = telegram_binding_service

    # --- which bots the run speaks for ------------------------------------ #

    async def resolve_bots(
        self, *, project_id: UUID, artifact_id: UUID
    ) -> List[ChannelBot]:
        """The run's bots: active bindings whose workflow is this artifact,
        on active, verified, unarchived connections. Two bindings on one
        connection would make the settings ambiguous, so that refuses."""

        agents = await self.channels_dao.query_agents(project_id=project_id)

        matched: Dict[UUID, List[ChannelAgent]] = {}
        for agent in agents:
            if agent.deleted_at is not None or not agent.flags.is_active:
                continue
            if await self._references_artifact(
                project_id=project_id,
                references=agent.data.references,
                artifact_id=artifact_id,
            ):
                matched.setdefault(agent.connection_id, []).append(agent)

        bots: List[ChannelBot] = []
        for connection_id, bound in matched.items():
            connection = await self.channels_service.fetch_connection(
                project_id=project_id, connection_id=connection_id
            )
            if (
                connection is None
                or connection.deleted_at is not None
                or not connection.flags.is_active
                or not connection.flags.is_verified
            ):
                continue
            if len(bound) > 1:
                raise ChannelToolsRefused(
                    "This agent is bound more than once to the same connected bot, "
                    "so its channel settings are ambiguous. Ask an admin to keep "
                    "one binding."
                )
            bots.append(ChannelBot(agent=bound[0], connection=connection))
        return bots

    async def is_available(self, *, project_id: UUID, artifact_id: UUID) -> bool:
        """The condition the Agenta tools kit reads: is this agent connected
        to an active, verified bot? An ambiguous binding still counts, so
        the calls surface the configuration error instead of hiding it."""

        try:
            return bool(
                await self.resolve_bots(project_id=project_id, artifact_id=artifact_id)
            )
        except ChannelToolsRefused:
            return True

    async def _references_artifact(
        self,
        *,
        project_id: UUID,
        references: Dict[str, Reference],
        artifact_id: UUID,
    ) -> bool:
        for key, reference in references.items():
            if (
                await self._artifact_of(
                    project_id=project_id, key=key, reference=reference
                )
                == artifact_id
            ):
                return True
        return False

    async def _artifact_of(
        self, *, project_id: UUID, key: str, reference: Reference
    ) -> Optional[UUID]:
        if key in _ARTIFACT_KEYS and reference.id is not None:
            return reference.id
        if self.workflows_service is None:
            return None
        try:
            if key in _ARTIFACT_KEYS:
                workflow = await self.workflows_service.fetch_workflow(
                    project_id=project_id, workflow_ref=reference
                )
                return workflow.id if workflow else None
            if key in _VARIANT_KEYS:
                variant = await self.workflows_service.fetch_workflow_variant(
                    project_id=project_id, workflow_variant_ref=reference
                )
                return variant.workflow_id if variant else None
            if key in _REVISION_KEYS:
                revision = await self.workflows_service.fetch_workflow_revision(
                    project_id=project_id, workflow_revision_ref=reference
                )
                return revision.workflow_id if revision else None
        except Exception:  # noqa: BLE001 - a stale reference matches nothing
            log.warning(
                "channel tools: could not resolve a %s reference", key, exc_info=True
            )
        return None
