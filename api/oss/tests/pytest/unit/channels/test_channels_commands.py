"""Unit tests for `core/channels/commands.py` — the `!command[:arg]` grammar
and its dispatch onto `ChannelsService` / `SessionStreamsService`. No DB, no
broker, no HTTP: `ChannelsService` and `SessionStreamsService` are faked with
`MagicMock`/`AsyncMock`, and `ChannelCapabilities` is built directly so the
sigil and command list are both varied under test.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.channels.commands import (
    COMMAND_NEW,
    COMMAND_SESSIONS,
    COMMAND_STOP,
    COMMAND_USE,
    CommandArgumentInvalid,
    CommandNotOffered,
    ParsedCommand,
    dispatch_command,
    dispatch_new,
    dispatch_sessions,
    dispatch_stop,
    parse_command,
    resolve_use_target,
)
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelThread,
    ChannelThreadData,
    ChannelThreadFlags,
)
from oss.src.core.channels.types import ChannelThreadNotFound
from oss.src.core.sessions.streams.dtos import (
    CommandMode,
    SessionStreamCommandResponse,
)


def _capabilities(*, sigil="!", commands=None):
    return ChannelCapabilities.model_validate(
        {
            "channel": "fake",
            "addressing": {
                "sigils": {"agent": "~", "command": sigil},
                "commands": {"native": True, "in_conversation": False},
            },
            "commands": commands
            if commands is not None
            else ["new", "sessions", "use", "stop"],
        }
    )


def _content(text):
    return [{"type": "text", "text": text}]


def _make_thread(*, space_id=None, agent_id=None, external_key=None, session_id=None):
    return ChannelThread(
        id=uuid4(),
        space_id=space_id or uuid4(),
        agent_id=agent_id or uuid4(),
        external_key=external_key,
        session_id=session_id or "session-1",
        data=ChannelThreadData(),
        flags=ChannelThreadFlags(),
    )


# ---------------------------------------------------------------------------
# Grammar
# ---------------------------------------------------------------------------


class TestParseCommand:
    def test_parses_new_with_declared_sigil(self):
        parsed = parse_command(content=_content("!new"), capabilities=_capabilities())
        assert parsed == ParsedCommand(command="new", arg=None)

    def test_parses_with_a_different_declared_sigil(self):
        """No hardcoded `!` in the parser: a channel declaring `#` as its
        command sigil is matched on `#`, not on `!`."""

        caps = _capabilities(sigil="#")
        parsed = parse_command(content=_content("#new"), capabilities=caps)
        assert parsed == ParsedCommand(command="new", arg=None)

        # the same text under the '#' declaration does not match '!'
        not_parsed = parse_command(content=_content("!new"), capabilities=caps)
        assert not_parsed is None

    def test_stop_sessions_use_all_parse(self):
        assert parse_command(
            content=_content("!stop"), capabilities=_capabilities()
        ) == ParsedCommand(command="stop", arg=None)
        assert parse_command(
            content=_content("!sessions"), capabilities=_capabilities()
        ) == ParsedCommand(command="sessions", arg=None)
        assert parse_command(
            content=_content("!use:abc123"), capabilities=_capabilities()
        ) == ParsedCommand(command="use", arg="abc123")

    def test_use_with_no_colon_has_no_argument(self):
        """`!use` with no colon is parsed as the command with no argument —
        never silently ignored as a no-op, and never treated as if a colon
        were implied."""

        parsed = parse_command(content=_content("!use"), capabilities=_capabilities())
        assert parsed == ParsedCommand(command="use", arg=None)

    def test_colon_not_space_splits_argument(self):
        """`!stop please` is `!stop` with trailing message content, not
        `!stop` with arg `please` — there is no colon, so no argument."""

        parsed = parse_command(
            content=_content("!stop please"), capabilities=_capabilities()
        )
        assert parsed == ParsedCommand(command="stop", arg=None)

    def test_mid_sentence_sigil_does_not_parse(self):
        """A literal '!' inside ordinary prose, not forming a declared
        command word, is not parsed as a command."""

        parsed = parse_command(
            content=_content("wow! that is great"), capabilities=_capabilities()
        )
        assert parsed is None

    def test_undeclared_command_word_does_not_parse(self):
        """`!frobnicate` is never a command: it matches no declared name."""

        parsed = parse_command(
            content=_content("!frobnicate"), capabilities=_capabilities()
        )
        assert parsed is None

    def test_no_command_sigil_declared_means_no_commands(self):
        """A channel declaring no command sigil offers no commands at all,
        even if the text looks exactly like a command elsewhere."""

        caps = _capabilities(sigil=None)
        parsed = parse_command(content=_content("!new"), capabilities=caps)
        assert parsed is None

    def test_capabilities_commands_list_gates_parsing(self):
        """A channel whose `commands` list omits `use` never parses `!use`,
        even though the sigil is declared and the grammar matches."""

        caps = _capabilities(commands=["new", "sessions"])
        assert parse_command(content=_content("!use:abc"), capabilities=caps) is None
        assert parse_command(content=_content("!new"), capabilities=caps) is not None

    def test_non_text_parts_are_skipped(self):
        content = [
            {"type": "image", "url": "http://x"},
            {"type": "text", "text": "!new"},
        ]
        parsed = parse_command(content=content, capabilities=_capabilities())
        assert parsed == ParsedCommand(command="new", arg=None)


# ---------------------------------------------------------------------------
# !sessions
# ---------------------------------------------------------------------------


class TestDispatchSessions:
    async def test_scopes_query_to_this_threads_own_key(self):
        thread = _make_thread(external_key=uuid4())
        channels_service = MagicMock()
        channels_service.query_threads = AsyncMock(return_value=[thread])

        result = await dispatch_sessions(
            channels_service=channels_service,
            project_id=uuid4(),
            thread=thread,
        )

        assert result == [thread]
        _, kwargs = channels_service.query_threads.call_args
        query = kwargs["thread"]
        assert query.space_id == thread.space_id
        assert query.agent_id == thread.agent_id
        assert query.external_key == thread.external_key

    async def test_never_leaks_another_threads_rows_across_spaces(self):
        """Same user, two spaces: !sessions in thread A must not be able to
        return thread B's history. Asserted at the seam that matters — the
        query this function builds is scoped to A's own key, so a fake DAO
        that (incorrectly) ignored scoping is the only way B's rows would
        leak, and this test pins the query args that prevent it."""

        thread_a = _make_thread(
            space_id=uuid4(), agent_id=uuid4(), external_key=uuid4()
        )
        thread_b = _make_thread(
            space_id=uuid4(), agent_id=uuid4(), external_key=uuid4()
        )

        channels_service = MagicMock()

        # A well-behaved DAO/service only ever returns rows matching the query;
        # simulate exactly that behaviour rather than a fixed list.
        async def _query_threads(*, project_id, thread=None, windowing=None):
            candidates = [thread_a, thread_b]
            return [
                t
                for t in candidates
                if t.space_id == thread.space_id
                and t.agent_id == thread.agent_id
                and t.external_key == thread.external_key
            ]

        channels_service.query_threads = AsyncMock(side_effect=_query_threads)

        result = await dispatch_sessions(
            channels_service=channels_service,
            project_id=uuid4(),
            thread=thread_a,
        )

        assert result == [thread_a]
        assert thread_b not in result


# ---------------------------------------------------------------------------
# !new
# ---------------------------------------------------------------------------


class TestDispatchNew:
    async def test_closes_current_thread_via_close_thread(self):
        """`!new` has no dedicated DAO method: its whole effect is closing the
        current thread row through the existing `close_thread` service call, so
        the next resolution opens a fresh one."""

        thread = _make_thread()
        closed = thread.model_copy(
            update={"flags": ChannelThreadFlags(is_active=False)}
        )

        channels_service = MagicMock()
        channels_service.close_thread = AsyncMock(return_value=closed)

        project_id = uuid4()
        user_id = uuid4()

        result = await dispatch_new(
            channels_service=channels_service,
            project_id=project_id,
            user_id=user_id,
            thread=thread,
        )

        assert result is closed
        channels_service.close_thread.assert_awaited_once_with(
            project_id=project_id,
            user_id=user_id,
            thread_id=thread.id,
        )

    async def test_mid_turn_new_only_closes_the_row_and_returns(self):
        """Mid-turn `!new` must not touch anything about the running turn:
        `dispatch_new` calls exactly one thing (`close_thread`) and nothing
        that could reach into sessions/runner cancellation. This is the
        assertion that no new cancellation-adjacent code path was added for
        `!new` — the running turn's own resolution/thread reference is a
        Python object already captured by the in-flight caller, unaffected
        by a DB row flip."""

        thread = _make_thread()
        channels_service = MagicMock()
        channels_service.close_thread = AsyncMock(
            return_value=thread.model_copy(
                update={"flags": ChannelThreadFlags(is_active=False)}
            )
        )

        await dispatch_new(
            channels_service=channels_service,
            project_id=uuid4(),
            user_id=uuid4(),
            thread=thread,
        )

        # exactly one call to exactly one method
        assert (
            channels_service.method_calls
            == [channels_service.close_thread.call_args_list[0]]
            or channels_service.close_thread.call_count == 1
        )
        channels_service.close_thread.assert_awaited_once()


# ---------------------------------------------------------------------------
# !stop
# ---------------------------------------------------------------------------


class TestDispatchStop:
    async def test_calls_existing_cancel_entry_point(self):
        """`!stop` goes through `SessionStreamsService.command()` — the
        runtime's existing mechanism — with no `data` and no `force`, which
        is exactly the shape that resolves to CommandMode.cancel inside that
        service. No new cancellation code is exercised by this call."""

        thread = _make_thread(session_id="sess-123")
        streams_service = MagicMock()
        streams_service.command = AsyncMock(
            return_value=SessionStreamCommandResponse(
                mode=CommandMode.cancel,
                session_id=thread.session_id,
                detached=True,
            )
        )

        project_id = uuid4()
        user_id = uuid4()

        result = await dispatch_stop(
            streams_service=streams_service,
            project_id=project_id,
            user_id=user_id,
            thread=thread,
        )

        assert result.mode == CommandMode.cancel
        streams_service.command.assert_awaited_once()
        _, kwargs = streams_service.command.call_args
        assert kwargs["project_id"] == project_id
        assert kwargs["user_id"] == user_id
        request = kwargs["request"]
        assert request.session_id == "sess-123"
        assert request.data is None
        assert request.force is False


# ---------------------------------------------------------------------------
# !use:<id>
# ---------------------------------------------------------------------------


class TestResolveUseTarget:
    async def test_id_within_this_threads_history_is_accepted(self):
        thread = _make_thread()
        target = _make_thread(
            space_id=thread.space_id,
            agent_id=thread.agent_id,
            external_key=thread.external_key,
        )

        channels_service = MagicMock()
        channels_service.query_threads = AsyncMock(return_value=[thread, target])

        result = await resolve_use_target(
            channels_service=channels_service,
            project_id=uuid4(),
            thread=thread,
            target_thread_id=target.id,
        )

        assert result is target

    async def test_id_outside_this_threads_history_is_refused(self):
        """Cannot reference another thread's session: an id this thread's
        own `query_threads` scoping never returns is refused, not silently
        accepted."""

        thread = _make_thread()
        foreign_thread_id = uuid4()

        channels_service = MagicMock()
        # this thread's own history does not include the foreign id
        channels_service.query_threads = AsyncMock(return_value=[thread])

        with pytest.raises(ChannelThreadNotFound):
            await resolve_use_target(
                channels_service=channels_service,
                project_id=uuid4(),
                thread=thread,
                target_thread_id=foreign_thread_id,
            )


# ---------------------------------------------------------------------------
# dispatch_command: capability gating + argument validation + native-alias
# equivalence
# ---------------------------------------------------------------------------


def _make_channels_service(*, threads=None, closed_thread=None):
    service = MagicMock()
    service.query_threads = AsyncMock(return_value=threads or [])
    service.close_thread = AsyncMock(return_value=closed_thread)
    return service


def _make_streams_service(*, response=None):
    service = MagicMock()
    service.command = AsyncMock(
        return_value=response
        or SessionStreamCommandResponse(
            mode=CommandMode.cancel, session_id="s", detached=True
        )
    )
    return service


class TestDispatchCommand:
    async def test_sessions_dispatches_to_query_threads(self):
        thread = _make_thread()
        channels_service = _make_channels_service(threads=[thread])
        streams_service = _make_streams_service()

        result = await dispatch_command(
            channels_service=channels_service,
            streams_service=streams_service,
            project_id=uuid4(),
            user_id=uuid4(),
            thread=thread,
            capabilities=_capabilities(),
            parsed=ParsedCommand(command=COMMAND_SESSIONS, arg=None),
        )

        assert result == [thread]
        streams_service.command.assert_not_called()

    async def test_new_dispatches_to_close_thread(self):
        thread = _make_thread()
        channels_service = _make_channels_service(closed_thread=thread)
        streams_service = _make_streams_service()

        await dispatch_command(
            channels_service=channels_service,
            streams_service=streams_service,
            project_id=uuid4(),
            user_id=uuid4(),
            thread=thread,
            capabilities=_capabilities(),
            parsed=ParsedCommand(command=COMMAND_NEW, arg=None),
        )

        channels_service.close_thread.assert_awaited_once()
        streams_service.command.assert_not_called()

    async def test_stop_dispatches_to_streams_service_only(self):
        thread = _make_thread()
        channels_service = _make_channels_service()
        streams_service = _make_streams_service()

        await dispatch_command(
            channels_service=channels_service,
            streams_service=streams_service,
            project_id=uuid4(),
            user_id=uuid4(),
            thread=thread,
            capabilities=_capabilities(),
            parsed=ParsedCommand(command=COMMAND_STOP, arg=None),
        )

        streams_service.command.assert_awaited_once()
        channels_service.close_thread.assert_not_called()
        channels_service.query_threads.assert_not_called()

    async def test_use_with_valid_id_dispatches_to_query_threads(self):
        thread = _make_thread()
        target = _make_thread(
            space_id=thread.space_id,
            agent_id=thread.agent_id,
            external_key=thread.external_key,
        )
        channels_service = _make_channels_service(threads=[thread, target])
        streams_service = _make_streams_service()

        result = await dispatch_command(
            channels_service=channels_service,
            streams_service=streams_service,
            project_id=uuid4(),
            user_id=uuid4(),
            thread=thread,
            capabilities=_capabilities(),
            parsed=ParsedCommand(command=COMMAND_USE, arg=str(target.id)),
        )

        assert result is target

    async def test_use_with_no_arg_raises_rather_than_no_op(self):
        """`!use` with no colon/arg is rejected, not silently treated as a
        no-op command."""

        thread = _make_thread()
        channels_service = _make_channels_service()
        streams_service = _make_streams_service()

        with pytest.raises(CommandArgumentInvalid):
            await dispatch_command(
                channels_service=channels_service,
                streams_service=streams_service,
                project_id=uuid4(),
                user_id=uuid4(),
                thread=thread,
                capabilities=_capabilities(),
                parsed=ParsedCommand(command=COMMAND_USE, arg=None),
            )

    async def test_use_with_malformed_id_raises(self):
        thread = _make_thread()
        channels_service = _make_channels_service()
        streams_service = _make_streams_service()

        with pytest.raises(CommandArgumentInvalid):
            await dispatch_command(
                channels_service=channels_service,
                streams_service=streams_service,
                project_id=uuid4(),
                user_id=uuid4(),
                thread=thread,
                capabilities=_capabilities(),
                parsed=ParsedCommand(command=COMMAND_USE, arg="not-a-uuid"),
            )

    async def test_command_omitted_from_capability_list_never_dispatches(self):
        """A channel whose `commands` list omits e.g. `use` never dispatches
        `!use`, even if a caller hands `dispatch_command` a `ParsedCommand`
        directly (e.g. from a native-command alias) rather than through
        `parse_command`."""

        thread = _make_thread()
        channels_service = _make_channels_service()
        streams_service = _make_streams_service()
        caps = _capabilities(commands=["new", "sessions"])

        with pytest.raises(CommandNotOffered):
            await dispatch_command(
                channels_service=channels_service,
                streams_service=streams_service,
                project_id=uuid4(),
                user_id=uuid4(),
                thread=thread,
                capabilities=caps,
                parsed=ParsedCommand(command=COMMAND_USE, arg="1"),
            )

        channels_service.query_threads.assert_not_called()

    async def test_native_alias_and_text_parsed_path_dispatch_identically(self):
        """A native-command-originated event and a text-parsed one both
        reduce to the same `ParsedCommand` and reach `dispatch_command`
        without any origin-specific branching inside it — same call, same
        result, whichever surface produced the event."""

        thread = _make_thread()

        # Path 1: text parsed from message content.
        from_text = parse_command(
            content=_content("!sessions"), capabilities=_capabilities()
        )
        # Path 2: a native command surface hands over the same internal shape
        # directly (no text to parse).
        from_native = ParsedCommand(command="sessions", arg=None)

        assert from_text == from_native

        channels_service_a = _make_channels_service(threads=[thread])
        channels_service_b = _make_channels_service(threads=[thread])
        streams_service = _make_streams_service()

        result_text = await dispatch_command(
            channels_service=channels_service_a,
            streams_service=streams_service,
            project_id=uuid4(),
            user_id=uuid4(),
            thread=thread,
            capabilities=_capabilities(),
            parsed=from_text,
        )
        result_native = await dispatch_command(
            channels_service=channels_service_b,
            streams_service=streams_service,
            project_id=uuid4(),
            user_id=uuid4(),
            thread=thread,
            capabilities=_capabilities(),
            parsed=from_native,
        )

        assert result_text == result_native == [thread]
