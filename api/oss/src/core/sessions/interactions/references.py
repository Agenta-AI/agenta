from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.sessions.interactions.dtos import SessionInteraction
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.turns.dtos import SessionTurnQuery
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.core.sessions.types import SessionReference
from oss.src.core.shared.dtos import Windowing
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


_EXECUTION_REFERENCE_KEYS = frozenset(
    {
        "workflow",
        "workflow_variant",
        "workflow_revision",
        "application",
        "application_variant",
        "application_revision",
        "evaluator",
        "evaluator_variant",
        "evaluator_revision",
    }
)


def keyed_references(
    elements: Optional[List[SessionReference]],
) -> Optional[Dict[str, Any]]:
    if not elements:
        return None
    keyed: Dict[str, Any] = {}
    for element in elements:
        key = getattr(element, "key", None)
        if key not in _EXECUTION_REFERENCE_KEYS or key in keyed:
            continue
        reference = element.model_dump(mode="json", exclude_none=True)
        reference.pop("key", None)
        if reference:
            keyed[key] = reference
    return keyed or None


async def resolve_interaction_references(
    *,
    project_id: UUID,
    interaction: SessionInteraction,
    turns_service: Optional[SessionTurnsService] = None,
    streams_service: Optional[SessionStreamsService] = None,
) -> Optional[Dict[str, Any]]:
    data = interaction.data
    if data and data.references:
        return {
            key: reference.model_dump(mode="json")
            for key, reference in data.references.items()
        }

    if turns_service is not None:
        try:
            turns = await turns_service.query_turns(
                project_id=project_id,
                query=SessionTurnQuery(session_id=interaction.session_id),
                windowing=Windowing(limit=1),
            )
        except Exception as error:  # noqa: BLE001 - fallback reads are best effort
            log.warning(
                f"[interactions] turn references unavailable for "
                f"session={interaction.session_id}: {error}"
            )
            turns = []
        if turns:
            references = keyed_references(turns[0].references)
            if references:
                return references

    if streams_service is not None:
        try:
            stream = await streams_service.fetch_header(
                project_id=project_id,
                session_id=interaction.session_id,
            )
        except Exception as error:  # noqa: BLE001 - fallback reads are best effort
            log.warning(
                f"[interactions] stream references unavailable for "
                f"session={interaction.session_id}: {error}"
            )
            stream = None
        if stream is not None:
            return keyed_references(stream.references)

    return None
