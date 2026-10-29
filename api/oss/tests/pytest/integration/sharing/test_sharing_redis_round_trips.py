# ruff: noqa: F811  (the fixtures of the statement-count module are imported here)
"""Redis round trips of the M3 hot paths (M3 gate, latency finding 3; owner rule: zero added
round trips per request on hot paths, Redis counts).

Every `send_packed_command` of a redis.asyncio connection is one network round trip (a
pipeline or a script is one). The targets are M2's counts: the sharing reads ride in calls
the request already makes.

(a) A route's session decision reads the principal, the caller's membership and the
    session's `sharing_session_access` entry in the decision's one `MGET`; the owner's
    membership, when the owner is the caller, is the key that `MGET` already read.
(b) `RunAdmission.admit` outside a request (queued dispatch, triggers) reads the principal,
    the membership, the session entry and the agent entry in one `MGET` for both decisions.
(c) A steady beat reads its admission record and its supersession tombstone in one script;
    a checked running beat writes the admission record inside the bind script.
(e) A human session list reads `sharing_user_grants` in the decision's `MGET`.

Needs a reachable Redis, like the statement-count tests (see that module's docstring).
"""

from typing import List
from uuid import uuid4

import pytest

from oss.src.core.access.context import _request_memo
from oss.src.core.access.dtos import (
    Permission,
    PrincipalKind,
    PrincipalRef,
    ResourceKind,
    ResourceRef,
)
from oss.tests.pytest.integration.sharing.test_sharing_query_counts_postgres import (  # noqa: F401
    _beat,
    _sid,
    redis_commands,
    world,
)

pytestmark = pytest.mark.integration

# M2 743bc49335, steady beat (after/LATENCY.md section 2, the same counter).
M2_STEADY_BEAT_ROUND_TRIPS = 15


class RoundTrips:
    def __init__(self) -> None:
        self.sends: List[bytes] = []
        self.recording = False

    def touching(self, fragment: bytes) -> List[bytes]:
        return [send for send in self.sends if fragment in send]


@pytest.fixture
def round_trips(monkeypatch) -> RoundTrips:
    from redis.asyncio.connection import AbstractConnection

    recorder = RoundTrips()
    original = AbstractConnection.send_packed_command

    async def send_packed_command(self, command, check_health=True):
        if recorder.recording:
            chunks = (
                [command]
                if isinstance(command, (bytes, str, memoryview))
                else list(command)
            )
            recorder.sends.append(
                b"".join(c.encode() if isinstance(c, str) else bytes(c) for c in chunks)
            )
        return await original(self, command, check_health)

    monkeypatch.setattr(AbstractConnection, "send_packed_command", send_packed_command)
    return recorder


class _Memo:
    """One request's memo, as the auth middleware opens it."""

    def __enter__(self):
        self._token = _request_memo.set({})
        return self

    def __exit__(self, *exc):
        _request_memo.reset(self._token)


async def _counted(round_trips: RoundTrips, work):
    round_trips.sends.clear()
    round_trips.recording = True
    try:
        result = await work()
    finally:
        round_trips.recording = False
    return result


def _human(user_id):
    return PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)


# -- (a) the route's session decision ------------------------------------------------------


async def test_a_route_session_decision_is_one_round_trip(world, round_trips):
    session_id = _sid()
    turn = str(uuid4())
    await _beat(world, session_id, turn)  # Alice's private session, created by her run

    async def decide():
        with _Memo():
            return await world.access.decide(
                authority=None,
                principal=_human(world.alice),
                action=Permission.RUN_SESSIONS,
                project_id=world.project_id,
                resource=ResourceRef(kind=ResourceKind.SESSION, id=session_id),
            )

    assert (await decide()).allowed  # warms every cache entry
    decision = await _counted(round_trips, decide)
    assert decision.allowed
    assert len(round_trips.sends) == 1, round_trips.sends
    assert round_trips.sends[0].startswith(b"*") and b"MGET" in round_trips.sends[0]


async def test_a_missing_session_decision_is_one_round_trip(world, round_trips):
    """The services read a new session id before its row exists: one round trip warm,
    no lock and no wait."""
    session_id = _sid()

    async def decide():
        with _Memo():
            return await world.access.decide(
                authority=None,
                principal=_human(world.alice),
                action=Permission.VIEW_SESSIONS,
                project_id=world.project_id,
                resource=ResourceRef(kind=ResourceKind.SESSION, id=session_id),
            )

    await decide()
    await _counted(round_trips, decide)
    assert len(round_trips.sends) == 1, round_trips.sends
    assert round_trips.touching(b"lock::") == []


# -- (b) admission outside a request -------------------------------------------------------


async def test_admission_outside_a_request_is_one_round_trip(world, round_trips):
    session_id = _sid()
    turn = str(uuid4())
    refs = world.refs[world.private_agent]
    await _beat(world, session_id, turn, references=refs)

    async def admit():
        return await world.admission.admit(
            envelope=world.envelope(world.alice),
            session_id=session_id,
            agent_artifact_id=world.private_agent,
            boundary="m3-counts",
        )

    await admit()
    await _counted(round_trips, admit)
    assert len(round_trips.sends) == 1, round_trips.sends


# -- (c) heartbeats ------------------------------------------------------------------------


async def test_a_steady_beat_adds_no_round_trip(world, round_trips):
    """M2's steady beat sent 15 round trips (after/LATENCY.md). M3 adds the admission
    record read and removes the separate supersession GET: the tombstone check runs in
    the beat's bind script."""
    refs = world.refs[world.shared_agent]
    session_id, turn = _sid(), str(uuid4())
    await _beat(world, session_id, turn, references=refs)
    await _beat(world, session_id, turn, references=refs)

    result = await _counted(
        round_trips, lambda: _beat(world, session_id, turn, references=refs)
    )
    assert result.is_current_turn
    standalone_tombstone_reads = [
        send
        for send in round_trips.touching(b"superseded:")
        if b"AGENTA_BEAT_BIND_TURN" not in send
    ]
    assert standalone_tombstone_reads == []
    assert round_trips.touching(b"sharing_") == []
    assert len(round_trips.sends) == M2_STEADY_BEAT_ROUND_TRIPS, [
        send[:80] for send in round_trips.sends
    ]


async def test_a_checked_beat_writes_its_admission_inside_the_bind_script(
    world, round_trips
):
    refs = world.refs[world.shared_agent]
    session_id, turn = _sid(), str(uuid4())

    await _counted(round_trips, lambda: _beat(world, session_id, turn, references=refs))
    writes = round_trips.touching(b"admitted:")
    standalone_set = [w for w in writes if b"\r\nSET\r\n" in w]
    assert standalone_set == [], writes


# -- (e) a human session list --------------------------------------------------------------


async def test_a_human_session_list_reads_grants_in_the_decision_trip(
    world, round_trips
):
    from oss.src.core.sharing.service import (
        get_sharing_service,
        prefetch_session_read_scope,
    )

    async def list_scope():
        with _Memo():
            prefetch_session_read_scope(
                project_id=world.project_id, principal=_human(world.bob)
            )
            decision = await world.access.decide(
                authority=None,
                principal=_human(world.bob),
                action=Permission.VIEW_SESSIONS,
                project_id=world.project_id,
            )
            scope = await get_sharing_service().session_read_scope(
                project_id=world.project_id, principal=_human(world.bob)
            )
            return decision, scope

    await list_scope()
    decision, _ = await _counted(round_trips, list_scope)
    assert decision.allowed
    assert len(round_trips.sends) == 1, round_trips.sends
