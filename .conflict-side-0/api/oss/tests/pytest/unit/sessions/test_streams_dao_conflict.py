"""Unit test for a concurrent first-touch race in SessionStreamsDAO.create()
must surface as SessionStreamAlreadyExists (-> 409), never an uncaught IntegrityError (-> 500).

No live DB: a fake TransactionsEngine raises the real asyncpg unique-violation shape so the
DAO's `except IntegrityError` branch is exercised deterministically.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from oss.src.core.sessions.streams.dtos import SessionStreamCreate
from oss.src.core.sessions.streams.types import SessionStreamAlreadyExists
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO


class _FakeSession:
    def __init__(self, *, raise_on_commit: bool):
        self._raise_on_commit = raise_on_commit

    def add(self, _dbe):
        pass

    async def commit(self):
        if self._raise_on_commit:
            raise IntegrityError(
                "INSERT INTO session_streams ...",
                {},
                Exception(
                    "duplicate key value violates unique constraint "
                    '"uq_session_streams_project_session_id"'
                ),
            )

    async def refresh(self, dbe):
        # Mimic the DB-assigned server defaults a real INSERT ... RETURNING would populate.
        dbe.id = uuid4()
        dbe.created_at = datetime.now(timezone.utc)

    async def rollback(self):
        pass

    async def close(self):
        pass


class _FakeEngine:
    """Mimics TransactionsEngine.session(): first call wins, second call loses the race."""

    def __init__(self):
        self._calls = 0

    @asynccontextmanager
    async def session(self):
        self._calls += 1
        fake = _FakeSession(raise_on_commit=self._calls > 1)
        try:
            yield fake
            await fake.commit()
        except Exception:
            await fake.rollback()
            raise
        finally:
            await fake.close()


@pytest.mark.anyio
async def test_concurrent_first_touch_raises_session_stream_already_exists(
    anyio_backend,
):
    assert anyio_backend == "asyncio"
    dao = SessionStreamsDAO(engine=_FakeEngine())
    project_id = uuid4()
    session_id = "sess-race-1"
    stream = SessionStreamCreate(session_id=session_id)

    # First create wins.
    await dao.create(project_id=project_id, user_id=None, stream=stream)

    # A concurrent first-touch double-create hits the unique constraint — must surface as
    # the domain conflict exception (-> 409), never a bare IntegrityError (-> 500).
    with pytest.raises(SessionStreamAlreadyExists) as exc_info:
        await dao.create(project_id=project_id, user_id=None, stream=stream)

    assert exc_info.value.session_id == session_id


@pytest.fixture
def anyio_backend():
    return "asyncio"
