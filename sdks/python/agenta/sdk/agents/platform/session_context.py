"""Per-turn session facts, read by the agent service from the Agenta backend.

The platform prompt tells the agent to rename itself only while its name is a placeholder,
and to name the session once at the start. Both rules need three facts the run does not
carry: the agent's display name, the session's name, and whether an earlier turn exists.

The API stamps those facts on ``request.meta`` for the runs it proxies. The playground does
not go through the API: it posts a turn straight to the agent service, so a service that
reads the facts off ``meta`` sees nothing on the path the browser uses. This module reads
them where every agent turn passes, in the service itself.

``meta`` is request body, and the service's ``/invoke`` is reachable by a browser, so a
``session_context`` on the wire is client input on this path. It is never read. A client must
not be able to tell the agent it is already named, which would suppress the naming rule.

Every read is best-effort. These facts shape prompt text only, so a backend that cannot
answer must degrade to the pre-#6638 prompt rather than fail the turn. ``None`` means UNKNOWN
per field, and the renderer says nothing about a fact it does not have.
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional, Tuple
from urllib.parse import quote

import httpx

from agenta.sdk.agents.dtos import SessionContext
from agenta.sdk.utils.logging import get_module_logger

from .connection import PlatformConnection

log = get_module_logger(__name__)


async def resolve_session_context(
    *,
    session_id: Optional[str],
    workflow_id: Optional[str] = None,
    connection: Optional[PlatformConnection] = None,
) -> Optional[SessionContext]:
    """Read the agent name, the session name, and the first-turn flag for one turn.

    Returns ``None`` when no fact could be read at all, so the caller leaves the prompt
    section out entirely. The two backend reads run concurrently: they are independent
    indexed single-row reads and the turn waits on both.
    """
    connection = connection or PlatformConnection()
    api_base = connection.base_url()
    if not api_base:
        return None

    headers = connection.headers()

    async with httpx.AsyncClient(timeout=connection.timeout) as client:
        agent_name, session_facts = await asyncio.gather(
            _read_agent_name(
                client,
                api_base=api_base,
                headers=headers,
                workflow_id=workflow_id,
            ),
            _read_session_facts(
                client,
                api_base=api_base,
                headers=headers,
                session_id=session_id,
            ),
        )

    session_name, first_turn = session_facts
    if agent_name is None and session_name is None and first_turn is None:
        return None
    return SessionContext(
        agent_name=agent_name,
        session_name=session_name,
        first_turn=first_turn,
    )


async def _read_agent_name(
    client: httpx.AsyncClient,
    *,
    api_base: str,
    headers: dict,
    workflow_id: Optional[str],
) -> Optional[str]:
    """The workflow artifact's display name. That is what ``rename_agent`` renames.

    ``rename_agent`` targets the artifact (``PUT /api/workflows/{workflow_id}`` bound to
    ``$ctx.workflow.artifact.id``), so the artifact's name is the agent's name, never the
    revision's. A draft run carries no artifact reference and has no name to report.
    """
    if not workflow_id:
        return None
    try:
        response = await client.get(
            f"{api_base}/workflows/{quote(str(workflow_id), safe='')}",
            headers=headers,
        )
        if response.status_code >= 400:
            log.warning("agent: workflow name read HTTP %s", response.status_code)
            return None
        workflow = _mapping(response.json()).get("workflow")
        name = _mapping(workflow).get("name")
        return name if isinstance(name, str) and name.strip() else None
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: workflow name read failed", exc_info=True)
        return None


async def _read_session_facts(
    client: httpx.AsyncClient,
    *,
    api_base: str,
    headers: dict,
    session_id: Optional[str],
) -> Tuple[Optional[str], Optional[bool]]:
    """The session's name and whether it has run a turn yet.

    A run with no session id opens a fresh session, so it is the first turn and the session
    has no name. That is a fact, not an unknown, and it needs no read.

    The name and the turn position are reported as a pair. If either read fails, both come
    back UNKNOWN: an unread name beside ``first_turn=False`` renders "This session has no
    name yet", which tells a named session to rename itself.

    A turn row is appended by the runner as the turn executes, so no row exists yet while
    the prelude of the FIRST turn runs. Counting the request's messages would be wrong
    rather than cheap, because a client may send only the latest message.
    """
    if session_id is None:
        return None, True
    try:
        stream_response, turns_response = await asyncio.gather(
            client.get(
                f"{api_base}/sessions/streams/",
                params={"session_id": session_id},
                headers=headers,
            ),
            client.post(
                f"{api_base}/sessions/turns/query",
                json={"query": {"session_id": session_id}, "windowing": {"limit": 1}},
                headers=headers,
            ),
        )
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: session facts read failed", exc_info=True)
        return None, None

    if stream_response.status_code >= 400 or turns_response.status_code >= 400:
        log.warning(
            "agent: session facts read HTTP stream=%s turns=%s",
            stream_response.status_code,
            turns_response.status_code,
        )
        return None, None

    try:
        stream = _mapping(_mapping(stream_response.json()).get("stream"))
        turns = _mapping(turns_response.json()).get("turns")
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: session facts decode failed", exc_info=True)
        return None, None

    name = stream.get("name")
    session_name = name if isinstance(name, str) and name.strip() else None
    first_turn = not turns if isinstance(turns, list) else None
    return session_name, first_turn


def _mapping(value: Any) -> dict:
    """The value as a dict, or an empty one. A backend shape we do not expect reads as absent."""
    return value if isinstance(value, dict) else {}
