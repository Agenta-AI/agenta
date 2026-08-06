"""S7 local-multi-runner-fails-loudly: the atomic non-stealing owner claim.

`claim_owner` (dbs/redis/sessions/locks.py) runs CLAIM_OWNER_LUA against the `owner:session:<id>`
key: it takes ownership iff the key is absent or already the caller's, and always returns the
ACTUAL owner (never a second racy read). The core guarantee under test is that a second replica
can NEVER steal an owner key a first replica already holds — it just learns who won.

Preferred: real fakeredis.aioredis, mirroring test_evaluation_runtime_locks.py's fixture style
(LockEngine's `_client` patched to the fakeredis client) — but fakeredis only executes Lua via
`.eval` when its optional `lupa` dependency is installed, and this environment does not have it
(`ResponseError: unknown command 'eval'`). Falling back to a tiny hand-rolled async fake client
that implements exactly `.get`/`.set`/`.expire`/`.ttl`/`.eval` with the same semantics real Redis
would give CLAIM_OWNER_LUA, so `claim_owner` itself (the code under test) is exercised unchanged.

Run: cd api && uv run --no-sync python -m pytest oss/tests/pytest/unit/sessions/test_owner_claim.py -x -q
"""

from unittest.mock import patch
from uuid import uuid4

import pytest
import pytest_asyncio


class _FakeEvalRedis:
    """Hand-rolled fallback: only used because this env's fakeredis lacks `lupa` (no real EVAL).

    Implements CLAIM_OWNER_LUA's exact semantics (contract.py) plus the plain GET/SET/EXPIRE/TTL
    ops `locks.py` also calls, so `claim_owner`/`get_owner` run unmodified against this fake.
    """

    def __init__(self):
        self._values: dict[str, bytes] = {}
        self._ttl: dict[str, int] = {}

    @staticmethod
    def _norm(key) -> str:
        """redis-py encodes str keys to bytes on the wire; a real server sees one identity
        for `"k"` and `b"k"`. Normalize here so claim_owner's bytes-key eval() calls and
        get_owner's plain-str calls (locks.py never encodes the key itself, only the value —
        see test_orphan_sweep_clears_redis.py's fake) hit the same entry."""
        return key.decode() if isinstance(key, (bytes, bytearray)) else key

    @staticmethod
    def _val(value) -> bytes:
        return value.encode() if isinstance(value, str) else value

    async def get(self, key):
        return self._values.get(self._norm(key))

    async def set(self, key, value, nx=False, ex=None):
        key = self._norm(key)
        if nx and key in self._values:
            return None
        self._values[key] = self._val(value)
        if ex is not None:
            self._ttl[key] = ex
        return True

    async def expire(self, key, ttl):
        key = self._norm(key)
        if key not in self._values:
            return False
        self._ttl[key] = ttl
        return True

    async def ttl(self, key):
        key = self._norm(key)
        return self._ttl.get(key, -1) if key in self._values else -2

    async def eval(self, script, numkeys, *keys_and_args):
        assert numkeys == 1
        key = self._norm(keys_and_args[0])
        argv = keys_and_args[1:]
        from oss.src.dbs.redis.sessions.contract import (
            CLAIM_OWNER_LUA,
            RELEASE_IF_OWNER_LUA,
        )

        if script == CLAIM_OWNER_LUA:
            replica_id, ex = argv
            current = self._values.get(key)
            replica_id_bytes = self._val(replica_id)
            if current is None or current == replica_id_bytes:
                await self.set(key, replica_id_bytes, ex=int(ex))
                return replica_id_bytes
            return current
        if script == RELEASE_IF_OWNER_LUA:
            (owner,) = argv
            current = self._values.get(key)
            if current == self._val(owner):
                self._values.pop(key, None)
                self._ttl.pop(key, None)
                return 1
            return 0
        raise NotImplementedError(f"unsupported script in fake eval: {script!r}")

    async def aclose(self):
        pass


_PROJECT_ID = "proj-owner-1"


@pytest_asyncio.fixture
async def fake_redis():
    from oss.src.dbs.redis.shared.engine import LockEngine

    client = _FakeEvalRedis()
    engine = LockEngine()

    with patch.object(engine, "_client", return_value=client):
        yield engine, client

    await client.aclose()


def _session_id() -> str:
    return f"sess-{uuid4()}"


@pytest.mark.asyncio
async def test_claim_owner_on_unowned_session_wins_and_sets_key(fake_redis):
    from oss.src.dbs.redis.sessions.locks import claim_owner, get_owner

    engine, _client = fake_redis
    session_id = _session_id()

    owner = await claim_owner(
        engine, project_id=_PROJECT_ID, session_id=session_id, replica_id="replica-a"
    )

    assert owner == "replica-a"
    assert (
        await get_owner(engine, project_id=_PROJECT_ID, session_id=session_id)
        == "replica-a"
    )


@pytest.mark.asyncio
async def test_claim_owner_same_replica_refreshes_without_stealing(fake_redis):
    from oss.src.dbs.redis.sessions.contract import OWNER_TTL_SECONDS, owner_key
    from oss.src.dbs.redis.sessions.locks import claim_owner

    engine, client = fake_redis
    session_id = _session_id()

    first = await claim_owner(
        engine, project_id=_PROJECT_ID, session_id=session_id, replica_id="replica-a"
    )
    assert first == "replica-a"

    key = owner_key(_PROJECT_ID, session_id)
    await client.expire(key, 5)  # simulate TTL having ticked down since first claim

    second = await claim_owner(
        engine, project_id=_PROJECT_ID, session_id=session_id, replica_id="replica-a"
    )

    assert second == "replica-a"
    ttl = await client.ttl(key)
    assert ttl > 5, (
        "refresh must reset the TTL back to OWNER_TTL_SECONDS, not leave it decayed"
    )
    assert ttl <= OWNER_TTL_SECONDS


@pytest.mark.asyncio
async def test_claim_owner_different_replica_does_not_steal(fake_redis):
    """The core S7 guarantee: a second replica's claim on an owned session never steals it."""
    from oss.src.dbs.redis.sessions.locks import claim_owner, get_owner

    engine, _client = fake_redis
    session_id = _session_id()

    original = await claim_owner(
        engine, project_id=_PROJECT_ID, session_id=session_id, replica_id="replica-a"
    )
    assert original == "replica-a"

    challenger = await claim_owner(
        engine, project_id=_PROJECT_ID, session_id=session_id, replica_id="replica-b"
    )

    assert challenger == "replica-a", (
        "the challenger must learn the ORIGINAL owner, not itself"
    )
    assert (
        await get_owner(engine, project_id=_PROJECT_ID, session_id=session_id)
        == "replica-a"
    ), "the owner key must still hold the original owner after a losing claim"


@pytest.mark.asyncio
async def test_claim_owner_sets_ttl_to_owner_ttl_seconds(fake_redis):
    from oss.src.dbs.redis.sessions.contract import OWNER_TTL_SECONDS, owner_key
    from oss.src.dbs.redis.sessions.locks import claim_owner

    engine, client = fake_redis
    session_id = _session_id()

    await claim_owner(
        engine, project_id=_PROJECT_ID, session_id=session_id, replica_id="replica-a"
    )

    ttl = await client.ttl(owner_key(_PROJECT_ID, session_id))
    assert 0 < ttl <= OWNER_TTL_SECONDS


@pytest.mark.asyncio
async def test_claim_owner_return_type_is_str(fake_redis):
    """Lua EVAL returns bytes via redis-py; claim_owner must decode before returning."""
    from oss.src.dbs.redis.sessions.locks import claim_owner

    engine, _client = fake_redis
    session_id = _session_id()

    owner = await claim_owner(
        engine, project_id=_PROJECT_ID, session_id=session_id, replica_id="replica-a"
    )
    assert isinstance(owner, str)

    # A losing claim's return value (the pre-existing GET result) must also decode to str.
    owner2 = await claim_owner(
        engine, project_id=_PROJECT_ID, session_id=session_id, replica_id="replica-b"
    )
    assert isinstance(owner2, str)
