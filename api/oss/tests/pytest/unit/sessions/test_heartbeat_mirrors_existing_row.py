"""The heartbeat must mirror the Redis nest onto a row that ALREADY exists.

The runner is the only component that reports liveness for a real turn (it mints its own
turn id and calls `POST /sessions/streams/heartbeat`; nothing invokes the send/steer command
path), so the heartbeat's row write is the sole producer of `session_streams.flags` —
the column the project-wide liveness query (`is_alive=true`) and the concurrency cap read.

Seeding the result from the pre-read row skipped BOTH the create and the update branch
whenever a row already existed, which is every session that was named first (rename creates
the row) or that had beat once before. Symptoms, all from this one omission:
  - a genuinely running named session kept `flags = NULL` -> no badge anywhere;
  - a row created BY a first beat froze at is_running=true, because the turn-end beat
    (is_running=false) could not write either -> a phantom "running" forever;
  - `updated_at` stayed NULL, so the orphan sweep (which filters on it) never reclaimed them.
"""

from typing import Optional
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from agenta.sdk.models.workflows import WorkflowServiceRequestData

from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStream,
    SessionStreamCommandRequest,
    SessionStreamFlags,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.dbs.redis.sessions.locks import release_alive

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_SESSION = "session_named_first"


class _FakeStreamsDAO:
    """One in-memory row; records how it was written."""

    def __init__(self, existing: Optional[SessionStream] = None):
        self.row = existing
        self.creates = 0
        self.updates = 0

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return self.row

    async def create(self, *, project_id, user_id, stream):
        self.creates += 1
        self.row = SessionStream(
            id=uuid4(),
            project_id=project_id,
            session_id=stream.session_id,
            name=stream.name,
            flags=stream.flags,
            turn_id=stream.turn_id,
        )
        return self.row

    async def update(self, *, project_id, user_id, session_id, stream):
        self.updates += 1
        prior = self.row
        self.row = SessionStream(
            id=prior.id if prior else uuid4(),
            project_id=project_id,
            session_id=session_id,
            name=prior.name if prior else None,
            flags=stream.flags if stream.flags is not None else prior.flags,
            turn_id=stream.turn_id if stream.turn_id is not None else prior.turn_id,
        )
        return self.row


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


def _named_row() -> SessionStream:
    """A row created by the rename edit alone: header only, no flags, no turn."""
    return SessionStream(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=_SESSION,
        name="Mobile Test",
    )


def _beat(turn_id: str, *, is_running: bool = True) -> SessionHeartbeatRequest:
    return SessionHeartbeatRequest(
        session_id=_SESSION,
        replica_id="replica-a",
        turn_id=turn_id,
        is_running=is_running,
    )


@pytest.mark.asyncio
async def test_heartbeat_writes_flags_onto_a_pre_existing_row(lock_engine):
    dao = _FakeStreamsDAO(_named_row())
    svc = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)

    result = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))

    assert dao.creates == 0, "the row exists; the beat must UPDATE, never re-create"
    assert dao.updates == 1, "an existing row must still be mirrored"
    assert result.stream is not None
    assert result.stream.flags == SessionStreamFlags(
        is_alive=True, is_running=True, is_attached=False
    )
    assert result.stream.turn_id == "turn-1"
    assert result.stream.name == "Mobile Test", (
        "the mirror write must not clobber the name"
    )


@pytest.mark.asyncio
async def test_turn_end_heartbeat_clears_running_on_the_row(lock_engine):
    dao = _FakeStreamsDAO(_named_row())
    svc = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))
    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("turn-1", is_running=False)
    )

    assert result.stream is not None
    # `alive` outlives the turn (that is what makes a session reattachable); only
    # `running` collapses — the phantom-running badge is what this guards.
    assert result.stream.flags.is_running is False
    assert result.stream.flags.is_alive is True


@pytest.mark.asyncio
async def test_first_beat_creates_then_later_beats_update(lock_engine):
    dao = _FakeStreamsDAO()
    svc = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))
    assert (dao.creates, dao.updates) == (1, 0)

    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("turn-1", is_running=False)
    )
    assert (dao.creates, dao.updates) == (1, 1), (
        "the turn-end beat must reach the row it created"
    )
    assert result.stream.flags.is_running is False


@pytest.mark.asyncio
async def test_a_stale_beat_does_not_restamp_the_row_with_its_dead_turn(lock_engine):
    """The row's `turn_id` is not decoration: the next beat reads it to decide whether its own
    locks were ever established. A turn whose `alive` lapsed is displaced by nothing, so its
    late beat still runs the whole reconcile and only learns it is not current at the end. If
    it stamps its dead id on the way out, the LIVE turn's next beat reads a foreign prior turn,
    concludes its locks were never established, and re-arms them."""
    dao = _FakeStreamsDAO()
    svc = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-a"))
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-a", is_running=False))
    assert dao.row.turn_id == "turn-a"

    # turn-a's `alive` lapses on TTL, then a fresh send takes the session.
    await release_alive(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-a"
    )
    live = (
        await svc.command(
            project_id=_PROJECT,
            user_id=uuid4(),
            request=SessionStreamCommandRequest(
                session_id=_SESSION,
                data=WorkflowServiceRequestData(inputs={"message": "hi"}),
            ),
        )
    ).turn_id
    assert dao.row.turn_id == live

    late = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-a"))

    assert late.is_current_turn is False
    assert dao.row.turn_id == live, (
        "the stale beat wrote its dead turn id over the live turn's"
    )
