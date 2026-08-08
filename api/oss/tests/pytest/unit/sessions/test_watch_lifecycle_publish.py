"""M3 live relay — lifecycle publish points (decision §5-2).

Turn state transitions are written in exactly one place, `SessionStreamsService`
(send/steer via `_start_turn`, cancel/kill, and the runner's turn-ended
heartbeat), so that service is the single choke point for the `lifecycle`
watch events: `running` when a turn starts, `ended` when it stops. Idle
heartbeats (no running key to clear) must NOT re-publish `ended`.
"""

from typing import Optional
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from agenta.sdk.models.workflows import WorkflowServiceRequestData

from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStream,
    SessionStreamCommandRequest,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.streams.types import SessionStreamAlreadyExists

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_USER = uuid4()


class _RecordingPublisher:
    def __init__(self):
        self.lifecycle_calls: list[tuple[str, str, str]] = []

    async def lifecycle(self, *, project_id: str, session_id: str, state: str) -> None:
        self.lifecycle_calls.append((project_id, session_id, state))


class _FakeStreamsDAO:
    def __init__(self, existing: Optional[SessionStream] = None):
        self.row = existing

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return self.row

    async def create(self, *, project_id, user_id, stream):
        self.row = SessionStream(
            id=uuid4(),
            project_id=project_id,
            session_id=stream.session_id,
            flags=stream.flags,
            turn_id=stream.turn_id,
        )
        return self.row

    async def update(self, *, project_id, user_id, session_id, stream):
        prior = self.row
        self.row = SessionStream(
            id=prior.id if prior else uuid4(),
            project_id=project_id,
            session_id=session_id,
            flags=stream.flags
            if stream.flags is not None
            else (prior.flags if prior else None),
            turn_id=stream.turn_id
            if stream.turn_id is not None
            else (prior.turn_id if prior else None),
        )
        return self.row

    async def delete_by_session_id(self, *, project_id, session_id):
        return True


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


def _service(lock_engine):
    publisher = _RecordingPublisher()
    service = SessionStreamsService(
        streams_dao=_FakeStreamsDAO(),
        lock_engine=lock_engine,
        watch_publisher=publisher,  # duck-typed fake; only .lifecycle is used
    )
    return service, publisher


def _session_id() -> str:
    return f"session_{uuid4().hex[:12]}"


@pytest.mark.asyncio
async def test_send_publishes_lifecycle_running(lock_engine):
    svc, publisher = _service(lock_engine)
    session_id = _session_id()

    await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=session_id,
            data=WorkflowServiceRequestData(inputs={"messages": ["hi"]}),
            force=False,
        ),
    )

    assert publisher.lifecycle_calls == [(str(_PROJECT), session_id, "running")]


@pytest.mark.asyncio
async def test_steer_publishes_lifecycle_running(lock_engine):
    svc, publisher = _service(lock_engine)
    session_id = _session_id()

    await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=session_id,
            data=WorkflowServiceRequestData(inputs={"messages": ["hi"]}),
            force=True,
        ),
    )

    assert (str(_PROJECT), session_id, "running") in publisher.lifecycle_calls


@pytest.mark.asyncio
async def test_cancel_publishes_lifecycle_ended(lock_engine):
    svc, publisher = _service(lock_engine)
    session_id = _session_id()

    await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(session_id=session_id, force=False),
    )

    assert publisher.lifecycle_calls == [(str(_PROJECT), session_id, "ended")]


@pytest.mark.asyncio
async def test_kill_publishes_lifecycle_ended(lock_engine):
    svc, publisher = _service(lock_engine)
    session_id = _session_id()

    with patch(
        "oss.src.core.sessions.streams.service.kill_runner_sandbox",
        new_callable=AsyncMock,
    ):
        await svc.kill(project_id=_PROJECT, user_id=_USER, session_id=session_id)

    assert publisher.lifecycle_calls == [(str(_PROJECT), session_id, "ended")]


@pytest.mark.asyncio
async def test_turn_end_heartbeat_publishes_ended_once(lock_engine):
    svc, publisher = _service(lock_engine)
    session_id = _session_id()

    # Start a turn (send), then the runner reports the turn ended.
    result = await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=session_id,
            data=WorkflowServiceRequestData(inputs={"messages": ["hi"]}),
            force=False,
        ),
    )
    publisher.lifecycle_calls.clear()

    await svc.heartbeat(
        project_id=_PROJECT,
        request=SessionHeartbeatRequest(
            session_id=session_id,
            replica_id="replica-1",
            turn_id=result.turn_id,
            is_running=False,
        ),
    )
    assert publisher.lifecycle_calls == [(str(_PROJECT), session_id, "ended")]

    # An idle heartbeat (running key already gone) must not publish again.
    publisher.lifecycle_calls.clear()
    await svc.heartbeat(
        project_id=_PROJECT,
        request=SessionHeartbeatRequest(
            session_id=session_id,
            replica_id="replica-1",
            turn_id=result.turn_id,
            is_running=False,
        ),
    )
    assert publisher.lifecycle_calls == []


@pytest.mark.asyncio
async def test_first_beat_of_a_runner_minted_turn_publishes_running(lock_engine):
    """The path real runs take: no send/steer command, so `_start_turn` never fires — the
    runner mints its own turn id and only heartbeats. Without a publish here the relay's
    `running` lifecycle event never fires for any actual turn."""
    svc, publisher = _service(lock_engine)
    session_id = _session_id()

    await svc.heartbeat(
        project_id=_PROJECT,
        request=SessionHeartbeatRequest(
            session_id=session_id,
            replica_id="replica-1",
            turn_id="runner-turn-1",
            is_running=True,
        ),
    )
    assert publisher.lifecycle_calls == [(str(_PROJECT), session_id, "running")]

    # Every ~30s beat of the SAME turn must stay silent; only the transition publishes.
    publisher.lifecycle_calls.clear()
    await svc.heartbeat(
        project_id=_PROJECT,
        request=SessionHeartbeatRequest(
            session_id=session_id,
            replica_id="replica-1",
            turn_id="runner-turn-1",
            is_running=True,
        ),
    )
    assert publisher.lifecycle_calls == []

    # A new turn on the same session is a fresh transition.
    await svc.heartbeat(
        project_id=_PROJECT,
        request=SessionHeartbeatRequest(
            session_id=session_id,
            replica_id="replica-1",
            turn_id="runner-turn-2",
            is_running=True,
        ),
    )
    assert publisher.lifecycle_calls == [(str(_PROJECT), session_id, "running")]


class _TombstoneDAO:
    """A killed session: the row is soft-deleted, so `get` and `update` see nothing and
    `create` loses the (project_id, session_id) unique slot to the tombstone."""

    def __init__(self):
        self.creates = 0
        self.updates = 0

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return None

    async def create(self, *, project_id, user_id, stream):
        self.creates += 1
        raise SessionStreamAlreadyExists(session_id=stream.session_id)

    async def update(self, *, project_id, user_id, session_id, stream):
        self.updates += 1
        return None

    async def delete_by_session_id(self, *, project_id, session_id):
        return True


@pytest.mark.asyncio
async def test_beat_on_a_killed_tombstone_publishes_nothing(lock_engine):
    """A late beat from a killed turn's watchdog resolves to no row at all (create loses the
    slot to the tombstone, update matches nothing). Announcing `running` for it would light
    every watcher's badge for a session that cannot run — and nothing ever clears it, because
    the turn-end beat's `ended` publish is gated on a `running` key that this beat is the only
    thing to have armed."""
    publisher = _RecordingPublisher()
    dao = _TombstoneDAO()
    svc = SessionStreamsService(
        streams_dao=dao, lock_engine=lock_engine, watch_publisher=publisher
    )
    session_id = _session_id()

    result = await svc.heartbeat(
        project_id=_PROJECT,
        request=SessionHeartbeatRequest(
            session_id=session_id,
            replica_id="replica-1",
            turn_id="killed-turn",
            is_running=True,
        ),
    )

    assert (dao.creates, dao.updates) == (1, 1), "both row paths must have been tried"
    assert result.stream is None, "a killed session resolves to no row"
    assert publisher.lifecycle_calls == [], (
        "a dead tombstone must never be announced as running"
    )


@pytest.mark.asyncio
async def test_send_does_not_double_publish_running_on_its_first_beat(lock_engine):
    """`_start_turn` already recorded the turn on the row, so the runner's first beat for
    that same turn must not emit a second `running`."""
    svc, publisher = _service(lock_engine)
    session_id = _session_id()

    result = await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=session_id,
            data=WorkflowServiceRequestData(inputs={"messages": ["hi"]}),
            force=False,
        ),
    )
    publisher.lifecycle_calls.clear()

    await svc.heartbeat(
        project_id=_PROJECT,
        request=SessionHeartbeatRequest(
            session_id=session_id,
            replica_id="replica-1",
            turn_id=result.turn_id,
            is_running=True,
        ),
    )
    assert publisher.lifecycle_calls == []
