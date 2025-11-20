from typing import Any, Type, Optional, Union
from random import random
from asyncio import sleep
from cachetools import TTLCache

from redis.asyncio import Redis
from pydantic import BaseModel
from orjson import dumps, loads

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# TODO: ADD ENV VARS
REDIS_HOST = "cache"
REDIS_PORT = 6378

AGENTA_CACHE_DB = 1
AGENTA_CACHE_TTL = 5 * 60  # 5 minutes

AGENTA_CACHE_BACKOFF_BASE = 50  # Base backoff delay in milliseconds
AGENTA_CACHE_ATTEMPTS_MAX = 4  # Maximum number of attempts to retry cache retrieval
AGENTA_CACHE_JITTER_SPREAD = 1 / 3  # Spread of jitter in backoff
AGENTA_CACHE_LEAKAGE_PROBABILITY = 0.05  # Probability of early leak
AGENTA_CACHE_LOCK_TTL = 1  # TTL for cache locks

AGENTA_CACHE_SCAN_BATCH_SIZE = 500
AGENTA_CACHE_DELETE_BATCH_SIZE = 1000

CACHE_DEBUG = False
CACHE_DEBUG_VALUE = False

r = Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    db=AGENTA_CACHE_DB,
    decode_responses=False,
    socket_timeout=0.5,  # read/write timeout
)

lc = TTLCache(
    maxsize=4_096,
    ttl=60,
)


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

    return f"p:{project_id}:u:{user_id}:{namespace}:{key}"


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
        log.warn(f"Error scanning keys with pattern {pattern}: {e}")

        return []


def _serialize(
    value: Any,
) -> bytes:
    if value is None:
        return b"__NULL__"

    if isinstance(value, BaseModel):
        return dumps(value.model_dump(mode="json", exclude_none=True))

    if isinstance(value, list) and all(isinstance(v, BaseModel) for v in value):
        return dumps([v.model_dump(mode="json", exclude_none=True) for v in value])

    return dumps(value)


def _deserialize(
    raw: bytes,
    model: Optional[Type[BaseModel]] = None,
    is_list: bool = False,
) -> Any:
    if raw == b"__NULL__":
        return None

    data = loads(raw)

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
    is_list: bool = False,
    ttl: Optional[int] = None,
) -> Optional[Any]:
    data = None

    raw = (
        await r.getex(cache_name, ex=ttl)
        if ttl and ttl > 0
        else await r.get(cache_name)
    )

    if raw:
        if CACHE_DEBUG:
            log.debug(
                "[cache] HIT  ",
                name=cache_name,
                value=data if CACHE_DEBUG_VALUE else "***",
            )

        data = _deserialize(raw, model=model, is_list=is_list)
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
    is_list: bool = False,
    retry: bool = True,
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

    return None


# INTERFACE --------------------------------------------------------------------


async def set_cache(
    namespace: str,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    key: Optional[Union[str, dict]] = None,
    value: Optional[Any] = None,
    ttl: int = AGENTA_CACHE_TTL,
) -> Optional[bool]:
    try:
        cache_name = _pack(
            namespace=namespace,
            key=key,
            project_id=project_id,
            user_id=user_id,
        )
        cache_value = _serialize(value)
        cache_px = int(ttl * 1000)

        await r.set(cache_name, cache_value, px=cache_px)

        lc[cache_name] = value

        if CACHE_DEBUG:
            log.debug(
                "[cache] SAVE ",
                name=cache_name,
                value=cache_value if CACHE_DEBUG_VALUE else "***",
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

    except Exception as e:
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
    is_list: bool = False,
    retry: bool = True,
    *,
    ttl: Optional[int] = None,
    lock: int = AGENTA_CACHE_LOCK_TTL,
    backoff: float = AGENTA_CACHE_BACKOFF_BASE,
    attempt: int = 0,
    attempts: int = AGENTA_CACHE_ATTEMPTS_MAX,
    jitter: float = AGENTA_CACHE_JITTER_SPREAD,
    leakage: float = AGENTA_CACHE_LEAKAGE_PROBABILITY,
) -> Optional[Any]:
    try:
        cache_name = _pack(
            namespace=namespace,
            key=key,
            project_id=project_id,
            user_id=user_id,
        )

        if cache_name in lc:
            if CACHE_DEBUG:
                log.debug(
                    "[cache] HOT  ",
                    name=cache_name,
                    value=lc[cache_name] if CACHE_DEBUG_VALUE else "***",
                )

            return lc[cache_name]

        data = await _try_get_and_maybe_renew(cache_name, model, is_list, ttl)

        if data is not None:
            lc[cache_name] = data

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
    try:
        cache_name = None

        if key is not None and namespace is not None:
            cache_name = _pack(
                namespace=namespace,
                key=key,
                project_id=project_id,
                user_id=user_id,
            )

            await r.delete(cache_name)

            lc.pop(cache_name, None)

        else:
            cache_name = _pack(
                namespace=namespace,
                project_id=project_id,
                user_id=user_id,
                pattern=True,
            )

            keys = await _scan(cache_name)

            for i in range(0, len(keys), AGENTA_CACHE_DELETE_BATCH_SIZE):
                batch = keys[i : i + AGENTA_CACHE_DELETE_BATCH_SIZE]
                await r.delete(*batch)

                for k in batch:
                    lc.pop(k, None)

        if CACHE_DEBUG:
            log.debug(
                "[cache] FLUSH",
                name=cache_name,
            )

        return True

    except Exception as e:
        log.warn(
            "[cache] FLUSH",
            project_id=project_id,
            user_id=user_id,
            namespace=namespace,
            key=key,
        )
        log.warn(e)

        return None
