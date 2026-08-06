"""A heartbeat that loses the stream row's first-touch race must still succeed.

`_start_turn` and the turn's first `heartbeat` both do get-then-create on the same
`(project_id, session_id)` row, and the runner fires that heartbeat immediately after the turn
starts. Both read `None`, both INSERT, and the loser hits
`uq_session_streams_project_session_id` -> `SessionStreamAlreadyExists` -> 409. The row the
loser wanted now exists, written by the winner, so the conflict is benign: re-read and carry
on. Letting it escape surfaces a spurious `heartbeat HTTP 409` on a perfectly healthy turn.
"""

from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStream,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.streams.types import SessionStreamAlreadyExists

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_SESSION = "session_race"


class _RacingDAO:
    """SELECT sees no row (the winner has not committed yet); the INSERT then loses the race."""

    def __init__(self):
        self.creates = 0
        self.updates = 0
        self.winner_row = SessionStream(
            id=uuid4(), project_id=_PROJECT, session_id=_SESSION
        )

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        # Invisible before the conflict; the winner's committed row after it.
        return self.winner_row if self.creates else None

    async def create(self, *, project_id, user_id, stream):
        self.creates += 1
        raise SessionStreamAlreadyExists(session_id=stream.session_id)

    async def update(self, *, project_id, user_id, session_id, stream):
        self.updates += 1
        return self.winner_row

    async def delete_by_session_id(self, *, project_id, session_id):
        return True


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


@pytest.mark.asyncio
async def test_heartbeat_survives_losing_the_first_touch_race(lock_engine):
    dao = _RacingDAO()
    svc = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)

    # The turn is healthy; only the row INSERT collided. The heartbeat must not raise.
    result = await svc.heartbeat(
        project_id=_PROJECT,
        request=SessionHeartbeatRequest(
            session_id=_SESSION,
            replica_id="replica-a",
            turn_id="turn-1",
            is_running=True,
        ),
    )

    assert dao.creates == 1, "the heartbeat attempted the create and lost the race"
    assert result.stream is not None, (
        "a lost first-touch race must re-read the winner's row, not surface a 409"
    )
    assert result.stream.session_id == _SESSION
