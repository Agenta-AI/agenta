"""A session with no row never waits on the cache lock (M3 gate, latency finding 1).

Before the fix, `sharing_session_access` read with `get_cache(retry=True)`: a miss took
`SET lock::<key> NX` (a lock that lives 1000 s, an old `caching.py` bug kept out of M3),
and a session with no row was never cached, so every later reader of a new session id
(the services' parallel `GET /sessions/streams/` and `POST /sessions/turns/query` on the
first send) failed the lock and slept through 4 retries (about 1.3 s).

The fix: the sharing reads never take the lock (`retry=False`), and "no row" is cached as
a negative entry with the same TTL, written with `SET NX`; the insert that creates the
row writes the positive entry with a plain `SET`, so a reader racing the insert can never
leave a stale "no row" behind.
"""

import asyncio
from uuid import uuid4

import pytest

import oss.src.utils.caching as caching
from oss.src.core.access.dtos import (
    Permission,
    PrincipalKind,
    PrincipalRef,
    ResourceKind,
    ResourceRef,
)
from oss.src.core.sharing.dtos import AccessPolicy, Visibility
from oss.tests.pytest.utils.sharing import SharingWorld


class _FakeCacheEngine:
    """The Redis calls the cache helpers make, recorded, over a dict."""

    def __init__(self) -> None:
        self.values: dict = {}
        self.calls: list = []

    async def get(self, name):
        self.calls.append(("GET", name))
        return self.values.get(name)

    async def mget(self, names):
        self.calls.append(("MGET", tuple(names)))
        return [self.values.get(name) for name in names]

    async def set(self, name, value, nx=False, ex=None, px=None):
        self.calls.append(("SET", name, "NX" if nx else ""))
        if nx and name in self.values:
            return None
        self.values[name] = value if isinstance(value, bytes) else str(value).encode()
        return True

    async def expire(self, name, ttl):
        self.calls.append(("EXPIRE", name))
        return True

    async def delete(self, *names):
        self.calls.append(("DEL",) + tuple(names))
        for name in names:
            self.values.pop(name, None)
        return len(names)

    def locks(self):
        return [
            c for c in self.calls if c[0] == "SET" and str(c[1]).startswith("lock::")
        ]


@pytest.fixture
def cache(monkeypatch):
    engine = _FakeCacheEngine()
    monkeypatch.setattr(caching, "_cache_engine", engine)
    monkeypatch.setattr(caching.env.agenta.api.caching, "enabled", True, raising=False)
    slept = []

    async def no_sleep(*args, **kwargs):
        slept.append(args)

    monkeypatch.setattr(caching, "_delay", no_sleep)
    engine.slept = slept
    return engine


def _session(session_id):
    return ResourceRef(kind=ResourceKind.SESSION, id=session_id)


async def _evaluate(world, user_id, session_id, action=Permission.VIEW_SESSIONS):
    return await world.service.evaluate(
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id),
        action=action,
        project_id=world.project_id,
        resource=_session(session_id),
    )


async def test_a_missing_session_read_takes_no_lock_and_never_sleeps(cache):
    world = SharingWorld()
    alice = world.add_member(uuid4())
    session_id = f"s-{uuid4().hex}"

    # The services' two parallel reads of a new session id, then a third one.
    await asyncio.gather(
        _evaluate(world, alice, session_id),
        _evaluate(world, alice, session_id, Permission.RUN_SESSIONS),
    )
    await _evaluate(world, alice, session_id)

    assert cache.locks() == []
    assert cache.slept == []


async def test_no_row_is_cached_so_a_missing_session_is_read_once(cache):
    world = SharingWorld()
    alice = world.add_member(uuid4())
    session_id = f"s-{uuid4().hex}"

    await _evaluate(world, alice, session_id)
    reads_after_first = world.dao.reads.count("fetch_session_policy")
    await _evaluate(world, alice, session_id)
    await _evaluate(world, alice, session_id, Permission.RUN_SESSIONS)

    assert reads_after_first == 1
    assert world.dao.reads.count("fetch_session_policy") == 1
    negative = [
        c
        for c in cache.calls
        if c[0] == "SET" and "sharing_session_access" in str(c[1])
    ]
    assert negative and negative[0][2] == "NX"


async def test_the_insert_replaces_a_cached_no_row_with_the_row(cache):
    """A reader caches "no row"; the insert that creates the private row writes its
    entry after the commit, so the next read sees the private row and refuses Bob."""
    from oss.src.core.sharing.service import cache_created_session_access

    world = SharingWorld()
    alice = world.add_member(uuid4())
    bob = world.add_member(uuid4())
    session_id = f"s-{uuid4().hex}"
    assert (
        await _evaluate(world, bob, session_id) is None
    )  # no row: the route's not-found path

    private = AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=alice)
    state = world.dao.add_session(
        project_id=world.project_id, policy=private, session_id=session_id
    )
    await cache_created_session_access(
        project_id=world.project_id,
        session_id=session_id,
        stream_id=state.stream_id,
        policy=private,
    )

    assert await _evaluate(world, bob, session_id) is not None  # RESOURCE_DENIED
    assert await _evaluate(world, alice, session_id) is None


async def test_a_reader_racing_the_insert_leaves_no_stale_no_row(cache):
    """The reader read "no row" from Postgres, the insert committed and wrote the row's
    entry, then the reader writes its "no row": `SET NX` loses, the row's entry stays."""
    from oss.src.core.sharing.service import cache_created_session_access

    world = SharingWorld()
    alice = world.add_member(uuid4())
    bob = world.add_member(uuid4())
    session_id = f"s-{uuid4().hex}"
    private = AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=alice)

    original = world.dao.fetch_session_policy

    async def racing_fetch(**kwargs):
        answer = await original(**kwargs)  # no row yet
        state = world.dao.add_session(
            project_id=world.project_id, policy=private, session_id=session_id
        )
        await cache_created_session_access(
            project_id=world.project_id,
            session_id=session_id,
            stream_id=state.stream_id,
            policy=private,
        )
        world.dao.fetch_session_policy = original
        return answer

    world.dao.fetch_session_policy = racing_fetch
    await _evaluate(world, bob, session_id)

    assert await _evaluate(world, bob, session_id) is not None  # the row's entry won
