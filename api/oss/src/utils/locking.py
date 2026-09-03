"""Distributed locks backed by Redis (volatile).

Split out of `caching.py`: caching and locking share the same volatile Redis but
use separate clients with different socket timeouts (locks may block, so they use
the longer-timeout `LockEngine`). Lock keys are namespaced the same way as cache
keys via `caching._pack`, so a lock and its related cache entries sort together.
"""

from typing import Optional, Union
from uuid import uuid4

from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import _pack
from oss.src.dbs.redis.shared.engine import get_lock_engine

log = get_module_logger(__name__)

AGENTA_LOCK_TTL = 15  # 15 seconds

LOCK_DEBUG = False

_lock_engine = get_lock_engine()


# Ownership-safe lock scripts. Owner token must match to renew/release.
_LOCK_RENEW_IF_OWNER_SCRIPT = """
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("EXPIRE", KEYS[1], tonumber(ARGV[2]))
end
return 0
"""

_LOCK_RELEASE_IF_OWNER_SCRIPT = """
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
end
return 0
"""


# TRANSITIONAL: SPANNING THE FULL-PROJECT-ID DEPLOY -----------------------------
#
# Scope segments in cache and lock keys used to carry only the last 12 characters of
# an id (see `caching._scope`). During a rolling deploy, pods still on the previous
# release take the truncated key, so a lock held only under the full-id key would not
# exclude them and mutual exclusion would be lost for the length of the deploy.
# Every lock operation therefore covers both keys for one release.
#
# REMOVE once no pod predating the full-id change is running: drop the second element
# of `_lock_keys` and the `legacy_key` branches below. That is the whole surface.


def _lock_keys(
    namespace: str,
    key: Optional[Union[str, dict]] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> tuple[str, Optional[str]]:
    """This release's lock key, and the previous release's key when it differs."""
    lock_key = _pack(
        namespace=f"lock:{namespace}",
        key=key,
        project_id=project_id,
        user_id=user_id,
    )
    legacy_key = _pack(
        namespace=f"lock:{namespace}",
        key=key,
        project_id=project_id,
        user_id=user_id,
        legacy_truncated_scope=True,
    )

    # Ids no longer than the segment width were never truncated, so the two shapes
    # coincide and there is no second key to cover.
    return lock_key, (legacy_key if legacy_key != lock_key else None)


async def _renew_if_owner(lock_key: str, owner: Optional[str], ttl: int) -> bool:
    if owner:
        return bool(
            await _lock_engine.eval(
                _LOCK_RENEW_IF_OWNER_SCRIPT,
                1,
                lock_key,
                owner,
                str(ttl),
            )
        )

    return bool(await _lock_engine.expire(lock_key, ttl))


async def _release_if_owner(lock_key: str, owner: Optional[str]) -> bool:
    if owner:
        return bool(
            await _lock_engine.eval(
                _LOCK_RELEASE_IF_OWNER_SCRIPT,
                1,
                lock_key,
                owner,
            )
        )

    return bool(await _lock_engine.delete(lock_key))


# LOCK-STORE PRIMITIVES --------------------------------------------------------
#
# Thin pass-throughs to the lock Redis client for callers that manage their own
# lock-adjacent keys (e.g. lock metadata, worker heartbeats) and need direct
# key/value access beyond acquire/renew/release. Keeping these here means such
# callers depend only on `locking` and never hold a `LockEngine` themselves.


async def set_key(key: str, value, *, ttl: Optional[int] = None) -> None:
    """SET a lock-store key, optionally with a TTL (seconds)."""
    await _lock_engine.set(key, value, ex=ttl)


async def get_key(key: str):
    """GET a lock-store key (raw bytes, or None)."""
    return await _lock_engine.get(key)


async def delete_key(key: str) -> None:
    """DEL a lock-store key."""
    await _lock_engine.delete(key)


async def has_key(key: str) -> bool:
    """EXISTS check for a lock-store key."""
    return bool(await _lock_engine.exists(key))


async def scan_keys(*, match: str):
    """SCAN over lock-store keys matching `match` (async iterator).

    Async generator — iterate with `async for`. Uses SCAN, never KEYS.
    """
    async for key in _lock_engine.scan_iter(match=match):
        yield key


async def acquire_lock(
    namespace: str,
    key: Optional[Union[str, dict]] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    ttl: int = AGENTA_LOCK_TTL,
    strict: bool = False,
) -> Optional[str]:
    """Acquire a distributed lock using Redis SET NX (atomic check-and-set).

    This prevents race conditions in distributed systems by ensuring only one
    process can acquire the lock at a time.

    Args:
        namespace: Lock namespace (e.g., "account-creation", "task-processing")
        key: Unique identifier for the lock (e.g., email, user_id, task_id)
        project_id: Optional project scope
        user_id: Optional user scope
        ttl: Lock expiration time in seconds (default: 15). Auto-releases after TTL.
        strict: If True, re-raise Redis errors instead of returning None.

    Returns:
        Lock owner token if lock was acquired, None if lock is already held by another process.

    Example:
        lock_owner = await acquire_lock(namespace="account-creation", key=email, ttl=10)
        if not lock_owner:
            # Another process has the lock
            return

        try:
            # Do work while holding the lock
            await create_account(email)
        finally:
            # Always release the lock
            await release_lock(
                namespace="account-creation",
                key=email,
                owner=lock_owner,
            )
    """
    lock_owner = uuid4().hex
    legacy_key = None
    # Set only while this call holds the legacy key without having handed the section to
    # anyone. Cleared once the caller owns it or it has already been released, so the
    # `finally` below cleans up exactly the abandoned case.
    legacy_claimed = False

    try:
        lock_key, legacy_key = _lock_keys(
            namespace=namespace,
            key=key,
            project_id=project_id,
            user_id=user_id,
        )

        # The legacy key is claimed first: a pod on the previous release sets only that
        # one, so taking it is what makes the two generations exclude each other. Claiming
        # it second would let both generations hold their own key and enter together.
        if legacy_key is not None:
            if not await _lock_engine.set(legacy_key, lock_owner, nx=True, ex=ttl):
                if LOCK_DEBUG:
                    log.debug(
                        "[lock] BLOCKED",
                        key=legacy_key,
                    )
                return None
            legacy_claimed = True

        # Atomic SET NX: Returns True if lock acquired, False if already held
        acquired = await _lock_engine.set(lock_key, lock_owner, nx=True, ex=ttl)

        if acquired:
            # The caller owns both keys from here; `release_lock` clears them together.
            legacy_claimed = False
            if LOCK_DEBUG:
                log.debug(
                    "[lock] ACQUIRED",
                    key=lock_key,
                    ttl=ttl,
                )
            return lock_owner
        else:
            # This caller is not entering the critical section, so it must not leave the
            # legacy key held until its TTL — that would block everyone for `ttl`.
            if legacy_key is not None:
                await _release_if_owner(legacy_key, lock_owner)
                legacy_claimed = False

            if LOCK_DEBUG:
                log.debug(
                    "[lock] BLOCKED",
                    key=lock_key,
                )
            return None

    except Exception as e:
        log.error(
            f"[lock] ACQUIRE ERROR: namespace={namespace} key={key} error={e}",
            exc_info=True,
        )
        if strict:
            raise
        return None

    finally:
        # Reached when claiming the primary key raised or the task was cancelled between
        # the two sets. The section went to nobody, so leaving the legacy key held would
        # block both generations for its full TTL. Cancellation matters as much as an
        # exception here, which is why this is a `finally` rather than an except branch.
        if legacy_claimed and legacy_key is not None:
            try:
                await _release_if_owner(legacy_key, lock_owner)
            except Exception as cleanup_error:  # pragma: no cover - best effort
                log.error(
                    f"[lock] LEGACY CLEANUP ERROR: namespace={namespace} "
                    f"key={key} error={cleanup_error}",
                    exc_info=True,
                )


async def renew_lock(
    namespace: str,
    key: Optional[Union[str, dict]] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    ttl: int = AGENTA_LOCK_TTL,
    owner: Optional[str] = None,
) -> bool:
    """Renew (extend) the TTL of an existing distributed lock.

    Use this to prevent lock expiration during long-running operations.
    Only succeeds if the lock key still exists in Redis. If an owner token is
    provided, renewal only succeeds when ownership matches.

    Args:
        namespace: Lock namespace (same as used in acquire_lock)
        key: Lock key (same as used in acquire_lock)
        project_id: Optional project ID (same as used in acquire_lock)
        user_id: Optional user ID (same as used in acquire_lock)
        ttl: New expiration time in seconds
        owner: Optional owner token returned by acquire_lock

    Returns:
        True if lock was renewed, False if lock has already expired or on error
    """
    try:
        lock_key, legacy_key = _lock_keys(
            namespace=namespace,
            key=key,
            project_id=project_id,
            user_id=user_id,
        )

        renewed = await _renew_if_owner(lock_key, owner, ttl)

        # Held for as long as the lock itself, or a pod on the previous release would
        # take it the moment it lapsed while this holder was still inside the section.
        # Its renewal has to count: if the legacy key is gone while the primary survives,
        # the section is no longer mutually exclusive across releases, and reporting
        # success would leave the caller believing otherwise. Renew it either way rather
        # than short-circuiting, so the primary is still extended when the legacy key is
        # what failed.
        if legacy_key is not None:
            renewed = await _renew_if_owner(legacy_key, owner, ttl) and renewed

        if renewed:
            if LOCK_DEBUG:
                log.debug(
                    "[lock] RENEWED",
                    key=lock_key,
                    ttl=ttl,
                )
            return True
        else:
            log.warn(
                f"[lock] RENEW FAILED (expired or lost ownership): namespace={namespace} key={key}"
            )
            return False

    except Exception as e:
        log.error(
            f"[lock] RENEW ERROR: namespace={namespace} key={key} error={e}",
            exc_info=True,
        )
        return False


async def release_lock(
    namespace: str,
    key: Optional[Union[str, dict]] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    owner: Optional[str] = None,
    strict: bool = False,
) -> bool:
    """Release a distributed lock acquired with acquire_lock().

    Args:
        namespace: Lock namespace (same as used in acquire_lock)
        key: Lock key (same as used in acquire_lock)
        project_id: Optional project ID (same as used in acquire_lock)
        user_id: Optional user ID (same as used in acquire_lock)
        owner: Optional owner token returned by acquire_lock
        strict: If True, re-raise Redis errors instead of returning False.

    Returns:
        True if lock was released, False if already expired.

    Example:
        lock_acquired = await acquire_lock(namespace="account-creation", key=email)
        if lock_acquired:
            try:
                # ... critical section ...
            finally:
                await release_lock(namespace="account-creation", key=email)
    """
    try:
        lock_key, legacy_key = _lock_keys(
            namespace=namespace,
            key=key,
            project_id=project_id,
            user_id=user_id,
        )

        deleted = await _release_if_owner(lock_key, owner)

        # Released even when the primary was already gone: the two were taken together,
        # so leaving this one behind would block the section for the rest of its TTL.
        if legacy_key is not None:
            await _release_if_owner(legacy_key, owner)

        if deleted:
            if LOCK_DEBUG:
                log.debug(
                    "[lock] RELEASED",
                    key=lock_key,
                )
            return True
        else:
            if LOCK_DEBUG:
                log.debug(
                    "[lock] ALREADY EXPIRED OR OWNED BY ANOTHER WORKER",
                    key=lock_key,
                )
            return False

    except Exception as e:
        log.error(
            f"[lock] RELEASE ERROR: namespace={namespace} key={key} error={e}",
            exc_info=True,
        )
        if strict:
            raise
        return False
