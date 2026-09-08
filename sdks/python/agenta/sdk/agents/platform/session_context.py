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

Every read is best-effort and time-boxed. These facts shape prompt text only, so a backend
that cannot answer in the budget must degrade to the pre-#6638 prompt rather than delay or
fail the turn. ``None`` means UNKNOWN per field, and the renderer says nothing about a fact
it does not have.

A backend answer this module cannot parse is UNKNOWN, never a fact. The difference matters
for the session: an unnamed session and a session whose name could not be read render
opposite prompts, and only one of them is safe to guess at.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any, Optional, Tuple
from urllib.parse import quote

import httpx

from agenta.sdk.agents.dtos import SessionContext
from agenta.sdk.utils.logging import get_module_logger

from .connection import PlatformConnection

log = get_module_logger(__name__)

# The TOTAL wall-clock budget for resolving the facts, in seconds.
#
# Not the tool resolver's 30 s: that one budgets a round-trip the run cannot proceed without,
# and it is per-operation anyway, so a server that trickles bytes stays under every httpx
# timeout while the elapsed time grows without bound. These reads are optional. The turn is
# correct without them, so a slow backend must cost the user a prompt section, not a wait.
DEFAULT_SESSION_CONTEXT_TIMEOUT = 0.5


def session_context_timeout() -> float:
    """The total budget for one resolution. Override via AGENTA_AGENT_SESSION_CONTEXT_TIMEOUT."""
    raw = os.getenv("AGENTA_AGENT_SESSION_CONTEXT_TIMEOUT")
    if raw:
        try:
            parsed = float(raw)
        except ValueError:
            return DEFAULT_SESSION_CONTEXT_TIMEOUT
        if parsed > 0:
            return parsed
    return DEFAULT_SESSION_CONTEXT_TIMEOUT


async def resolve_session_context(
    *,
    session_id: Optional[str],
    workflow_id: Optional[str] = None,
    connection: Optional[PlatformConnection] = None,
    timeout: Optional[float] = None,
) -> Optional[SessionContext]:
    """Read the agent name, the session name, and the first-turn flag for one turn.

    Returns ``None`` when no fact could be read at all, so the caller leaves the prompt
    section out entirely. The backend reads run concurrently: they are independent indexed
    single-row reads and the turn waits on both.

    The whole operation shares one deadline, including client construction and teardown.
    When it expires the outstanding reads are cancelled and the turn goes on with no facts.
    A cancellation from OUTSIDE is not swallowed: the caller is going away, so this optional
    work must go with it rather than absorb the cancel and keep running.
    """
    budget = timeout if timeout is not None else session_context_timeout()
    try:
        return await asyncio.wait_for(
            _resolve(
                session_id=session_id,
                workflow_id=workflow_id,
                connection=connection,
                budget=budget,
            ),
            timeout=budget,
        )
    except asyncio.TimeoutError:
        log.warning("agent: session context timed out after %.3fs", budget)
        return None
    except asyncio.CancelledError:
        raise
    except Exception:  # pylint: disable=broad-except
        # Client construction and teardown live in here too, not only the reads. A resolver
        # that raises on the way in must still cost only the prompt section.
        log.warning("agent: session context unavailable", exc_info=True)
        return None


async def _resolve(
    *,
    session_id: Optional[str],
    workflow_id: Optional[str],
    connection: Optional[PlatformConnection],
    budget: float,
) -> Optional[SessionContext]:
    """The reads themselves. Every failure path above this returns no facts."""
    connection = connection or PlatformConnection()
    api_base = connection.base_url()
    if not api_base:
        return None

    headers = connection.headers()

    # The per-operation timeout is capped by the same budget, so no single read can outlive
    # the whole operation even before `wait_for` fires.
    async with httpx.AsyncClient(timeout=budget) as client:
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

    Every failure here reads the same as an absent name, and an absent name renders no line
    at all. There is no unsafe guess to make, unlike the session pair below.
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
        body = response.json()
    except asyncio.CancelledError:
        raise
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: workflow name read failed", exc_info=True)
        return None

    if not isinstance(body, dict):
        log.warning("agent: workflow name read returned a non-object body")
        return None
    workflow = body.get("workflow")
    if workflow is None:
        return None
    if not isinstance(workflow, dict):
        log.warning("agent: workflow name read returned a malformed workflow")
        return None
    return _display_name(workflow.get("name"))


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

    The name and the turn position are reported as ONE pair. If either read fails, or either
    body is a shape this code cannot trust, both come back UNKNOWN. A half-read pair is worse
    than no pair: an unread name beside ``first_turn=False`` renders "This session has no
    name yet. Name it with rename_session", which tells an already-named session to rename
    itself, and that is the exact bug this module exists to fix.

    A turn row is appended by the runner as the turn executes, so no row exists yet while
    the prelude of the FIRST turn runs. Counting the request's messages would be wrong
    rather than cheap, because a client may send only the latest message.
    """
    if session_id is None:
        return None, True
    unknown: Tuple[Optional[str], Optional[bool]] = (None, None)
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
    except asyncio.CancelledError:
        raise
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: session facts read failed", exc_info=True)
        return unknown

    if stream_response.status_code >= 400 or turns_response.status_code >= 400:
        log.warning(
            "agent: session facts read HTTP stream=%s turns=%s",
            stream_response.status_code,
            turns_response.status_code,
        )
        return unknown

    try:
        stream_body = stream_response.json()
        turns_body = turns_response.json()
    except asyncio.CancelledError:
        raise
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: session facts decode failed", exc_info=True)
        return unknown

    session_name = _session_name(stream_body)
    first_turn = _first_turn(turns_body)
    if session_name is _MALFORMED or first_turn is _MALFORMED:
        log.warning("agent: session facts arrived in an unexpected shape")
        return unknown
    return session_name, first_turn


class _Malformed:
    """A body this code cannot trust. Distinct from a fact that is legitimately absent."""

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "<malformed>"


_MALFORMED = _Malformed()


def _session_name(body: Any) -> Any:
    """The session's name, ``None`` for an unnamed session, ``_MALFORMED`` for a bad body.

    An absent or null ``stream`` is legitimate: the response model omits null fields, and a
    session with no row yet has no name. An absent or null ``name`` is the unnamed session,
    which is the whole point of the first-turn prompt. Anything else is a shape this code
    did not expect, and guessing "unnamed" from it would tell a named session to rename.
    """
    if not isinstance(body, dict):
        return _MALFORMED
    stream = body.get("stream")
    if stream is None:
        return None
    if not isinstance(stream, dict):
        return _MALFORMED
    name = stream.get("name")
    if name is None:
        return None
    if not isinstance(name, str):
        return _MALFORMED
    return _display_name(name)


def _first_turn(body: Any) -> Any:
    """Whether the session has no turn row yet, or ``_MALFORMED`` for a bad body.

    ``turns`` must be a list. An absent or null one is not "no turns": the query always
    answers with the list it matched, so its absence means this is not the answer this code
    knows how to read.
    """
    if not isinstance(body, dict):
        return _MALFORMED
    turns = body.get("turns")
    if not isinstance(turns, list):
        return _MALFORMED
    return not turns


def _display_name(value: Any) -> Optional[str]:
    """A name worth showing, or ``None``. A cleared title is stored as an empty string."""
    return value if isinstance(value, str) and value.strip() else None
