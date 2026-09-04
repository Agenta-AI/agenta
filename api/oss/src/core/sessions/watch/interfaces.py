from typing import Any, Dict, List, Optional, Protocol, runtime_checkable


@runtime_checkable
class SessionsWatchPublisherInterface(Protocol):
    """What a core session service needs from the watch relay, and nothing more.

    The services publish change notifications; how those reach a client is a delivery concern.
    Typing them against the concrete Redis publisher inverted the dependency — core would import
    `dbs.redis` — which `api/AGENTS.md` forbids and which makes an alternate publisher (a no-op in
    tests, a different transport) impossible to wire without dragging DB code along.

    Construction stays in `api/entrypoints/*`, as it already did.
    """

    async def records_changed(self, *, project_id: str, session_id: str) -> None:
        """New or updated rows landed in a session's record log."""
        ...

    async def lifecycle(self, *, project_id: str, session_id: str, state: str) -> None:
        """A turn started or ended (`running` | `ended`)."""
        ...

    async def interaction(
        self,
        *,
        project_id: str,
        session_id: str,
        status: str,
        interactions: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """A gate changed, optionally carrying the committed row state."""
        ...

    async def changed(self, *, project_id: str, entity: str, id: str) -> None:
        """A project-scoped entity changed."""
        ...
