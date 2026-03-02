from typing import Any, Type, Optional, Union
from random import random
from asyncio import sleep
from uuid import uuid4

import orjson
from cachetools import TTLCache
from redis.asyncio import Redis
from pydantic import BaseModel

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env

log = get_module_logger(__name__)

AGENTA_LOCK_TTL = 15  # 5 seconds
AGENTA_CACHE_TTL = 5 * 60  # 5 minutes
AGENTA_CACHE_LOCAL_TTL = 60  # 60 seconds for local in-memory cache (Layer 1)

AGENTA_CACHE_BACKOFF_BASE = 50  # Base backoff delay in milliseconds
AGENTA_CACHE_ATTEMPTS_MAX = 4  # Maximum number of attempts to retry cache retrieval
AGENTA_CACHE_JITTER_SPREAD = 1 / 3  # Spread of jitter in backoff
AGENTA_CACHE_LEAKAGE_PROBABILITY = 0.05  # Probability of early leak
AGENTA_CACHE_LOCK_TTL = 1  # TTL for cache locks

AGENTA_CACHE_SCAN_BATCH_SIZE = 500
AGENTA_CACHE_DELETE_BATCH_SIZE = 1000
AGENTA_LOCK_SOCKET_TIMEOUT = 2.0  # Locks should be more reliable than cache lookups

CACHE_DEBUG = False
CACHE_DEBUG_VALUE = False

# Two-tier caching: Local TTLCache (60s) + Redis (5min)
# Layer 1: Local in-memory cache with 60s TTL (4096 entries max)
local_cache: TTLCache = TTLCache(maxsize=4096, ttl=AGENTA_CACHE_LOCAL_TTL)

# Use volatile Redis instance for caching (prefix-based separation)
# decode_responses=False: orjson operates on bytes for 3x performance vs json
r = Redis.from_url(
    url=env.redis.uri_volatile,
    decode_responses=False,
    socket_timeout=0.5,  # read/write timeout
)

# Dedicated Redis client for distributed locks with a longer timeout.
r_lock = Redis.from_url(
    url=env.redis.uri_volatile,
    decode_responses=False,
    socket_timeout=AGENTA_LOCK_SOCKET_TIMEOUT,
)

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


# HELPERS ----------------------------------------------------------------------


def _pack(
    namespace: Optional[str] = None,
    key: Optional[Union[str, dict]] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    pattern: Optional[bool] = False,
) -> str:
    if project_id:
        project_id = project_id[-12:] if len(project_id) > 12 else project_id
    else:
        project_id = ""
    project_id = project_id + "-" * (12 - len(project_id))

    if user_id:
        user_id = user_id[-12:] if len(user_id) > 12 else user_id
    else:
        user_id = ""
    user_id = user_id + "-" * (12 - len(user_id))

    namespace = namespace or ("" if not pattern else "*")

    key = key or ("" if not pattern else "*")

    if isinstance(key, dict):
        key = ":".join(f"{k}:{v}" for k, v in sorted(key.items()))

    if isinstance(key, str):
        pass

    else:
        raise TypeError("Cache key must be str or dict")

    return f"cache:p:{project_id}:u:{user_id}:{namespace}:{key}"


async def _scan(pattern: str) -> list[str]:
    try:
        cursor = 0
        keys: list[str] = []

        while True:  # TODO: Really ?
            cursor, batch = await r.scan(
                cursor=cursor,
                match=pattern,
                count=AGENTA_CACHE_SCAN_BATCH_SIZE,
            )

            keys.extend(batch)

            if cursor == 0:
                break

        return keys

    except Exception as e:
        log.error(f"[cache] SCAN ERROR: pattern={pattern} error={e}", exc_info=True)

        return []


def _serialize(
    value: Any,
) -> bytes:
    if value is None:
        return b"__NULL__"

    if isinstance(value, BaseModel):
        return orjson.dumps(value.model_dump(mode="json", exclude_none=True))

    elif isinstance(value, list) and all(isinstance(v, BaseModel) for v in value):
        return orjson.dumps(
            [v.model_dump(mode="json", exclude_none=True) for v in value]
        )

    return orjson.dumps(value)


def _deserialize(
    raw: bytes,
    model: Optional[Type[BaseModel]] = None,
    is_list: bool = False,
) -> Any:
    if raw == b"__NULL__":
        return None

    data = orjson.loads(raw)

    if not model:
        return data

    if is_list:
        return [model.model_validate(item) for item in data]

    return model.model_validate(data)


async def _delay(
    attempts_idx: int,
    backoff_base: float,
    jitter_spread: float,
) -> None:
    delay_step = backoff_base * (2**attempts_idx)
    delay_base = backoff_base * ((2 ** (attempts_idx + 1)) - 1)
    delay_jitter = random() * delay_step * (1 + jitter_spread)
    delay = (1 - jitter_spread) * delay_base + delay_jitter

    await sleep(delay / 1000.0)  # convert ms to seconds


async def _try_get_and_maybe_renew(
    cache_name: str,
    model: Optional[Type[BaseModel]],
    is_list: Optional[bool] = False,
    ttl: Optional[int] = None,
) -> Optional[Any]:
    data = None

    # Layer 1: Check local in-memory cache first (60s TTL, ~1μs latency)
    if cache_name in local_cache:
        raw = local_cache[cache_name]
        if CACHE_DEBUG:
            log.debug(
                "[cache] L1-HIT",
                name=cache_name,
                value=raw if CACHE_DEBUG_VALUE else "***",
            )
        return _deserialize(raw, model=model, is_list=is_list)

    # Layer 2: Check Redis (distributed, 5min TTL, ~1ms latency)
    raw = await r.get(cache_name)

    if raw is not None:
        if CACHE_DEBUG:
            log.debug(
                "[cache] L2-HIT",
                name=cache_name,
                value=raw if CACHE_DEBUG_VALUE else "***",
            )

        # Populate local cache from Redis hit (raw is bytes from decode_responses=False)
        local_cache[cache_name] = raw

        data = _deserialize(raw, model=model, is_list=is_list)

        if ttl is not None and ttl > 0:
            if CACHE_DEBUG:
                log.debug(
                    "[cache] RENEW",
                    name=cache_name,
                )

            await r.expire(cache_name, ttl)
    else:
        if CACHE_DEBUG:
            log.debug(
                "[cache] MISS ",
                name=cache_name,
            )

    return data


async def _maybe_retry_get(
    namespace: Optional[str] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    key: Optional[Union[str, dict]] = None,
    model: Optional[Type[BaseModel]] = None,
    is_list: Optional[bool] = False,
    retry: Optional[bool] = True,
    *,
    ttl: Optional[int] = None,
    lock_ttl: int,
    backoff_base: float,
    attempts_idx: int,
    attempts_max: int,
    jitter_spread: float,
    leakage_p: float,
) -> Optional[Any]:
    cache_name = _pack(
        namespace=namespace,
        key=key,
        project_id=project_id,
        user_id=user_id,
    )

    if CACHE_DEBUG:
        log.debug(
            "[cache] RETRY",
            name=cache_name,
            attempt=attempts_idx,
        )

    if attempts_idx >= attempts_max:
        if CACHE_DEBUG:
            log.debug(
                "[cache] QUIT ",
                name=cache_name,
                attempt=attempts_idx,
            )

        return None

    if random() < leakage_p:
        if CACHE_DEBUG:
            log.debug(
                "[cache] LEAK ",
                name=cache_name,
                attempt=attempts_idx,
            )

        return None

    if retry:
        lock_name = f"lock::{cache_name}"
        lock_ex = int(lock_ttl * 1000)  # convert seconds to milliseconds

        got_lock = await r.set(lock_name, "1", nx=True, ex=lock_ex)

        if got_lock:
            if CACHE_DEBUG:
                log.debug(
                    "[cache] LEAD ",
                    name=cache_name,
                    attempt=attempts_idx,
                )

            return None

        if CACHE_DEBUG:
            log.debug(
                "[cache] DELAY",
                name=cache_name,
                attempt=attempts_idx,
            )

        await _delay(
            attempts_idx=attempts_idx,
            backoff_base=backoff_base,
            jitter_spread=jitter_spread,
        )

        return await get_cache(
            namespace=namespace,
            project_id=project_id,
            user_id=user_id,
            key=key,
            model=model,
            is_list=is_list,
            retry=retry,
            #
            ttl=ttl,
            lock=lock_ttl,
            backoff=backoff_base,
            attempt=attempts_idx + 1,
            attempts=attempts_max,
            jitter=jitter_spread,
            leakage=leakage_p,
        )


# INTERFACE --------------------------------------------------------------------


async def set_cache(
    namespace: str,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    key: Optional[Union[str, dict]] = None,
    value: Optional[Any] = None,
    ttl: Optional[int] = AGENTA_CACHE_TTL,
) -> Optional[bool]:
    # Noop if caching is disabled
    if not env.redis.cache_enabled:
        return None

    try:
        cache_name = _pack(
            namespace=namespace,
            key=key,
            project_id=project_id,
            user_id=user_id,
        )
        cache_value: bytes = _serialize(value)
        cache_px = int(ttl * 1000)

        # Write to both cache layers
        # Layer 1: Local in-memory cache (auto-expires via TTL)
        local_cache[cache_name] = cache_value

        # Layer 2: Redis distributed cache
        await r.set(cache_name, cache_value, px=cache_px)

        if CACHE_DEBUG:
            log.debug(
                "[cache] SAVE ",
                name=cache_name,
                value=cache_value.decode("utf-8", errors="ignore")
                if CACHE_DEBUG_VALUE
                else "***",
            )

        lock_name = f"lock::{cache_name}"

        check = await r.delete(lock_name)

        if check:
            if CACHE_DEBUG:
                log.debug(
                    "[cache] FREE ",
                    name=cache_name,
                )

        return True

    except Exception as e:  # pylint: disable=broad-exception-caught
        log.warn(
            "[cache] SET  ",
            project_id=project_id,
            user_id=user_id,
            namespace=namespace,
            key=key,
            value=value if CACHE_DEBUG_VALUE else "***",
            ttl=ttl,
        )
        log.warn(e)

        return None


async def get_cache(
    namespace: Optional[str] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    key: Optional[Union[str, dict]] = None,
    model: Optional[Type[BaseModel]] = None,
    is_list: Optional[bool] = False,
    retry: Optional[bool] = True,
    *,
    ttl: Optional[int] = None,
    lock: Optional[int] = AGENTA_CACHE_LOCK_TTL,
    backoff: Optional[float] = AGENTA_CACHE_BACKOFF_BASE,
    attempt: Optional[int] = 0,
    attempts: Optional[int] = AGENTA_CACHE_ATTEMPTS_MAX,
    jitter: Optional[float] = AGENTA_CACHE_JITTER_SPREAD,
    leakage: Optional[float] = AGENTA_CACHE_LEAKAGE_PROBABILITY,
) -> Optional[Any]:
    # Noop if caching is disabled - always return cache miss
    if not env.redis.cache_enabled:
        return None

    try:
        cache_name = _pack(
            namespace=namespace,
            key=key,
            project_id=project_id,
            user_id=user_id,
        )

        data = await _try_get_and_maybe_renew(cache_name, model, is_list, ttl)

        if data is not None:
            return data

        if retry:
            return await _maybe_retry_get(
                namespace=namespace,
                project_id=project_id,
                user_id=user_id,
                key=key,
                model=model,
                is_list=is_list,
                retry=retry,
                #
                ttl=ttl,
                lock_ttl=lock,
                backoff_base=backoff,
                attempts_idx=attempt,
                attempts_max=attempts,
                jitter_spread=jitter,
                leakage_p=leakage,
            )

        return None

    except Exception as e:
        log.warn(
            "[cache] GET  ",
            project_id=project_id,
            user_id=user_id,
            namespace=namespace,
            key=key,
            model=model,
            is_list=is_list,
        )
        log.warn(e)

        return None


async def invalidate_cache(
    namespace: Optional[str] = None,
    key: Optional[Union[str, dict]] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Optional[bool]:
    # Noop if caching is disabled
    if not env.redis.cache_enabled:
        return None

    try:
        cache_name = None

        if key is not None and namespace is not None:
            cache_name = _pack(
                namespace=namespace,
                key=key,
                project_id=project_id,
                user_id=user_id,
            )

            # Clear from both cache layers
            local_cache.pop(cache_name, None)
            await r.delete(cache_name)

        else:
            cache_name = _pack(
                namespace=namespace,
                project_id=project_id,
                user_id=user_id,
                pattern=True,
            )

            keys = await _scan(cache_name)

            if CACHE_DEBUG:
                log.debug(
                    f"[cache] INVALIDATE pattern={cache_name} redis_keys_found={len(keys)}"
                )

            # Clear from local cache (pattern matching)
            # Pattern is like "cache:p:PROJECT:u:USER:*:*"
            # We need to convert Redis wildcard pattern to a prefix match
            # Strategy: Find the last concrete segment before wildcards start
            parts = cache_name.split(":")
            # Find the first part that contains "*"
            concrete_parts = []
            for part in parts:
                if "*" in part:
                    break
                concrete_parts.append(part)
            # Reconstruct prefix with trailing colon
            local_prefix = ":".join(concrete_parts) + ":" if concrete_parts else ""
            local_keys_deleted = 0

            if CACHE_DEBUG:
                log.debug(f"[cache] INVALIDATE local_prefix={local_prefix}")
                log.debug(f"[cache] INVALIDATE local_cache has {len(local_cache)} keys")
                for lk in list(local_cache.keys()):
                    log.debug(f"[cache] INVALIDATE local_cache_key={lk}")

            for local_key in list(local_cache.keys()):
                if local_key.startswith(local_prefix):
                    local_cache.pop(local_key, None)
                    local_keys_deleted += 1
                    if CACHE_DEBUG:
                        log.debug(f"[cache] INVALIDATE deleted local_key={local_key}")

            if CACHE_DEBUG:
                log.debug(f"[cache] INVALIDATE local_keys_deleted={local_keys_deleted}")

            # Clear from Redis
            redis_keys_deleted = 0
            for i in range(0, len(keys), AGENTA_CACHE_DELETE_BATCH_SIZE):
                batch = keys[i : i + AGENTA_CACHE_DELETE_BATCH_SIZE]
                deleted_count = await r.delete(*batch)
                redis_keys_deleted += deleted_count

                if CACHE_DEBUG:
                    for key in batch:
                        log.debug(f"[cache] INVALIDATE redis_key={key}")

            if CACHE_DEBUG:
                log.debug(f"[cache] INVALIDATE redis_keys_deleted={redis_keys_deleted}")

        if CACHE_DEBUG:
            log.debug(
                "[cache] FLUSH",
                name=cache_name,
            )

        return True

    except Exception as e:  # pylint: disable=broad-exception-caught
        log.warn(
            "[cache] FLUSH",
            project_id=project_id,
            user_id=user_id,
            namespace=namespace,
            key=key,
        )
        log.warn(e)

        return None


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
        ttl: Lock expiration time in seconds (default: 10). Auto-releases after TTL.
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
        acquired = await r_lock.set(lock_key, lock_owner, nx=True, ex=ttl)

        if acquired:
            if CACHE_DEBUG:
                log.debug(
                    "[lock] ACQUIRED",
                    key=lock_key,
                    ttl=ttl,
                )
            return lock_owner
        else:
            if CACHE_DEBUG:
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
            renewed = await r_lock.eval(
                _LOCK_RENEW_IF_OWNER_SCRIPT,
                1,
                lock_key,
                owner,
                str(ttl),
            )
        else:
            renewed = await r_lock.expire(lock_key, ttl)

        if renewed:
            if CACHE_DEBUG:
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
            deleted = await r_lock.eval(
                _LOCK_RELEASE_IF_OWNER_SCRIPT,
                1,
                lock_key,
                owner,
            )
        else:
            deleted = await r_lock.delete(lock_key)

        if deleted:
            if CACHE_DEBUG:
                log.debug(
                    "[lock] RELEASED",
                    key=lock_key,
                )
            return True
        else:
            if CACHE_DEBUG:
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
