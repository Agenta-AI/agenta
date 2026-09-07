"""M3 live relay — the project-channel events a session LIST revalidates on.

`session-changed` on the project channel is the only signal an open session list gets: the
lists are cached with a stale time and no refetch interval, and `lifecycle` rides the
per-session channel, which no list subscribes to. So every transition that changes WHICH rows
a list shows has to publish here, or that list stays wrong until the tab reloads.

The transitions: the row is created (a session sent from another tab, or minted by the
runner's first beat), it is archived or hard-deleted (leaves the list), and it is unarchived
or re-nested from a killed tombstone (returns to it).

`lifecycle` deliberately stays off this channel. It fires twice per TURN, and a project-wide
invalidation at that rate would refetch every open list on every turn boundary.
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

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_USER = uuid4()


class _RecordingPublisher:
    """Records both families so a test can assert one fired and the other did not."""

    def __init__(self, *, fail: bool = False):
        self.changed_calls: list[tuple[str, str, str]] = []
        self.lifecycle_calls: list[tuple[str, str, str]] = []
        self.fail = fail

    async def lifecycle(self, *, project_id: str, session_id: str, state: str) -> None:
        self.lifecycle_calls.append((project_id, session_id, state))

    async def changed(self, *, project_id: str, entity: str, id: str) -> None:
        if self.fail:
            raise RuntimeError("relay down")
        self.changed_calls.append((project_id, entity, id))


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


def _service(lock_engine, *, dao=None, fail=False):
    publisher = _RecordingPublisher(fail=fail)
    service = SessionStreamsService(
        streams_dao=dao if dao is not None else _FakeStreamsDAO(),
        lock_engine=lock_engine,
        watch_publisher=publisher,
    )
    return service, publisher


def _session_id() -> str:
    return f"session_{uuid4().hex[:12]}"


async def _send(svc, session_id: str, *, force: bool = False):
    return await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=session_id,
            data=WorkflowServiceRequestData(inputs={"messages": ["hi"]}),
            force=force,
        ),
    )


@pytest.mark.asyncio
async def test_send_on_a_new_session_publishes_session_changed(lock_engine):
    """The F11 case: a session started in one tab never reached another tab's open list."""
    svc, publisher = _service(lock_engine)
    session_id = _session_id()

    await _send(svc, session_id)

    assert publisher.changed_calls == [(str(_PROJECT), "session", session_id)]


@pytest.mark.asyncio
async def test_further_turns_on_the_same_session_do_not_republish(lock_engine):
    """Row membership only changes once. A per-turn publish would invalidate every open list
    on every send."""
    svc, publisher = _service(lock_engine)
    session_id = _session_id()

    await _send(svc, session_id)
    # The turn from the first send is still alive, so further turns are steers.
    await _send(svc, session_id, force=True)
    await _send(svc, session_id, force=True)

    assert publisher.changed_calls == [(str(_PROJECT), "session", session_id)]
    # The turn events still fire each time; they just stay off the project channel.
    assert len(publisher.lifecycle_calls) > 1


@pytest.mark.asyncio
async def test_runner_first_heartbeat_publishes_session_changed(lock_engine):
    """A trigger/cron session is minted by the runner's beat, never by `_start_turn`."""
    svc, publisher = _service(lock_engine)
    session_id = _session_id()

    await svc.heartbeat(
        project_id=_PROJECT,
        request=SessionHeartbeatRequest(
            session_id=session_id,
            replica_id="replica-a",
            turn_id="turn-1",
            is_running=True,
        ),
    )

    assert publisher.changed_calls == [(str(_PROJECT), "session", session_id)]


@pytest.mark.asyncio
async def test_subsequent_heartbeats_do_not_republish(lock_engine):
    """The runner beats every 30s per session; only the first one creates the row."""
    svc, publisher = _service(lock_engine)
    session_id = _session_id()

    for _ in range(3):
        await svc.heartbeat(
            project_id=_PROJECT,
            request=SessionHeartbeatRequest(
                session_id=session_id,
                replica_id="replica-a",
                turn_id="turn-1",
                is_running=True,
            ),
        )

    assert publisher.changed_calls == [(str(_PROJECT), "session", session_id)]


@pytest.mark.asyncio
async def test_archive_publishes_session_changed(lock_engine):
    dao = AsyncMock()
    dao.set_archived_by_session_id.return_value = object()
    svc, publisher = _service(lock_engine, dao=dao)

    await svc.archive(project_id=_PROJECT, user_id=_USER, session_id="session-1")

    assert publisher.changed_calls == [(str(_PROJECT), "session", "session-1")]


@pytest.mark.asyncio
async def test_archive_that_matched_nothing_does_not_publish(lock_engine):
    dao = AsyncMock()
    dao.set_archived_by_session_id.return_value = None
    svc, publisher = _service(lock_engine, dao=dao)

    await svc.archive(project_id=_PROJECT, user_id=_USER, session_id="session-1")

    assert publisher.changed_calls == []


@pytest.mark.asyncio
async def test_unarchive_publishes_session_changed(lock_engine):
    dao = AsyncMock()
    dao.clear_archived_by_session_id.return_value = object()
    svc, publisher = _service(lock_engine, dao=dao)

    await svc.unarchive(project_id=_PROJECT, user_id=_USER, session_id="session-1")

    assert publisher.changed_calls == [(str(_PROJECT), "session", "session-1")]


@pytest.mark.asyncio
async def test_hard_delete_publishes_session_changed(lock_engine):
    dao = AsyncMock()
    dao.hard_delete_by_session_id.return_value = True
    svc, publisher = _service(lock_engine, dao=dao)

    await svc.hard_delete(project_id=_PROJECT, session_id="session-1")

    assert publisher.changed_calls == [(str(_PROJECT), "session", "session-1")]


@pytest.mark.asyncio
async def test_hard_delete_that_matched_nothing_does_not_publish(lock_engine):
    dao = AsyncMock()
    dao.hard_delete_by_session_id.return_value = False
    svc, publisher = _service(lock_engine, dao=dao)

    await svc.hard_delete(project_id=_PROJECT, session_id="session-1")

    assert publisher.changed_calls == []


@pytest.mark.asyncio
async def test_a_broken_relay_never_fails_the_write(lock_engine):
    """Same contract the other publish points hold: the DB write is already committed."""
    svc, publisher = _service(lock_engine, fail=True)
    session_id = _session_id()

    result = await _send(svc, session_id)

    assert result is not None
    assert publisher.changed_calls == []
