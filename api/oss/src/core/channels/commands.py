"""Command grammar and dispatch: `!command[:arg]`, parsed from inbound
content using the channel-declared command sigil (never hardcoded), and
routed onto the existing session/thread machinery. No new persistence:
commands read and write through `ChannelsService` only.
"""

import re
from typing import List, Optional, Union
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelThread,
    ChannelThreadQuery,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelThreadNotFound
from oss.src.core.sessions.streams.dtos import (
    SessionStreamCommandRequest,
    SessionStreamCommandResponse,
)
from oss.src.core.sessions.streams.service import SessionStreamsService

# The grammar's fixed vocabulary. Whether a given channel actually offers one
# of these is a runtime fact (`capabilities.commands`), never assumed here.
COMMAND_NEW = "new"
COMMAND_STOP = "stop"
COMMAND_SESSIONS = "sessions"
COMMAND_USE = "use"


class ParsedCommand(BaseModel):
    """One `!command[:arg]` token found in a message's content."""

    command: str
    arg: Optional[str] = None


class CommandNotOffered(Exception):
    """The channel's capability declaration does not offer this command —
    either no command sigil at all, or `commands` omits it."""

    def __init__(self, *, command: str):
        self.command = command
        super().__init__(f"Command not offered: {command}")


class CommandArgumentInvalid(Exception):
    """`!use` was parsed but its argument is not a well-formed thread id."""

    def __init__(self, *, command: str, arg: Optional[str]):
        self.command = command
        self.arg = arg
        super().__init__(f"Invalid argument for {command}: {arg!r}")


def parse_command(
    *,
    content: List[dict],
    capabilities: ChannelCapabilities,
) -> Optional[ParsedCommand]:
    """The first `{sigil}{command}[:{arg}]` token across this message's text
    parts, or None.

    The sigil comes from `capabilities.addressing.sigils.command` — a channel
    declaring none offers no commands, so no sigil means no match, never a
    hardcoded `!`. A colon splits the command word from its argument; with no
    colon there is no argument, and anything else on the line (a space, then
    trailing words) is message content the agent still receives, not part of
    the grammar. Only commands the channel declares in `capabilities.commands`
    are ever returned — an undeclared command name is not parsed as one.
    """

    sigil = capabilities.addressing.sigils.command
    if not sigil:
        return None

    pattern = re.compile(re.escape(sigil) + r"([A-Za-z0-9_-]+)(?::(\S+))?")

    for part in content:
        if not isinstance(part, dict) or part.get("type") != "text":
            continue

        match = pattern.search(part.get("text") or "")
        if not match:
            continue

        command = match.group(1)
        if command not in capabilities.commands:
            continue

        return ParsedCommand(command=command, arg=match.group(2))

    return None


async def dispatch_sessions(
    *,
    channels_service: ChannelsService,
    project_id: UUID,
    thread: ChannelThread,
) -> List[ChannelThread]:
    """`!sessions` — this thread's own history only: scoped to the
    `(space, external_key, agent)` key that already identifies the current
    thread, never the project's or the user's sessions elsewhere.
    """

    return await channels_service.query_threads(
        project_id=project_id,
        thread=ChannelThreadQuery(
            space_id=thread.space_id,
            agent_id=thread.agent_id,
            external_key=thread.external_key,
        ),
    )


async def dispatch_new(
    *,
    channels_service: ChannelsService,
    project_id: UUID,
    user_id: UUID,
    thread: ChannelThread,
) -> ChannelThread:
    """`!new` — closes the current thread row so the next resolution opens a
    fresh one; the table is append-only and the latest row wins, so there is no
    dedicated "new thread" DAO method. Closing is the whole effect: a turn
    already in flight holds its own `Resolution.thread` and is unaffected, so it
    finishes and posts against the now-previous session.
    """

    return await channels_service.close_thread(
        project_id=project_id,
        user_id=user_id,
        thread_id=thread.id,
    )


async def dispatch_stop(
    *,
    streams_service: SessionStreamsService,
    project_id: UUID,
    user_id: UUID,
    thread: ChannelThread,
) -> SessionStreamCommandResponse:
    """`!stop` — the runtime's existing cancel entry point, no new
    cancellation mechanism. `SessionStreamCommandRequest` with no `data` and
    `force=False` resolves to `CommandMode.cancel` inside
    `SessionStreamsService.command()`; that mode selection lives there, not
    here — this call adds no branching of its own.
    """

    return await streams_service.command(
        project_id=project_id,
        user_id=user_id,
        request=SessionStreamCommandRequest(session_id=thread.session_id),
    )


async def resolve_use_target(
    *,
    channels_service: ChannelsService,
    project_id: UUID,
    thread: ChannelThread,
    target_thread_id: UUID,
) -> ChannelThread:
    """`!use:<id>` — validates `<id>` against this thread's own history: the
    candidate list is exactly `!sessions`'s own scoping, so an id
    outside it is refused rather than silently ignored.

    Returns the validated target row. Switching the thread to point at it has
    no counterpart on `ChannelsService`, which exposes only `query_threads` and
    `close_thread` for threads — no method creates a thread row pointing at
    another session's `session_id`. That half of `!use` is unimplemented.
    """

    candidates = await dispatch_sessions(
        channels_service=channels_service,
        project_id=project_id,
        thread=thread,
    )

    target = next((t for t in candidates if t.id == target_thread_id), None)
    if target is None:
        raise ChannelThreadNotFound(thread_id=target_thread_id)

    return target


DispatchResult = Union[List[ChannelThread], ChannelThread, SessionStreamCommandResponse]


async def dispatch_command(
    *,
    channels_service: ChannelsService,
    streams_service: SessionStreamsService,
    project_id: UUID,
    user_id: UUID,
    thread: ChannelThread,
    capabilities: ChannelCapabilities,
    parsed: ParsedCommand,
) -> DispatchResult:
    """Routes an already-parsed command to its handler.

    Takes a `ParsedCommand` rather than raw content so a native-command
    surface (`addressing.commands.in_conversation`) and the text-parsed path
    reach this identically once translated to the same internal shape — this
    function does not care which surface produced the event, and does not
    branch on origin.

    Raises `CommandNotOffered` if the channel's capability declaration omits
    this command from `commands` — checked here again (in addition to
    `parse_command` already filtering on it) so a caller that constructs a
    `ParsedCommand` directly, e.g. from a native alias, gets the same gate.
    """

    if parsed.command not in capabilities.commands:
        raise CommandNotOffered(command=parsed.command)

    if parsed.command == COMMAND_SESSIONS:
        return await dispatch_sessions(
            channels_service=channels_service,
            project_id=project_id,
            thread=thread,
        )

    if parsed.command == COMMAND_NEW:
        return await dispatch_new(
            channels_service=channels_service,
            project_id=project_id,
            user_id=user_id,
            thread=thread,
        )

    if parsed.command == COMMAND_STOP:
        return await dispatch_stop(
            streams_service=streams_service,
            project_id=project_id,
            user_id=user_id,
            thread=thread,
        )

    if parsed.command == COMMAND_USE:
        try:
            target_thread_id = UUID(parsed.arg) if parsed.arg else None
        except ValueError:
            target_thread_id = None
        if target_thread_id is None:
            raise CommandArgumentInvalid(command=parsed.command, arg=parsed.arg)

        return await resolve_use_target(
            channels_service=channels_service,
            project_id=project_id,
            thread=thread,
            target_thread_id=target_thread_id,
        )

    raise CommandNotOffered(command=parsed.command)
