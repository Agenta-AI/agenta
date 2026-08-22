"""Unit test: SessionStreamsDAO.update_header must not touch `updated_at`.

`updated_at` is the heartbeat timestamp the frontend reads as last-activity time when
sorting the session list (see `activity()` in `projectSessions.ts`). A rename write
(including the frontend's fire-and-forget auto-title call, fired unawaited on a
session's first message) bumping the same column let a delayed, unrelated header write
reorder the list ahead of a session with a genuinely more recent message (#5579).

No live DB: a fake TransactionsEngine returns a pre-built dbe from `execute()`,
mirroring the SELECT + mutate + commit shape `update_header` uses.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from oss.src.core.sessions.streams.dtos import SessionStreamHeaderEdit
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE


class _FakeResult:
    def __init__(self, dbe):
        self._dbe = dbe

    def scalar_one_or_none(self):
        return self._dbe


class _FakeSession:
    def __init__(self, dbe):
        self._dbe = dbe

    async def execute(self, _stmt):
        return _FakeResult(self._dbe)

    async def commit(self):
        pass

    async def refresh(self, _dbe):
        pass

    async def rollback(self):
        pass

    async def close(self):
        pass


class _FakeEngine:
    def __init__(self, dbe):
        self._dbe = dbe

    @asynccontextmanager
    async def session(self):
        fake = _FakeSession(self._dbe)
        try:
            yield fake
            await fake.commit()
        except Exception:
            await fake.rollback()
            raise
        finally:
            await fake.close()


@pytest.mark.anyio
async def test_update_header_does_not_bump_updated_at(anyio_backend):
    assert anyio_backend == "asyncio"
    stale_heartbeat = datetime(2026, 1, 1, tzinfo=timezone.utc)
    dbe = SessionStreamDBE(
        id=uuid4(),
        project_id=uuid4(),
        session_id="sess-rename-1",
        name="old name",
        updated_at=stale_heartbeat,
    )
    dao = SessionStreamsDAO(engine=_FakeEngine(dbe))

    result = await dao.update_header(
        project_id=dbe.project_id,
        user_id=uuid4(),
        session_id=dbe.session_id,
        header=SessionStreamHeaderEdit(name="new name"),
    )

    assert result is not None
    assert result.name == "new name"
    # The rename applied, but the heartbeat timestamp must stay put -- only the real
    # heartbeat path (SessionStreamsDAO.update) may move it.
    assert result.updated_at == stale_heartbeat


@pytest.fixture
def anyio_backend():
    return "asyncio"
