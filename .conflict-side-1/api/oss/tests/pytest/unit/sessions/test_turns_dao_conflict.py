"""A duplicate session turn maps to HTTP 409 instead of an uncaught database error."""

from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from oss.src.core.sessions.turns.dtos import HarnessKind, SessionTurnCreate
from oss.src.dbs.postgres.sessions.turns.dao import SessionTurnsDAO
from oss.src.utils.exceptions import ConflictException, intercept_exceptions


class _FakeSession:
    def __init__(self):
        self.rollback_count = 0

    def add(self, _dbe):
        pass

    async def commit(self):
        raise IntegrityError(
            "INSERT INTO session_turns ...",
            {},
            Exception(
                "duplicate key value violates unique constraint "
                '"ix_session_turns_project_id_session_id_turn_index"'
            ),
        )

    async def refresh(self, _dbe):
        raise AssertionError("a failed insert must not refresh")

    async def rollback(self):
        self.rollback_count += 1


class _FakeEngine:
    def __init__(self):
        self.session_handle = _FakeSession()

    @asynccontextmanager
    async def session(self):
        yield self.session_handle


@pytest.mark.anyio
async def test_duplicate_turn_returns_409_and_rolls_back(anyio_backend):
    assert anyio_backend == "asyncio"
    engine = _FakeEngine()
    dao = SessionTurnsDAO(engine=engine)
    session_id = "sess-duplicate-1"
    turn = SessionTurnCreate(
        session_id=session_id,
        stream_id=uuid4(),
        turn_index=3,
        harness_kind=HarnessKind.PI,
    )

    @intercept_exceptions(verbose=False)
    async def append_turn():
        return await dao.append(project_id=uuid4(), user_id=None, turn=turn)

    with pytest.raises(ConflictException) as exc_info:
        await append_turn()

    assert engine.session_handle.rollback_count == 1
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == {
        "message": f"Session turn 3 already exists for session {session_id}.",
        "conflict": {"session_id": session_id, "turn_index": 3},
    }


@pytest.fixture
def anyio_backend():
    return "asyncio"
