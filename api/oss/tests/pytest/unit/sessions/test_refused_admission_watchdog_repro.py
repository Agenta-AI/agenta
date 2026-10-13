"""Reproduction test for GitHub issue #7538.

A session whose turn ended during a database outage keeps is_running=True on its
session_streams row. When the user retries after the database returns, the runner
posts an admission heartbeat for the new turn id (is_running=True), gets refused
(is_current_turn=False), and releases (is_running=False).

Bug:
The refused admission for a different turn id updates session_streams.updated_at
to NOW(), refreshing the liveness of the dead turn. Consequently, the execution
watchdog (orphan_sweep) cannot sweep the dead turn because its heartbeat appears fresh.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStream,
    SessionStreamEdit,
    SessionStreamFlags,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.dbs.redis.sessions.contract import alive_key, running_key
from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.tasks.asyncio.sessions.orphan_sweep import (
    ORPHAN_THRESHOLD_SECONDS,
)

from unit.sessions.test_project_scoped_locks import _FakeRedis

_PROJECT = uuid4()
_SESSION = "session-outage-7538"


class _FakeStreamsDAO:
    """In-memory DAO tracking row updates and updated_at timestamps."""

    def __init__(self, existing: SessionStream | None = None):
        self.row = existing
        self.updates = 0
        self.creates = 0

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return self.row

    async def create(self, *, project_id, user_id, stream):
        self.creates += 1
        now = datetime.now(UTC)
        self.row = SessionStream(
            id=uuid4(),
            project_id=project_id,
            session_id=stream.session_id,
            name=stream.name,
            flags=stream.flags,
            turn_id=stream.turn_id,
            created_at=now,
            updated_at=now,
        )
        return self.row

    async def update(
        self,
        *,
        project_id: UUID,
        user_id: UUID | None,
        session_id: str,
        stream: SessionStreamEdit,
    ) -> SessionStream | None:
        self.updates += 1
        prior = self.row
        now = datetime.now(UTC)
        self.row = SessionStream(
            id=prior.id if prior else uuid4(),
            project_id=project_id,
            session_id=session_id,
            name=prior.name if prior else None,
            flags=stream.flags
            if stream.flags is not None
            else (prior.flags if prior else None),
            turn_id=stream.turn_id
            if stream.turn_id is not None
            else (prior.turn_id if prior else None),
            created_at=prior.created_at if prior else now,
            updated_at=now,
        )
        return self.row


@pytest_asyncio.fixture
async def lock_engine():
    eng = LockEngine()
    fake_redis = _FakeRedis()
    with patch.object(eng, "_client", return_value=fake_redis):
        # Pre-seed Redis with turn-1 holding alive and running (as left after outage)
        await fake_redis.set(alive_key(str(_PROJECT), _SESSION), b"turn-1")
        await fake_redis.set(running_key(str(_PROJECT), _SESSION), b"turn-1")
        yield eng


def _stale_running_row(stale_seconds: int = 120) -> SessionStream:
    """Row from turn-1 whose last heartbeat was stale_seconds ago."""
    now = datetime.now(UTC)
    stale_time = now - timedelta(seconds=stale_seconds)
    return SessionStream(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=_SESSION,
        turn_id="turn-1",
        flags=SessionStreamFlags(
            is_alive=True,
            is_running=True,
            is_attached=False,
        ),
        created_at=stale_time,
        updated_at=stale_time,
    )


def _beat(turn_id: str, *, is_running: bool = True) -> SessionHeartbeatRequest:
    return SessionHeartbeatRequest(
        session_id=_SESSION,
        replica_id="replica-1",
        turn_id=turn_id,
        is_running=is_running,
    )


@pytest.mark.asyncio
async def test_refused_admission_heartbeat_must_not_refresh_stale_turn_updated_at(
    lock_engine,
):
    stale_seconds = ORPHAN_THRESHOLD_SECONDS + 30  # 120 seconds ago
    original_row = _stale_running_row(stale_seconds=stale_seconds)
    original_updated_at = original_row.updated_at
    dao = _FakeStreamsDAO(original_row)
    svc = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)

    # User retries: turn-2 sends admission heartbeat (is_running=True)
    admission_beat = _beat("turn-2", is_running=True)
    result = await svc.heartbeat(project_id=_PROJECT, request=admission_beat)

    assert result.is_current_turn is False, "turn-2 must be refused admission"

    # A refused admission for a different turn id must NOT update the row's updated_at
    assert dao.row.updated_at == original_updated_at, (
        f"Refused admission for turn-2 refreshed updated_at from {original_updated_at} to {dao.row.updated_at}. "
        "This keeps the dead turn looking alive to the watchdog!"
    )

    # When admission is refused, the runner also sends a closing beat (is_running=False).
    # That closing beat must NOT update updated_at either.
    closing_beat = _beat("turn-2", is_running=False)
    closing_result = await svc.heartbeat(project_id=_PROJECT, request=closing_beat)
    assert closing_result.is_current_turn is False
    assert dao.row.updated_at == original_updated_at, (
        f"Closing beat for refused turn-2 refreshed updated_at to {dao.row.updated_at}."
    )


@pytest.mark.asyncio
async def test_refused_admission_when_prior_stream_is_none_must_not_create_row(
    lock_engine,
):
    dao = _FakeStreamsDAO(existing=None)
    svc = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)

    # Redis holds turn-1, but database row does not exist yet.
    # turn-2 attempts admission:
    admission_beat = _beat("turn-2", is_running=True)
    result = await svc.heartbeat(project_id=_PROJECT, request=admission_beat)

    assert result.is_current_turn is False, "turn-2 must be refused admission"
    assert result.stream is None, "refused beat on absent row must return stream=None"
    assert dao.creates == 0, "refused beat must not create a session_streams row"
    assert dao.row is None, "no database row must be created"


@pytest.mark.asyncio
async def test_heartbeat_without_turn_id_must_not_refresh_stale_turn_updated_at(
    lock_engine,
):
    stale_seconds = ORPHAN_THRESHOLD_SECONDS + 30
    original_row = _stale_running_row(stale_seconds=stale_seconds)
    original_updated_at = original_row.updated_at
    dao = _FakeStreamsDAO(original_row)
    svc = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)

    # Anonymous beat without turn_id
    anonymous_beat = SessionHeartbeatRequest(
        session_id=_SESSION,
        replica_id="replica-1",
        turn_id=None,
        is_running=True,
    )
    result = await svc.heartbeat(project_id=_PROJECT, request=anonymous_beat)
    assert result.is_current_turn is False
    assert dao.row.updated_at == original_updated_at, (
        f"Anonymous beat refreshed updated_at to {dao.row.updated_at}"
    )

    # Anonymous beat with is_running=False
    anonymous_closing_beat = SessionHeartbeatRequest(
        session_id=_SESSION,
        replica_id="replica-1",
        turn_id=None,
        is_running=False,
    )
    closing_result = await svc.heartbeat(
        project_id=_PROJECT, request=anonymous_closing_beat
    )
    assert closing_result.is_current_turn is False
    assert dao.row.updated_at == original_updated_at, (
        f"Anonymous closing beat refreshed updated_at to {dao.row.updated_at}"
    )
