from typing import Any, Iterable, List, Optional, Sequence, Type, Union
from random import random
from asyncio import sleep

import orjson

from pydantic import BaseModel

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env
from oss.src.dbs.redis.shared.engine import get_cache_engine

log = get_module_logger(__name__)

AGENTA_CACHE_TTL = 5 * 60  # 5 minutes (Layer 2) [L2]
AGENTA_CACHE_LOCAL_TTL = 15  # 15 seconds for local in-memory cache (Layer 1) [L1]

AGENTA_CACHE_BACKOFF_BASE = 50  # Base backoff delay in milliseconds
AGENTA_CACHE_ATTEMPTS_MAX = 4  # Maximum number of attempts to retry cache retrieval
AGENTA_CACHE_JITTER_SPREAD = 1 / 3  # Spread of jitter in backoff
AGENTA_CACHE_LEAKAGE_PROBABILITY = 0.05  # Probability of early leak
AGENTA_CACHE_LOCK_TTL = 1  # TTL for cache locks

AGENTA_CACHE_SCAN_BATCH_SIZE = 500
AGENTA_CACHE_DELETE_BATCH_SIZE = 1000

CACHE_DEBUG = False
CACHE_DEBUG_VALUE = False

# Redis is the only active cache layer.
# L1 in-process caching is disabled because it can serve stale data across
# gunicorn workers after mutations invalidate Redis from a different process.
#
# Original L1 cache:
# local_cache: TTLCache = TTLCache(maxsize=4096, ttl=AGENTA_CACHE_LOCAL_TTL)

_cache_engine = get_cache_engine()


# HELPERS ----------------------------------------------------------------------


AGENTA_CACHE_SCOPE_WIDTH = 12  # minimum width of a scope segment


def _scope(
    value: Optional[str],
    legacy_truncated: Optional[bool] = False,
) -> str:
    """One scope segment (`p:` or `u:`) of a cache key.

    Scope segments used to be cut down to their last 12 characters. Two projects whose
    ids share that suffix then shared every cache entry in every namespace — including
    `check_permissions` and `check_action_access`, which decide authorization. Ids are
    server-generated UUID4s so a caller cannot steer a collision, but one project reading
    another's cached permission result is not a thing to leave to chance. The id is
    carried whole now.

    The padding stays: an absent or short id still produces the same fixed-width segment
    it always did, so key shape is unchanged everywhere the id was not being cut.

    `legacy_truncated` reproduces the pre-change shape and exists only so lock holders
    can span a rolling deploy — see `oss.src.utils.locking`.
    """
    value = value or ""

    if legacy_truncated and len(value) > AGENTA_CACHE_SCOPE_WIDTH:
        value = value[-AGENTA_CACHE_SCOPE_WIDTH:]

    return value + "-" * (AGENTA_CACHE_SCOPE_WIDTH - len(value))


def _pack(
    namespace: Optional[str] = None,
    key: Optional[Union[str, dict]] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    pattern: Optional[bool] = False,
    legacy_truncated_scope: Optional[bool] = False,
) -> str:
    project_id = _scope(project_id, legacy_truncated_scope)
    # A pattern with no user scope matches every user, which the fixed-width padding
    # cannot express — so the wildcard wins over the padded segment in that one case.
    user_id = (
        "*" if pattern and not user_id else _scope(user_id, legacy_truncated_scope)
    )

    namespace = namespace or ("" if not pattern else "*")

    key = key or ("" if not pattern else "*")

    if isinstance(key, dict):
        key = ":".join(f"{k}:{v}" for k, v in sorted(key.items()))

    if isinstance(key, str):
        pass

    else:
        raise TypeError("Cache key must be str or dict")

    return f"cache:p:{project_id}:u:{user_id}:{namespace}:{key}"


def user_keys_to_clear(
    keys: Iterable[Union[str, bytes]],
    *,
    project_ids: Sequence[str],
    namespaces: Sequence[str],
    projectless_namespaces: Sequence[str] = (),
) -> List[Union[str, bytes]]:
    """From one user's keys (`cache:p:<project>:u:<user>:<namespace>:<key>`), the ones
    that `invalidate_cache(namespace=n, project_id=p, user_id=u)` would clear for every
    (n, p) of `namespaces` x `project_ids`, plus the project-less keys of
    `projectless_namespaces` (the padded `------------` project part)."""

    projects = {_pack(project_id=p).split(":")[2] for p in project_ids}
    names = set(namespaces)
    projectless = set(projectless_namespaces)
    empty_project = "-" * 12
    selected = []
    for key in keys:
        text = key.decode() if isinstance(key, bytes) else key
        parts = text.split(":", 6)
        if len(parts) < 6 or parts[0] != "cache" or parts[1] != "p":
            continue
        project, namespace = parts[2], parts[5]
        if (project in projects and namespace in names) or (
            project == empty_project and namespace in projectless
        ):
            selected.append(key)
    return selected


async def invalidate_user_cache(
    *,
    user_id: str,
    project_ids: Sequence[str],
    namespaces: Sequence[str],
    projectless_namespaces: Sequence[str] = (),
) -> Optional[bool]:
    """Clear one user's entries in many projects with ONE scan of the user's keys,
    instead of one pattern scan per (project, namespace). Clears the same keys as
    the per-pair `invalidate_cache` calls (see `user_keys_to_clear`). Returns None
    on a Redis failure, like `invalidate_cache`."""

    if not env.agenta.api.caching.enabled:
        return None

    try:
        # Every project of this user: `_pack` pads a missing project, so the
        # project part is a glob here.
        user_part = _pack(user_id=user_id).split(":")[4]
        pattern = f"cache:p:*:u:{user_part}:*"
        cursor = 0
        keys: list = []
        while True:
            cursor, batch = await _cache_engine.scan(
                cursor=cursor, match=pattern, count=AGENTA_CACHE_SCAN_BATCH_SIZE
            )
            keys.extend(batch)
            if cursor == 0:
                break

        selected = user_keys_to_clear(
            keys,
            project_ids=project_ids,
            namespaces=namespaces,
            projectless_namespaces=projectless_namespaces,
        )
        for i in range(0, len(selected), AGENTA_CACHE_DELETE_BATCH_SIZE):
            await _cache_engine.delete(
                *selected[i : i + AGENTA_CACHE_DELETE_BATCH_SIZE]
            )

        return True

    except Exception as e:  # pylint: disable=broad-exception-caught
        log.warn("[cache] FLUSH USER", user_id=user_id, project_count=len(project_ids))
        log.warn(e)

        return None


def pack(
    namespace: Optional[str] = None,
    key: Optional[Union[str, dict]] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    pattern: Optional[bool] = False,
) -> str:
    return _pack(
        namespace=namespace,
        key=key,
        project_id=project_id,
        user_id=user_id,
        pattern=pattern,
    )


async def _scan(pattern: str) -> list[str]:
    try:
        cursor = 0
        keys: list[str] = []

        while True:  # TODO: Really ?
            cursor, batch = await _cache_engine.scan(
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

    # Layer 1 is intentionally disabled.
    #
    # Original L1 read path:
    # if cache_name in local_cache:
    #     raw = local_cache[cache_name]
    #     if CACHE_DEBUG:
    #         log.debug(
    #             "[cache] L1-HIT",
    #             name=cache_name,
    #             value=raw if CACHE_DEBUG_VALUE else "***",
    #         )
    #     return _deserialize(raw, model=model, is_list=is_list)

    # Layer 2: Check Redis (distributed, 5min TTL, ~1ms latency)
    raw = await _cache_engine.get(cache_name)

    if raw is not None:
        if CACHE_DEBUG:
            log.debug(
                "[cache] L2-HIT",
                name=cache_name,
                value=raw if CACHE_DEBUG_VALUE else "***",
            )

        # Original L1 backfill path:
        # local_cache[cache_name] = raw
        data = _deserialize(raw, model=model, is_list=is_list)

        if ttl is not None and ttl > 0:
            if CACHE_DEBUG:
                log.debug(
                    "[cache] RENEW",
                    name=cache_name,
                )

            await _cache_engine.expire(cache_name, ttl)
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
        lock_px = int(lock_ttl * 1000)  # seconds to milliseconds, for `px`

        got_lock = await _cache_engine.set(lock_name, "1", nx=True, px=lock_px)

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
    *,
    nx: bool = False,
    release_lock: bool = True,
) -> Optional[bool]:
    """`nx`: write only when no value is stored (False when one was). `release_lock`:
    delete the stampede lock a `get_cache(retry=True)` reader may hold; a caller that
    never reads with the lock passes False and saves that round trip."""
    # Noop if caching is disabled
    if not env.agenta.api.caching.enabled:
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

        # Write to Redis only.
        #
        # Original L1 write path:
        # local_cache[cache_name] = cache_value
        written = await _cache_engine.set(cache_name, cache_value, px=cache_px, nx=nx)
        if nx and not written:
            return False

        if CACHE_DEBUG:
            log.debug(
                "[cache] SAVE ",
                name=cache_name,
                value=cache_value.decode("utf-8", errors="ignore")
                if CACHE_DEBUG_VALUE
                else "***",
            )

        if not release_lock:
            return True

        lock_name = f"lock::{cache_name}"

        check = await _cache_engine.delete(lock_name)

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
    if not env.agenta.api.caching.enabled:
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
    if not env.agenta.api.caching.enabled:
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

            # Clear from Redis.
            #
            # Original L1 invalidation path:
            # local_cache.pop(cache_name, None)
            await _cache_engine.delete(cache_name)

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

            # Original L1 pattern invalidation path:
            # parts = cache_name.split(":")
            # concrete_parts = []
            # for part in parts:
            #     if "*" in part:
            #         break
            #     concrete_parts.append(part)
            # local_prefix = ":".join(concrete_parts) + ":" if concrete_parts else ""
            # local_keys_deleted = 0
            #
            # if CACHE_DEBUG:
            #     log.debug(f"[cache] INVALIDATE local_prefix={local_prefix}")
            #     log.debug(f"[cache] INVALIDATE local_cache has {len(local_cache)} keys")
            #     for lk in list(local_cache.keys()):
            #         log.debug(f"[cache] INVALIDATE local_cache_key={lk}")
            #
            # for local_key in list(local_cache.keys()):
            #     if local_key.startswith(local_prefix):
            #         local_cache.pop(local_key, None)
            #         local_keys_deleted += 1
            #         if CACHE_DEBUG:
            #             log.debug(f"[cache] INVALIDATE deleted local_key={local_key}")
            #
            # if CACHE_DEBUG:
            #     log.debug(f"[cache] INVALIDATE local_keys_deleted={local_keys_deleted}")

            # Clear from Redis
            redis_keys_deleted = 0
            for i in range(0, len(keys), AGENTA_CACHE_DELETE_BATCH_SIZE):
                batch = keys[i : i + AGENTA_CACHE_DELETE_BATCH_SIZE]
                deleted_count = await _cache_engine.delete(*batch)
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


async def get_cache_many(entries: list) -> list:
    """Read several cache entries in ONE Redis round trip (`MGET`).

    `entries` are dicts with the `get_cache` naming arguments (`namespace`,
    `project_id`, `user_id`, `key`) and an optional `model`. Returns one value per
    entry, `None` for a miss. No lock and no retry: a caller falls back to `get_cache`
    for an entry that missed. Caching disabled, or a Redis error: all `None`.

    An entry `{"raw": <key>}` names a plain key of the same Redis (a session lock key)
    and returns its bytes as stored, also when caching is disabled: the read it saves
    is not a cache read.
    """

    if not entries:
        return []
    caching = env.agenta.api.caching.enabled
    read = [
        i for i, entry in enumerate(entries) if caching or entry.get("raw") is not None
    ]
    values: list = [None] * len(entries)
    if not read:
        return values
    try:
        names = [
            entries[i]["raw"]
            if entries[i].get("raw") is not None
            else _pack(
                namespace=entries[i].get("namespace"),
                key=entries[i].get("key"),
                project_id=entries[i].get("project_id"),
                user_id=entries[i].get("user_id"),
            )
            for i in read
        ]
        raws = await _cache_engine.mget(names)
        for i, raw in zip(read, raws):
            entry = entries[i]
            if raw is None:
                continue
            values[i] = (
                raw
                if entry.get("raw") is not None
                else _deserialize(raw, model=entry.get("model"), is_list=False)
            )
        return values
    except Exception as e:  # pylint: disable=broad-except
        log.warn("[cache] MGET ", count=len(entries))
        log.warn(e)
        return [None] * len(entries)


async def invalidate_cache_entries(entries: list) -> Optional[bool]:
    """Delete several exact entries, in batches of `AGENTA_CACHE_DELETE_BATCH_SIZE` keys
    per `DEL` (no SCAN). `entries` are dicts with the `get_cache` naming arguments
    (`namespace`, `project_id`, `user_id`, `key`). Caching disabled: no-op. A Redis
    error is logged and returns None, like `invalidate_cache`."""

    if not env.agenta.api.caching.enabled or not entries:
        return None
    try:
        names = [
            _pack(
                namespace=entry.get("namespace"),
                key=entry.get("key"),
                project_id=entry.get("project_id"),
                user_id=entry.get("user_id"),
            )
            for entry in entries
        ]
        for i in range(0, len(names), AGENTA_CACHE_DELETE_BATCH_SIZE):
            await _cache_engine.delete(*names[i : i + AGENTA_CACHE_DELETE_BATCH_SIZE])
        return True
    except Exception as e:  # pylint: disable=broad-except
        log.warn("[cache] DEL MANY", count=len(entries))
        log.warn(e)
        return None
