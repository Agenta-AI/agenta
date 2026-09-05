"""Cache and lock keys must not merge two tenants that share an id suffix.

Scope segments used to carry only the last 12 characters of an id, so two projects
whose ids ended the same way shared every cache entry in every namespace — including
`check_permissions` and `check_action_access`, which decide authorization (#6166).

The lock tests use a real in-memory fakeredis instance so they run without an external
Redis process; they skip when `fakeredis` is not installed.
"""

import asyncio
from unittest.mock import patch
from uuid import uuid4

import pytest
import pytest_asyncio

from oss.src.utils.caching import _pack, _scope, AGENTA_CACHE_SCOPE_WIDTH
from oss.src.utils import locking


# Two distinct UUID4s contrived to end in the same 12 characters: the collision the old
# truncation produced. Server-generated ids make this astronomically unlikely rather than
# impossible, and the consequence is a cross-tenant read.
COLLIDING_SUFFIX = "b2c3d4e5f6a7"
PROJECT_A = f"11111111-1111-4111-8111-1111{COLLIDING_SUFFIX}"
PROJECT_B = f"22222222-2222-4222-8222-2222{COLLIDING_SUFFIX}"

USER_A = f"33333333-3333-4333-8333-3333{COLLIDING_SUFFIX}"
USER_B = f"44444444-4444-4444-8444-4444{COLLIDING_SUFFIX}"


def _key(namespace="check_action_access", project_id=None, user_id=None, **kwargs):
    return _pack(
        namespace=namespace,
        key="read",
        project_id=project_id,
        user_id=user_id,
        **kwargs,
    )


# KEY SHAPE --------------------------------------------------------------------


def test_projects_sharing_an_id_suffix_do_not_share_a_cache_key():
    assert _key(project_id=PROJECT_A) != _key(project_id=PROJECT_B)


def test_users_sharing_an_id_suffix_do_not_share_a_cache_key():
    assert _key(project_id=PROJECT_A, user_id=USER_A) != _key(
        project_id=PROJECT_A, user_id=USER_B
    )


def test_the_whole_id_is_in_the_key():
    assert PROJECT_A in _key(project_id=PROJECT_A)
    assert USER_A in _key(project_id=PROJECT_A, user_id=USER_A)


def test_an_invalidation_pattern_is_scoped_to_one_project():
    """`invalidate_cache` without a key scans a pattern; it must not span both projects."""
    pattern = _pack(project_id=PROJECT_A, pattern=True)

    assert PROJECT_A in pattern
    assert PROJECT_B not in pattern


def test_an_invalidation_pattern_still_wildcards_an_absent_user():
    """Carrying the whole id must not cost the user wildcard a pattern relies on.

    A pattern with no user scope is meant to match every user, which the fixed-width
    padded segment cannot express.
    """
    assert "u:*" in _pack(project_id=PROJECT_A, pattern=True)
    # A named user is still scoped, pattern or not.
    assert "u:*" not in _pack(project_id=PROJECT_A, user_id=USER_A, pattern=True)


def test_a_short_or_absent_id_keeps_its_historical_segment():
    """Only ids that were being cut change shape; everything else is untouched."""
    assert _scope(None) == "-" * AGENTA_CACHE_SCOPE_WIDTH
    assert _scope("") == "-" * AGENTA_CACHE_SCOPE_WIDTH
    assert _scope("abc") == "abc" + "-" * (AGENTA_CACHE_SCOPE_WIDTH - 3)

    exactly_wide = "a" * AGENTA_CACHE_SCOPE_WIDTH
    assert _scope(exactly_wide) == exactly_wide
    # At or below the width, truncating was already a no-op, so both shapes agree.
    assert _scope(exactly_wide, legacy_truncated=True) == _scope(exactly_wide)


def test_the_legacy_shape_still_collides():
    """The opt-in legacy shape reproduces the bug — that is what makes it transitional."""
    assert _key(project_id=PROJECT_A, legacy_truncated_scope=True) == _key(
        project_id=PROJECT_B, legacy_truncated_scope=True
    )


# LOCKS ACROSS A ROLLING DEPLOY ------------------------------------------------


@pytest_asyncio.fixture
async def fake_redis():
    """Point the lock engine at an in-memory redis, as `test_evaluation_runtime_locks`.

    fakeredis executes Lua only with the optional `lupa` backend, which is not a
    dependency here, so the two ownership scripts are supplied as an equivalent shim.
    Everything else — `acquire_lock`, `renew_lock`, `release_lock` — runs as written.
    """
    fakeredis = pytest.importorskip("fakeredis")
    aioredis = pytest.importorskip("fakeredis.aioredis")
    engine = pytest.importorskip("oss.src.dbs.redis.shared.engine")

    server = fakeredis.FakeServer()
    client = aioredis.FakeRedis(server=server, decode_responses=False)

    async def _eval(script, numkeys, *args):
        """`GET`, compare against the owner token, then `EXPIRE` or `DEL`."""
        lock_key, owner, *rest = args

        if await client.get(lock_key) != owner.encode():
            return 0

        if script == locking._LOCK_RENEW_IF_OWNER_SCRIPT:
            return int(bool(await client.expire(lock_key, int(rest[0]))))

        return int(bool(await client.delete(lock_key)))

    lock_engine = engine.get_lock_engine()

    with (
        patch.object(lock_engine, "_client", return_value=client),
        # `LockEngine.__getattr__` forwards to the client; a real attribute shadows it.
        patch.object(lock_engine, "eval", _eval, create=True),
    ):
        yield client

    await client.aclose()


async def test_two_ordinary_projects_do_not_share_a_lock(fake_redis):
    project_a, project_b = str(uuid4()), str(uuid4())

    assert (
        await locking.acquire_lock(namespace="eval", key="run", project_id=project_a)
        is not None
    )
    assert (
        await locking.acquire_lock(namespace="eval", key="run", project_id=project_b)
        is not None
    )


async def test_colliding_projects_still_share_a_lock_while_the_cover_lasts(fake_redis):
    """A deliberate trade-off, confined to the lock namespace and to one release.

    Covering the previous release's key means two projects whose ids share a suffix keep
    serializing against each other on locks. Dropping the cover instead would let pods on
    either side of a rolling deploy into the same critical section, and losing mutual
    exclusion is worse than two unrelated tenants queueing. Removing the transitional
    cover (see `locking`) is what closes this last case.

    Cache keys are separated immediately either way — that is where the permission caches
    live, and it is the part with a security consequence.
    """
    assert _key(project_id=PROJECT_A) != _key(project_id=PROJECT_B)

    held = await locking.acquire_lock(namespace="eval", key="run", project_id=PROJECT_A)
    assert held is not None

    assert (
        await locking.acquire_lock(namespace="eval", key="run", project_id=PROJECT_B)
        is None
    )


async def test_a_lock_still_excludes_the_same_project(fake_redis):
    held = await locking.acquire_lock(namespace="eval", key="run", project_id=PROJECT_A)
    assert held is not None

    assert (
        await locking.acquire_lock(namespace="eval", key="run", project_id=PROJECT_A)
        is None
    )

    await locking.release_lock(
        namespace="eval", key="run", project_id=PROJECT_A, owner=held
    )
    assert (
        await locking.acquire_lock(namespace="eval", key="run", project_id=PROJECT_A)
        is not None
    )


async def test_a_holder_on_the_previous_release_still_blocks_this_one(fake_redis):
    """The rolling-deploy case: an old pod holds only the truncated key.

    Without the transitional cover this is the window where two pods both believe they
    hold the same logical lock.
    """
    legacy_key = _pack(
        namespace="lock:eval",
        key="run",
        project_id=PROJECT_A,
        legacy_truncated_scope=True,
    )
    # Exactly what a pod running the previous release writes.
    await fake_redis.set(legacy_key, b"old-pod-owner", nx=True, ex=30)

    assert (
        await locking.acquire_lock(namespace="eval", key="run", project_id=PROJECT_A)
        is None
    )


async def test_a_blocked_acquire_does_not_strand_the_legacy_key(fake_redis):
    """Losing the race on the primary key must not leave the legacy one held.

    The legacy key is claimed first, so a caller that then loses the primary has to give
    it back — otherwise a failed acquire would block the section for the full TTL.
    """
    lock_key, legacy_key = locking._lock_keys(
        namespace="eval", key="run", project_id=PROJECT_A
    )
    assert legacy_key is not None

    # Someone already holds the primary; the caller below will claim the legacy key,
    # fail on the primary, and must then release what it took.
    await fake_redis.set(lock_key, b"another-owner", nx=True, ex=30)

    assert (
        await locking.acquire_lock(namespace="eval", key="run", project_id=PROJECT_A)
        is None
    )
    assert await fake_redis.get(legacy_key) is None


async def test_release_clears_both_generations(fake_redis):
    lock_key, legacy_key = locking._lock_keys(
        namespace="eval", key="run", project_id=PROJECT_A
    )
    assert legacy_key is not None

    owner = await locking.acquire_lock(
        namespace="eval", key="run", project_id=PROJECT_A
    )
    assert owner is not None
    assert await fake_redis.get(legacy_key) is not None

    await locking.release_lock(
        namespace="eval", key="run", project_id=PROJECT_A, owner=owner
    )

    assert await fake_redis.get(lock_key) is None
    assert await fake_redis.get(legacy_key) is None


async def test_a_short_scope_takes_only_one_key(fake_redis):
    """When the two shapes coincide there is no second key — and no double SET NX.

    Claiming the same key twice with NX would fail the second call and make every
    acquire in this shape look blocked.
    """
    short_project = "abc"
    lock_key, legacy_key = locking._lock_keys(
        namespace="eval", key="run", project_id=short_project
    )
    assert legacy_key is None

    assert (
        await locking.acquire_lock(
            namespace="eval", key="run", project_id=short_project
        )
        is not None
    )
    assert await fake_redis.get(lock_key) is not None


async def test_renew_keeps_both_generations_alive(fake_redis):
    lock_key, legacy_key = locking._lock_keys(
        namespace="eval", key="run", project_id=PROJECT_A
    )
    assert legacy_key is not None

    owner = await locking.acquire_lock(
        namespace="eval", key="run", project_id=PROJECT_A, ttl=5
    )
    assert owner is not None

    assert await locking.renew_lock(
        namespace="eval", key="run", project_id=PROJECT_A, ttl=90, owner=owner
    )

    # A legacy key left on the original TTL would lapse mid-section and let a pod on the
    # previous release in.
    assert await fake_redis.ttl(lock_key) > 5
    assert await fake_redis.ttl(legacy_key) > 5


async def test_renew_fails_when_the_legacy_key_is_gone(fake_redis):
    """A lapsed legacy key breaks mutual exclusion even while the primary survives.

    Renewal used to report the primary's result alone, so a holder kept working inside
    the section believing the lock was safe while a pod on the previous release could
    acquire the now-missing legacy key and enter it too.
    """
    lock_key, legacy_key = locking._lock_keys(
        namespace="eval", key="run", project_id=PROJECT_A
    )
    assert legacy_key is not None

    owner = await locking.acquire_lock(
        namespace="eval", key="run", project_id=PROJECT_A, ttl=5
    )
    assert owner is not None

    # The legacy key expires or is evicted while the primary is still held.
    await fake_redis.delete(legacy_key)

    assert not await locking.renew_lock(
        namespace="eval", key="run", project_id=PROJECT_A, ttl=90, owner=owner
    )

    # The primary is still renewed, so the caller can finish and release cleanly rather
    # than having the section pulled out from under it twice over.
    assert await fake_redis.ttl(lock_key) > 5


async def test_acquire_releases_the_legacy_key_when_the_primary_set_raises(fake_redis):
    """A failed primary claim must not strand the legacy key for its whole TTL.

    The legacy key is taken first, so if claiming the primary raises — or the task is
    cancelled between the two — the section goes to nobody while a key that blocks both
    generations stays held.
    """
    lock_key, legacy_key = locking._lock_keys(
        namespace="eval", key="run", project_id=PROJECT_A
    )
    assert legacy_key is not None

    real_set = fake_redis.set

    async def fail_on_primary(name, *args, **kwargs):
        if name == lock_key:
            raise RuntimeError("redis went away")
        return await real_set(name, *args, **kwargs)

    with patch.object(locking._lock_engine, "set", side_effect=fail_on_primary):
        assert (
            await locking.acquire_lock(
                namespace="eval", key="run", project_id=PROJECT_A, ttl=90
            )
            is None
        )

    assert await fake_redis.get(legacy_key) is None
    assert await fake_redis.get(lock_key) is None

    # The section is free, so the next caller gets it rather than waiting out the TTL.
    assert (
        await locking.acquire_lock(
            namespace="eval", key="run", project_id=PROJECT_A, ttl=5
        )
        is not None
    )


async def test_acquire_releases_the_legacy_key_when_cancelled_mid_claim(fake_redis):
    """Cancellation between Redis applying the SET and the reply arriving.

    The claim has taken effect but the caller never learns it, so a flag set after the
    await would never record the obligation and the key would sit held for its whole
    TTL — blocking pods on both releases while the section went to nobody.
    """
    lock_key, legacy_key = locking._lock_keys(
        namespace="eval", key="run", project_id=PROJECT_A
    )
    assert legacy_key is not None

    real_set = fake_redis.set
    applied = asyncio.Event()

    async def set_then_suspend(name, *args, **kwargs):
        result = await real_set(name, *args, **kwargs)
        if name == legacy_key:
            # Redis has the key; the reply has not been delivered yet.
            applied.set()
            await asyncio.sleep(3600)
        return result

    with patch.object(locking._lock_engine, "set", side_effect=set_then_suspend):
        task = asyncio.create_task(
            locking.acquire_lock(
                namespace="eval", key="run", project_id=PROJECT_A, ttl=90
            )
        )
        await asyncio.wait_for(applied.wait(), timeout=5)
        assert await fake_redis.get(legacy_key) is not None

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    # Cleanup ran despite the caller never seeing the reply.
    assert await fake_redis.get(legacy_key) is None
    assert await fake_redis.get(lock_key) is None

    assert (
        await locking.acquire_lock(
            namespace="eval", key="run", project_id=PROJECT_A, ttl=5
        )
        is not None
    )


async def test_a_refused_legacy_claim_leaves_the_holders_key_alone(fake_redis):
    """Marking the obligation before the await must not delete someone else's key.

    `_release_if_owner` is ownership checked, so the broader cleanup window is safe.
    """
    _, legacy_key = locking._lock_keys(
        namespace="eval", key="run", project_id=PROJECT_A
    )
    assert legacy_key is not None

    await fake_redis.set(legacy_key, b"another-pod-owner", nx=True, ex=30)

    assert (
        await locking.acquire_lock(namespace="eval", key="run", project_id=PROJECT_A)
        is None
    )

    # Still the other pod's, untouched.
    assert await fake_redis.get(legacy_key) == b"another-pod-owner"


async def test_renew_fails_when_the_primary_key_is_gone(fake_redis):
    """The mirror case: the primary lapsing must not be masked by a live legacy key."""
    lock_key, legacy_key = locking._lock_keys(
        namespace="eval", key="run", project_id=PROJECT_A
    )
    assert legacy_key is not None

    owner = await locking.acquire_lock(
        namespace="eval", key="run", project_id=PROJECT_A, ttl=5
    )
    assert owner is not None

    await fake_redis.delete(lock_key)

    assert not await locking.renew_lock(
        namespace="eval", key="run", project_id=PROJECT_A, ttl=90, owner=owner
    )
