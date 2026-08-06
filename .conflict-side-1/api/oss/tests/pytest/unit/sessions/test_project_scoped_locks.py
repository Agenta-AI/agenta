"""PY-SEC-1: the Redis coordination plane is project-scoped.

`session_id` is caller-supplied and Postgres uniqueness is (project_id, session_id), so two
projects may legitimately hold the same one. Before the fix every lock key was
`<kind>:session:<session_id>` with no project segment, so a caller authorized only in project A
could kill, steal, or read project B's live turn by supplying B's session_id.

These tests pin the boundary at the lock layer: identical session_ids in different projects must
never touch each other's keys. Uses the hand-rolled fake from test_owner_claim.py's rationale
(this env's fakeredis has no `lupa`, so no real EVAL).
"""

from unittest.mock import patch

import pytest
import pytest_asyncio

from oss.src.dbs.redis.sessions.contract import (
    alive_key,
    attached_key,
    displaced_channel,
    owner_key,
    running_key,
)
from oss.src.dbs.redis.sessions.locks import (
    acquire_alive,
    claim_owner,
    force_cancel_alive,
    force_clear_owner,
    get_alive_owner,
    get_owner,
    get_session_liveness,
)


_SESSION = "session_shared-id"  # the SAME id in both projects — the whole point
_TENANT_A = "proj-aaaa"
_TENANT_B = "proj-bbbb"


class _FakeRedis:
    """GET/SET/DELETE/EXPIRE/TTL + CLAIM_OWNER_LUA / RELEASE_IF_OWNER_LUA semantics."""

    def __init__(self):
        self._values: dict[str, bytes] = {}
        self._ttl: dict[str, int] = {}

    @staticmethod
    def _norm(key) -> str:
        return key.decode() if isinstance(key, (bytes, bytearray)) else key

    @staticmethod
    def _val(value) -> bytes:
        return value.encode() if isinstance(value, str) else value

    async def get(self, key):
        return self._values.get(self._norm(key))

    async def set(self, key, value, nx=False, ex=None):
        k = self._norm(key)
        if nx and k in self._values:
            return None
        self._values[k] = self._val(value)
        if ex:
            self._ttl[k] = ex
        return True

    async def delete(self, key):
        k = self._norm(key)
        existed = k in self._values
        self._values.pop(k, None)
        self._ttl.pop(k, None)
        return 1 if existed else 0

    async def expire(self, key, ttl):
        k = self._norm(key)
        if k not in self._values:
            return False
        self._ttl[k] = ttl
        return True

    async def ttl(self, key):
        return self._ttl.get(self._norm(key), -2)

    async def publish(self, channel, payload):
        return 0

    async def eval(self, script, numkeys, *keys_and_args):
        key = self._norm(keys_and_args[0])
        argv = [self._norm(a) for a in keys_and_args[numkeys:]]
        current = self._values.get(key)
        current_s = current.decode() if current else None
        if "DEL" in script:  # RELEASE_IF_OWNER_LUA
            if current_s == argv[0]:
                del self._values[key]
                return 1
            return 0
        # CLAIM_OWNER_LUA
        if current_s is None or current_s == argv[0]:
            self._values[key] = argv[0].encode()
            self._ttl[key] = int(argv[1])
            return argv[0]
        return current_s

    async def aclose(self):
        return None


@pytest_asyncio.fixture
async def engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


# --------------------------------------------------------------------------- #
# Key builders carry the project segment
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "builder",
    [alive_key, running_key, attached_key, owner_key, displaced_channel],
)
def test_same_session_in_two_projects_yields_distinct_keys(builder):
    assert builder(_TENANT_A, _SESSION) != builder(_TENANT_B, _SESSION)
    assert _TENANT_A in builder(_TENANT_A, _SESSION)


# --------------------------------------------------------------------------- #
# The IDOR itself, at the lock layer
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_tenant_cannot_kill_another_tenants_alive_lock(engine):
    # B holds a live turn.
    await acquire_alive(
        engine, project_id=_TENANT_B, session_id=_SESSION, turn_id="turn-b"
    )
    # A force-cancels the SAME session_id in its own project.
    await force_cancel_alive(engine, project_id=_TENANT_A, session_id=_SESSION)

    assert (
        await get_alive_owner(engine, project_id=_TENANT_B, session_id=_SESSION)
    ) == "turn-b", "tenant A's kill collapsed tenant B's live turn"


@pytest.mark.asyncio
async def test_tenant_cannot_read_another_tenants_liveness(engine):
    await acquire_alive(
        engine, project_id=_TENANT_B, session_id=_SESSION, turn_id="turn-b"
    )

    seen_by_a = await get_session_liveness(
        engine, project_id=_TENANT_A, session_id=_SESSION
    )
    assert seen_by_a["alive"] is False, "tenant A observed tenant B's live session"

    seen_by_b = await get_session_liveness(
        engine, project_id=_TENANT_B, session_id=_SESSION
    )
    assert seen_by_b["alive"] is True


@pytest.mark.asyncio
async def test_tenant_cannot_steal_another_tenants_owner_affinity(engine):
    await claim_owner(
        engine, project_id=_TENANT_B, session_id=_SESSION, replica_id="replica-b"
    )

    # A claims the same session_id: it wins in ITS OWN namespace, not B's.
    won_by_a = await claim_owner(
        engine, project_id=_TENANT_A, session_id=_SESSION, replica_id="replica-a"
    )
    assert won_by_a == "replica-a"
    assert (
        await get_owner(engine, project_id=_TENANT_B, session_id=_SESSION)
    ) == "replica-b"


@pytest.mark.asyncio
async def test_tenant_cannot_clear_another_tenants_owner(engine):
    await claim_owner(
        engine, project_id=_TENANT_B, session_id=_SESSION, replica_id="replica-b"
    )
    await force_clear_owner(engine, project_id=_TENANT_A, session_id=_SESSION)

    assert (
        await get_owner(engine, project_id=_TENANT_B, session_id=_SESSION)
    ) == "replica-b"


# --------------------------------------------------------------------------- #
# kill's owner drop (the 120s lockout)
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_force_clear_owner_frees_affinity_for_any_replica(engine):
    await claim_owner(
        engine, project_id=_TENANT_A, session_id=_SESSION, replica_id="replica-a"
    )
    # A non-stealing claim by another replica loses while the key survives.
    assert (
        await claim_owner(
            engine, project_id=_TENANT_A, session_id=_SESSION, replica_id="replica-b"
        )
    ) == "replica-a"

    previous = await force_clear_owner(
        engine, project_id=_TENANT_A, session_id=_SESSION
    )
    assert previous == "replica-a"

    # After a kill, the next replica may take it immediately (no OWNER_TTL wait).
    assert (
        await claim_owner(
            engine, project_id=_TENANT_A, session_id=_SESSION, replica_id="replica-b"
        )
    ) == "replica-b"
