"""A resume after a STOP_KILLS_SESSION kill (or archive) must re-nest the durable row.

Kill/archive soft-deletes the `session_streams` row (`deleted_at`). The unique constraint on
`(project_id, session_id)` is full, so the tombstone keeps occupying the slot: on the next turn
`_start_turn` reads `None` (get filters `deleted_at IS NULL`), `create` hits the unique slot ->
`SessionStreamAlreadyExists`, and the follow-up `update` (also `deleted_at IS NULL`) matches
nothing -> no-op. Without a revive, Redis goes alive but the durable row stays a dead tombstone,
so the session vanishes from the list and `fetch`/`heartbeat` return `None`. `_start_turn` must
detect the no-match update and revive that same row (clear `deleted_at`) so resume re-nests it.
"""

from typing import Optional
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from agenta.sdk.models.workflows import WorkflowServiceRequestData

from oss.src.core.sessions.streams.dtos import (
    CommandMode,
    SessionStream,
    SessionStreamCommandRequest,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.streams.types import SessionStreamAlreadyExists

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_USER = uuid4()
_SESSION = "session_killed_then_resumed"


class _TombstoneDAO:
    """A killed session: the row exists but is soft-deleted. `get`/`update` see nothing and
    `create` loses the unique slot, until `unarchive_by_session_id` clears `deleted_at`."""

    def __init__(self):
        self.creates = 0
        self.updates = 0
        self.unarchive_calls = 0
        self.revived = False
        # Header (name) rides the tombstone — resume must preserve it, so keep one stable id.
        self.row = SessionStream(
            id=uuid4(), project_id=_PROJECT, session_id=_SESSION, name="My chat"
        )

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return self.row if self.revived else None

    async def create(self, *, project_id, user_id, stream):
        self.creates += 1
        raise SessionStreamAlreadyExists(session_id=stream.session_id)

    async def update(self, *, project_id, user_id, session_id, stream):
        self.updates += 1
        return self.row if self.revived else None

    async def unarchive_by_session_id(self, *, project_id, user_id, session_id):
        self.unarchive_calls += 1
        self.revived = True
        return self.row

    async def delete_by_session_id(self, *, project_id, session_id):
        return True


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


@pytest.mark.asyncio
async def test_resume_after_kill_revives_the_tombstone_row(lock_engine):
    dao = _TombstoneDAO()
    svc = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)

    result = await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=_SESSION,
            data=WorkflowServiceRequestData(inputs={"messages": ["resume me"]}),
            force=False,
        ),
    )

    assert result.mode == CommandMode.send
    assert result.turn_id is not None
    assert dao.creates == 1, "create attempted and lost the unique slot to the tombstone"
    assert dao.unarchive_calls == 1, "the dead tombstone must be unarchived on resume"
    assert dao.updates == 2, "no-op update, then a second update after the revive"
    assert dao.row.name == "My chat", "resume keeps the session's header/title"
