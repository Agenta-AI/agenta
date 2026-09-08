"""The per-turn session facts the platform prompt renders.

The agent is told to rename itself only while its name is a placeholder, and to name the session
once at the start. Both rules need facts the run did not carry: the session's name, and whether
any earlier turn exists. This module reads those two, and `WorkflowsService._stamp_session_context`
puts them on `request.meta` beside the agent's own name.

It is a free function over the two sessions services rather than a method on either, because it
spans both and belongs to neither. `WorkflowsService` takes it as an injected callable, the same
way it takes the continuation resumer.

This serves only the runs the API proxies. A playground turn posts straight to the agent service
and never reaches this code (issue #6661), and the current agent service resolves the same facts
for itself over HTTP in `agenta.sdk.agents.platform.session_context`. See
`WorkflowsService._stamp_session_context` for why both exist.
"""

from typing import Awaitable, Callable, Optional, Tuple
from uuid import UUID

from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.turns.service import SessionTurnsService


SessionContextResolver = Callable[..., Awaitable[Tuple[Optional[str], bool]]]


def make_session_context_resolver(
    *,
    streams_service: SessionStreamsService,
    turns_service: SessionTurnsService,
) -> SessionContextResolver:
    """Build the resolver: it returns ``(session_name, first_turn)`` for one session."""

    async def resolve(
        *,
        project_id: UUID,
        session_id: str,
    ) -> Tuple[Optional[str], bool]:
        """Read the session's name and whether it has run a turn yet.

        Two indexed single-row reads per agent turn. `latest_turn` is the existing resume-read,
        and it is the right first-turn signal: a turn row is appended by the runner as the turn
        executes, so no row exists yet when the prelude of the FIRST turn runs. Counting the
        request's messages would be wrong instead of cheap, because a client may send only the
        latest message rather than the whole transcript.

        A session with no row yet (a trigger fire mints a fresh id) reads as unnamed and first,
        which is exactly right.
        """
        stream = await streams_service.fetch_header(
            project_id=project_id,
            session_id=session_id,
        )
        turn = await turns_service.latest_turn(
            project_id=project_id,
            session_id=session_id,
        )
        return (stream.name if stream else None), turn is None

    return resolve
