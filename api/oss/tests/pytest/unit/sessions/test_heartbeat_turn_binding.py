"""A turn is bound to the first runner pod that beats it.

The heartbeat writes `bound:<project>:session:<id>:turn:<turn>` with NX on every beat that names
a turn. A beat from any other pod for the same turn id is refused before it touches a lock or the
stream row, on a running beat and on the final `is_running: false` beat alike. The alive and
running keys key only on the turn, so without the binding two pods that beat one turn id would
both be admitted.

The address in the binding is where Stop goes, and Stop carries the runner token, so the address
is stored only from a beat that proved it is runner infrastructure.
"""

from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.core.sessions.streams import service as streams_service_module
from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStream,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.dbs.redis.sessions.contract import TURN_BOUND_TTL_SECONDS, turn_bound_key
from oss.src.dbs.redis.sessions.locks import (
    acquire_alive,
    acquire_running,
    bind_turn,
    force_cancel_alive,
    get_alive_owner,
    get_running_owner,
    get_turn_binding,
)

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_SESSION = "session_turn_binding"
_PID = str(_PROJECT)

_POD_A = "agenta-runner-6f9c7d5b8-aaaaa"
_POD_B = "agenta-runner-6f9c7d5b8-bbbbb"
_ADDRESS_A = "http://10.8.2.17:8765"
_ADDRESS_B = "http://10.8.2.18:8765"


class _FakeDAO:
    """Records every write so a test can assert a refused beat wrote nothing."""

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
            flags=stream.flags
            if stream.flags is not None
            else (prior.flags if prior else None),
            turn_id=stream.turn_id
            if stream.turn_id is not None
            else (prior.turn_id if prior else None),
        )
        return self.row

    async def fill_missing(self, **_):
        return None

    async def delete_by_session_id(self, *, project_id, session_id):
        return True


@pytest.fixture
def redis():
    return _FakeRedis()


@pytest_asyncio.fixture
async def lock_engine(redis):
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=redis):
        yield eng


def _service(lock_engine, dao=None):
    return SessionStreamsService(streams_dao=dao or _FakeDAO(), lock_engine=lock_engine)


def _beat(
    replica: str,
    turn: Optional[str],
    *,
    running: bool = True,
    address: Optional[str] = None,
) -> SessionHeartbeatRequest:
    return SessionHeartbeatRequest(
        session_id=_SESSION,
        replica_id=replica,
        replica_address=address,
        turn_id=turn,
        is_running=running,
    )


async def _beat_as_runner(svc, request: SessionHeartbeatRequest):
    return await svc.heartbeat(
        project_id=_PROJECT, request=request, runner_verified=True
    )


async def _binding(lock_engine, turn: str):
    return await get_turn_binding(
        lock_engine, project_id=_PID, session_id=_SESSION, turn_id=turn
    )


async def _nest(lock_engine):
    alive = await get_alive_owner(lock_engine, project_id=_PID, session_id=_SESSION)
    running = await get_running_owner(lock_engine, project_id=_PID, session_id=_SESSION)
    return alive, running


# --------------------------------------------------------------------------- #
# One turn, one pod
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_the_first_beat_binds_the_turn_and_establishes_the_nest(lock_engine):
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)

    result = await _beat_as_runner(svc, _beat(_POD_A, "turn-1", address=_ADDRESS_A))

    assert result.is_current_turn is True
    assert await _nest(lock_engine) == ("turn-1", "turn-1")
    binding = await _binding(lock_engine, "turn-1")
    assert binding is not None
    assert (binding.replica_id, binding.replica_address) == (_POD_A, _ADDRESS_A)
    assert dao.creates == 1


@pytest.mark.asyncio
async def test_a_second_pod_is_refused_on_its_first_beat_and_on_a_later_one(
    lock_engine,
):
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)
    await _beat_as_runner(svc, _beat(_POD_A, "turn-1", address=_ADDRESS_A))
    writes_after_a = dao.creates + dao.updates

    first = await _beat_as_runner(svc, _beat(_POD_B, "turn-1", address=_ADDRESS_B))
    later = await _beat_as_runner(svc, _beat(_POD_B, "turn-1", address=_ADDRESS_B))

    assert first.is_current_turn is False, "pod B was admitted to pod A's turn"
    assert later.is_current_turn is False
    assert await _nest(lock_engine) == ("turn-1", "turn-1")
    binding = await _binding(lock_engine, "turn-1")
    assert binding is not None
    assert binding.replica_id == _POD_A, "pod B took the binding"
    assert binding.replica_address == _ADDRESS_A
    assert dao.creates + dao.updates == writes_after_a, "pod B wrote the row"

    # The bound pod is still current.
    again = await _beat_as_runner(svc, _beat(_POD_A, "turn-1", address=_ADDRESS_A))
    assert again.is_current_turn is True


@pytest.mark.asyncio
async def test_a_refused_pods_final_beat_leaves_the_bound_turn_running(lock_engine):
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)
    await _beat_as_runner(svc, _beat(_POD_A, "turn-1", address=_ADDRESS_A))
    writes_after_a = dao.creates + dao.updates
    publish_lifecycle = AsyncMock()

    with patch.object(svc, "_publish_lifecycle", publish_lifecycle):
        result = await _beat_as_runner(
            svc, _beat(_POD_B, "turn-1", running=False, address=_ADDRESS_B)
        )

    assert result.is_current_turn is False
    assert await _nest(lock_engine) == ("turn-1", "turn-1"), (
        "pod B's final beat released pod A's running"
    )
    assert dao.creates + dao.updates == writes_after_a
    publish_lifecycle.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_response_echoes_the_callers_replica_id(lock_engine):
    svc = _service(lock_engine)

    admitted = await _beat_as_runner(svc, _beat(_POD_A, "turn-1"))
    refused = await _beat_as_runner(svc, _beat(_POD_B, "turn-1"))

    assert admitted.replica_id == _POD_A
    assert refused.replica_id == _POD_B


# --------------------------------------------------------------------------- #
# The address is trusted only from runner infrastructure
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_beat_without_the_runner_token_binds_an_empty_address_and_warns(
    lock_engine,
):
    svc = _service(lock_engine)
    log = MagicMock()

    with patch.object(streams_service_module, "log", log):
        result = await svc.heartbeat(
            project_id=_PROJECT,
            request=_beat(_POD_A, "turn-1", address="http://attacker.example:80"),
            runner_verified=False,
        )

    assert result.is_current_turn is True, "a missing runner token is not a refusal"
    binding = await _binding(lock_engine, "turn-1")
    assert binding is not None
    assert binding.replica_id == _POD_A
    assert binding.replica_address == ""
    assert any(
        "without a valid runner token" in str(call.args[0])
        for call in log.warning.call_args_list
    )


@pytest.mark.asyncio
async def test_a_beat_with_the_runner_token_stores_the_address(lock_engine):
    svc = _service(lock_engine)
    log = MagicMock()

    with patch.object(streams_service_module, "log", log):
        await _beat_as_runner(svc, _beat(_POD_A, "turn-1", address=_ADDRESS_A))

    binding = await _binding(lock_engine, "turn-1")
    assert binding is not None
    assert binding.replica_address == _ADDRESS_A
    log.warning.assert_not_called()


@pytest.mark.asyncio
async def test_only_the_bound_pod_refreshes_the_binding_ttl(lock_engine, redis):
    svc = _service(lock_engine)
    await _beat_as_runner(svc, _beat(_POD_A, "turn-1", address=_ADDRESS_A))
    key = turn_bound_key(_PID, _SESSION, "turn-1")
    redis._ttl[key] = 5

    await _beat_as_runner(svc, _beat(_POD_B, "turn-1", address=_ADDRESS_B))
    assert redis._ttl[key] == 5, "a refused pod kept another pod's binding alive"

    await _beat_as_runner(svc, _beat(_POD_A, "turn-1", address=_ADDRESS_A))
    assert redis._ttl[key] == TURN_BOUND_TTL_SECONDS


# --------------------------------------------------------------------------- #
# What the binding does not change
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_the_heartbeat_writes_no_session_owner_key(lock_engine, redis):
    svc = _service(lock_engine)

    result = await _beat_as_runner(svc, _beat(_POD_A, "turn-1", address=_ADDRESS_A))
    await _beat_as_runner(svc, _beat(_POD_A, None))

    assert result.is_current_turn is True
    assert not [key for key in redis._values if key.startswith("owner:")]


@pytest.mark.asyncio
async def test_a_parked_turn_keeps_its_binding(lock_engine, redis):
    """A turn parked on an approval sends its final beat and then stops beating, holding
    `alive` without `running`. Stop for that approval must still find the pod."""
    svc = _service(lock_engine)
    await _beat_as_runner(svc, _beat(_POD_A, "turn-1", address=_ADDRESS_A))

    ended = await _beat_as_runner(
        svc, _beat(_POD_A, "turn-1", running=False, address=_ADDRESS_A)
    )

    assert ended.is_current_turn is True
    assert await _nest(lock_engine) == ("turn-1", None), (
        "alive must outlive the turn (reattachable) and running must be released"
    )
    binding = await _binding(lock_engine, "turn-1")
    assert binding is not None
    assert (binding.replica_id, binding.replica_address) == (_POD_A, _ADDRESS_A)
    assert redis._ttl[turn_bound_key(_PID, _SESSION, "turn-1")] == (
        TURN_BOUND_TTL_SECONDS
    )


@pytest.mark.asyncio
async def test_a_new_turn_on_a_replacement_pod_is_admitted_at_once(lock_engine):
    """A pod that dies with no graceful shutdown leaves its last turn's `alive` behind. The
    replacement pod's next turn has a new turn id, so the old binding does not refuse it, and
    nothing waits for a lease to expire."""
    svc = _service(lock_engine)
    await _beat_as_runner(svc, _beat(_POD_A, "turn-stopped"))
    await _beat_as_runner(svc, _beat(_POD_A, "turn-stopped", running=False))

    recovery = await _beat_as_runner(svc, _beat(_POD_B, "turn-recovery"))
    second = await _beat_as_runner(svc, _beat(_POD_B, "turn-recovery"))

    assert recovery.is_current_turn is True
    assert second.is_current_turn is True
    assert await _nest(lock_engine) == ("turn-recovery", "turn-recovery")
    binding = await _binding(lock_engine, "turn-recovery")
    assert binding is not None
    assert binding.replica_id == _POD_B


@pytest.mark.asyncio
async def test_a_different_turn_on_another_pod_is_refused_while_a_turn_runs(
    lock_engine,
):
    """The binding is per turn. Two turns of one session are still kept apart by the
    `alive` and `running` locks, whichever pod beats them."""
    svc = _service(lock_engine)
    await _beat_as_runner(svc, _beat(_POD_A, "turn-live"))

    intruder = await _beat_as_runner(svc, _beat(_POD_B, "turn-intruder"))

    assert intruder.is_current_turn is False
    assert await _nest(lock_engine) == ("turn-live", "turn-live")


@pytest.mark.asyncio
async def test_an_api_minted_turn_is_current_on_the_pod_that_first_beats_it(
    lock_engine,
):
    """`_start_turn` takes `alive` and `running` before any runner beats, so the first beat
    arrives with its own locks already in place and binds the turn to that pod."""
    svc = _service(lock_engine)
    await force_cancel_alive(lock_engine, project_id=_PID, session_id=_SESSION)
    await acquire_alive(
        lock_engine, project_id=_PID, session_id=_SESSION, turn_id="turn-api"
    )
    await acquire_running(
        lock_engine, project_id=_PID, session_id=_SESSION, turn_id="turn-api"
    )

    result = await _beat_as_runner(svc, _beat(_POD_B, "turn-api", address=_ADDRESS_B))

    assert result.is_current_turn is True
    binding = await _binding(lock_engine, "turn-api")
    assert binding is not None
    assert binding.replica_id == _POD_B


@pytest.mark.asyncio
async def test_a_binding_that_expires_before_the_read_back_is_written_on_retry():
    from oss.src.dbs.redis.shared.engine import LockEngine

    class _ExpiresBeforeReadBack(_FakeRedis):
        """The first NX finds another key, which expires before the GET reads it."""

        def __init__(self):
            super().__init__()
            self.refused_once = False

        async def set(self, key, value, nx=False, ex=None):
            if nx and not self.refused_once:
                self.refused_once = True
                return None
            return await super().set(key, value, nx=nx, ex=ex)

    engine = LockEngine()
    with patch.object(engine, "_client", return_value=_ExpiresBeforeReadBack()):
        binding, bound_now = await bind_turn(
            engine,
            project_id=_PID,
            session_id=_SESSION,
            turn_id="turn-1",
            replica_id=_POD_A,
            replica_address=_ADDRESS_A,
        )
        stored = await _binding(engine, "turn-1")

    assert bound_now is True
    assert (binding.replica_id, binding.replica_address) == (_POD_A, _ADDRESS_A)
    assert stored is not None
    assert stored.replica_id == _POD_A
