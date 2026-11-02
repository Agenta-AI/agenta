"""The session half of the naming facts: the session's name, and whether it has run a turn."""

from unittest.mock import AsyncMock
from uuid import uuid4

from oss.src.core.sessions.context import make_session_context_resolver


def _resolver(*, stream, turn):
    return make_session_context_resolver(
        streams_service=AsyncMock(fetch_header=AsyncMock(return_value=stream)),
        turns_service=AsyncMock(latest_turn=AsyncMock(return_value=turn)),
    )


async def test_a_session_with_no_turn_yet_is_the_first_turn():
    # A turn row is appended by the runner as the turn executes, so the prelude of the FIRST
    # turn sees none. That is what makes `latest_turn` the right signal.
    resolve = _resolver(stream=type("S", (), {"name": None})(), turn=None)

    assert await resolve(project_id=uuid4(), session_id="sess-1") == (None, True)


async def test_a_session_with_a_turn_and_a_name_is_neither_first_nor_unnamed():
    resolve = _resolver(stream=type("S", (), {"name": "Q3 notes"})(), turn=object())

    assert await resolve(project_id=uuid4(), session_id="sess-1") == ("Q3 notes", False)


async def test_a_session_with_no_row_reads_as_unnamed_and_first():
    # A trigger fire mints a session id and writes no stream row.
    resolve = _resolver(stream=None, turn=None)

    assert await resolve(project_id=uuid4(), session_id="sess-1") == (None, True)
