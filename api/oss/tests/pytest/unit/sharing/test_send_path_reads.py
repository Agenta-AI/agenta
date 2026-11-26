"""The reads of a send cost what they cost before sharing (the tcpdump replay of two live
sends against M2, ~/agenta-m3-qa/gate/sendpath).

- A session read of `mounts/sign` and `interactions/query` rides in the request's one cache
  read: the route registers the session's entry before its capability check.
- A session whose policy read found no row is answered from that read alone: the stream
  read and the turns query read nothing more. "No row" is never cached; it lives only in
  the request memo.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import Request

import oss.src.apis.fastapi.sessions.router as router_module
from oss.src.apis.fastapi.sessions.models import (
    SessionInteractionQueryRequest,
    SessionTurnQueryRequest,
)
from oss.src.apis.fastapi.sessions.router import (
    InteractionsRouter,
    SessionMountsRouter,
    SessionStreamsRouter,
    SessionTurnsRouter,
)
from oss.src.core.access import prefetch
from oss.src.core.access.context import _request_memo
from oss.src.core.sharing.service import _note_missing_session, session_access_entry

_PROJECT = uuid4()


@pytest.fixture
def memo():
    token = _request_memo.set({})
    yield
    _request_memo.reset(token)


def _request() -> Request:
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    request.state.project_id = str(_PROJECT)
    request.state.user_id = str(uuid4())
    request.state.organization_id = str(uuid4())
    return request


@pytest.fixture
def pending_at_check(monkeypatch) -> list:
    """The entries pending when each capability check runs (its one cache read reads
    them)."""
    seen: list = []

    async def check(**_):
        seen.append([prefetch.memo_key(entry) for entry in prefetch.pending()])
        return True

    monkeypatch.setattr(router_module, "check_action_access", check)
    return seen


def _entry_name(session_id: str):
    return prefetch.memo_key(session_access_entry(_PROJECT, session_id))


async def test_mount_sign_reads_the_session_in_the_check(
    monkeypatch, memo, pending_at_check
):
    monkeypatch.setattr(router_module, "allow_resource", AsyncMock(return_value=False))
    router = SessionMountsRouter(
        session_mounts_service=AsyncMock(), mounts_service=AsyncMock()
    )
    with pytest.raises(Exception):
        await router.sign_session_mount_credentials(
            _request(), session_id="s-1", name="cwd"
        )
    assert _entry_name("s-1") in pending_at_check[0]


async def test_interactions_query_reads_the_session_in_the_check(
    monkeypatch, memo, pending_at_check
):
    monkeypatch.setattr(router_module, "allow_resource", AsyncMock(return_value=True))
    service = AsyncMock()
    service.query_interactions.return_value = []
    router = InteractionsRouter(interactions_service=service, commands_service=None)
    await router.query_interactions(
        _request(),
        SessionInteractionQueryRequest.model_validate({"query": {"session_id": "s-2"}}),
    )
    assert _entry_name("s-2") in pending_at_check[0]


def _streams_router(stream=None):
    service = AsyncMock()
    service.fetch.return_value = stream
    return (
        SessionStreamsRouter(
            service=service, interactions_service=AsyncMock(), run_admission=AsyncMock()
        ),
        service,
    )


async def test_a_missing_session_stream_is_answered_from_the_policy_read(
    monkeypatch, memo, pending_at_check
):
    monkeypatch.setattr(router_module, "allow_resource", AsyncMock(return_value=True))
    _note_missing_session(project_id=_PROJECT, session_id="s-new")
    router, service = _streams_router()

    response = await router.fetch_session_stream(_request(), session_id="s-new")

    assert response.stream is None
    service.fetch.assert_not_awaited()


async def test_a_session_with_a_row_is_read(monkeypatch, memo, pending_at_check):
    monkeypatch.setattr(router_module, "allow_resource", AsyncMock(return_value=True))
    router, service = _streams_router()

    await router.fetch_session_stream(_request(), session_id="s-old")

    service.fetch.assert_awaited_once()


async def test_an_invalid_session_id_still_reaches_the_service(
    monkeypatch, memo, pending_at_check
):
    """The service refuses an invalid id; answering it from the policy read would hide
    that refusal."""
    monkeypatch.setattr(router_module, "allow_resource", AsyncMock(return_value=True))
    _note_missing_session(project_id=_PROJECT, session_id="bad id!")
    router, service = _streams_router()

    await router.fetch_session_stream(_request(), session_id="bad id!")

    service.fetch.assert_awaited_once()


async def test_the_turns_of_a_missing_session_are_answered_from_the_policy_read(
    monkeypatch, memo, pending_at_check
):
    monkeypatch.setattr(router_module, "allow_resource", AsyncMock(return_value=True))
    _note_missing_session(project_id=_PROJECT, session_id="s-new")
    turns = AsyncMock()
    router = SessionTurnsRouter(turns_service=turns)

    response = await router.query_turns(
        _request(),
        SessionTurnQueryRequest.model_validate(
            {"query": {"session_id": "s-new"}, "windowing": {"limit": 1}}
        ),
    )

    assert response.count == 0 and response.turns == []
    turns.query_turns.assert_not_awaited()


async def test_the_turns_of_a_session_with_a_row_are_read(
    monkeypatch, memo, pending_at_check
):
    monkeypatch.setattr(router_module, "allow_resource", AsyncMock(return_value=True))
    turns = AsyncMock()
    turns.query_turns.return_value = []
    router = SessionTurnsRouter(turns_service=turns)

    await router.query_turns(
        _request(),
        SessionTurnQueryRequest.model_validate({"query": {"session_id": "s-old"}}),
    )

    turns.query_turns.assert_awaited_once()


# -- the turns cursor answers the same for hidden and unknown turns ------------------------


async def _turns_answer(router, request, body):
    from fastapi import HTTPException  # noqa: PLC0415

    try:
        return 200, await router.query_turns(request, body)
    except HTTPException as error:
        return error.status_code, error.detail


async def test_a_cursor_on_a_session_with_no_row_is_invalid(
    monkeypatch, memo, pending_at_check
):
    monkeypatch.setattr(router_module, "allow_resource", AsyncMock(return_value=True))
    _note_missing_session(project_id=_PROJECT, session_id="s-new")
    router = SessionTurnsRouter(turns_service=AsyncMock())
    body = SessionTurnQueryRequest.model_validate(
        {"query": {"session_id": "s-new"}, "windowing": {"next": str(uuid4())}}
    )

    assert await _turns_answer(router, _request(), body) == (
        400,
        "The cursor is not a turn of this session.",
    )


@pytest.mark.parametrize("cursor_visible", [False, None])
async def test_a_cross_session_cursor_of_a_hidden_or_unknown_turn_is_invalid(
    monkeypatch, memo, pending_at_check, cursor_visible
):
    """Bob pages across sessions with Alice's hidden turn id (or an unknown id) as the
    cursor: one answer for both."""
    from types import SimpleNamespace  # noqa: PLC0415

    monkeypatch.setattr(
        router_module, "allow_resource", AsyncMock(return_value=bool(cursor_visible))
    )
    turns = AsyncMock()
    turns.fetch_turn.return_value = (
        None if cursor_visible is None else SimpleNamespace(session_id="s-alice")
    )
    router = SessionTurnsRouter(turns_service=turns)
    body = SessionTurnQueryRequest.model_validate(
        {"query": {}, "windowing": {"next": str(uuid4())}}
    )

    assert await _turns_answer(router, _request(), body) == (
        400,
        "The cursor is not a turn of this session.",
    )
    turns.query_turns.assert_not_awaited()
