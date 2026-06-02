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


# LOCK-STORE PRIMITIVES --------------------------------------------------------
#
# Thin pass-throughs to the lock Redis client for callers that manage their own
# lock-adjacent keys (e.g. lock metadata, worker heartbeats) and need direct
# key/value access beyond acquire/renew/release. Keeping these here means such
# callers depend only on `locking` and never hold a `LockEngine` themselves.


async def store_set(key: str, value, *, ttl: Optional[int] = None) -> None:
    """SET a lock-store key, optionally with a TTL (seconds)."""
    await _lock_engine.set(key, value, ex=ttl)


async def store_get(key: str):
    """GET a lock-store key (raw bytes, or None)."""
    return await _lock_engine.get(key)


async def store_delete(key: str) -> None:
    """DEL a lock-store key."""
    await _lock_engine.delete(key)


async def store_exists(key: str) -> bool:
    """EXISTS check for a lock-store key."""
    return bool(await _lock_engine.exists(key))


def store_scan_iter(*, match: str):
    """SCAN (async iterator) over lock-store keys matching `match`.

    Returns the redis `scan_iter` async generator directly — callers iterate it
    with `async for`. Uses SCAN, never KEYS.
    """
    return _lock_engine.scan_iter(match=match)


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
    try:
        lock_key = _pack(
            namespace=f"lock:{namespace}",
            key=key,
            project_id=project_id,
            user_id=user_id,
        )
        lock_owner = uuid4().hex

        # Atomic SET NX: Returns True if lock acquired, False if already held
        acquired = await _lock_engine.set(lock_key, lock_owner, nx=True, ex=ttl)

        if acquired:
            if LOCK_DEBUG:
                log.debug(
                    "[lock] ACQUIRED",
                    key=lock_key,
                    ttl=ttl,
                )
            return lock_owner
        else:
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
        lock_key = _pack(
            namespace=f"lock:{namespace}",
            key=key,
            project_id=project_id,
            user_id=user_id,
        )

        if owner:
            renewed = await _lock_engine.eval(
                _LOCK_RENEW_IF_OWNER_SCRIPT,
                1,
                lock_key,
                owner,
                str(ttl),
            )
        else:
            renewed = await _lock_engine.expire(lock_key, ttl)

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
        lock_key = _pack(
            namespace=f"lock:{namespace}",
            key=key,
            project_id=project_id,
            user_id=user_id,
        )

        if owner:
            deleted = await _lock_engine.eval(
                _LOCK_RELEASE_IF_OWNER_SCRIPT,
                1,
                lock_key,
                owner,
            )
        else:
            deleted = await _lock_engine.delete(lock_key)

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
