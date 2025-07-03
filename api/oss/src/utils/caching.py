from typing import Any, Type, Optional, Union
from json import dumps, loads

from redis.asyncio import Redis
from pydantic import BaseModel

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# TODO: ADD ENV VARS
REDIS_HOST = "cache"
REDIS_PORT = 6378
AGENTA_CACHE_DB = 1
AGENTA_CACHE_TTL = 15  # 15 seconds

SCAN_BATCH_SIZE = 500
DELETE_BATCH_SIZE = 1000

r = Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    db=AGENTA_CACHE_DB,
    decode_responses=True,
    socket_timeout=0.5,  # read/write timeout
)


# ---------------------------
# 🔑 Key Parsing
# ---------------------------


def _pack(
    namespace: str,
    key: Optional[Union[str, dict]] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> str:
    if project_id:
        project_id = project_id[-12:] if len(project_id) > 12 else project_id
    else:
        project_id = ""
    if user_id:
        user_id = user_id[-12:] if len(user_id) > 12 else user_id
    else:
        user_id = ""

    prefix = f"p:{project_id}:u:{user_id}:{namespace}"

    key = key or ""

    if isinstance(key, str):
        return f"{prefix}:{key}"

    elif isinstance(key, dict):
        return f"{prefix}:" + ":".join(f"{k}:{v}" for k, v in sorted(key.items()))

    raise TypeError("Cache key must be str or dict")


# ---------------------------
# 📦 Value Serialization
# ---------------------------


def _serialize(
    value: Any,
) -> str:
    if value is None:
        return "__NULL__"

    if isinstance(value, BaseModel):
        return dumps(value.model_dump(mode="json", exclude_none=True))

    elif isinstance(value, list) and all(isinstance(v, BaseModel) for v in value):
        return dumps([v.model_dump(mode="json", exclude_none=True) for v in value])

    return dumps(value)


def _deserialize(
    raw: str,
    model: Optional[Type[BaseModel]] = None,
    is_list: bool = False,
) -> Any:
    if raw == "__NULL__":
        return None

    data = loads(raw)

    if not model:
        return data

    if is_list:
        return [model.model_validate(item) for item in data]

    return model.model_validate(data)


async def _scan_keys(pattern: str) -> list[str]:
    """Retrieve all matching keys using SCAN."""
    cursor = 0
    keys: list[str] = []
    try:
        while True:
            cursor, batch = await r.scan(
                cursor=cursor,
                match=pattern,
                count=SCAN_BATCH_SIZE,
            )
            keys.extend(batch)
            if cursor == 0:
                break
        return keys
    except Exception as e:
        log.warn(f"Error scanning keys with pattern {pattern}: {e}")
        return []


# ---------------------------
# 🚀 Public Async Cache Interface
# ---------------------------


async def set_cache(
    namespace: str,
    key: Optional[Union[str, dict]] = None,
    value: Optional[Any] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    ttl: Optional[int] = AGENTA_CACHE_TTL,
) -> Optional[bool]:
    try:
        cache_name = _pack(namespace, key, project_id, user_id)
        cache_value = _serialize(value)
        cache_px = int(ttl * 1000)

        await r.set(cache_name, cache_value, px=cache_px)

        # log.debug(
        #     "[cache] SAVE",
        #     name=cache_name,
        #     value=cache_value,
        #     px=cache_px,
        # )
        return True

    except Exception as e:  # pylint: disable=broad-exception-caught
        log.warn(
            "[cache] SET",
            project_id=project_id,
            user_id=user_id,
            namespace=namespace,
            key=key,
            # value=value,
            ttl=ttl,
        )
        log.warn(e)
        return None


async def get_cache(
    namespace: str,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    key: Optional[Union[str, dict]] = None,
    model: Optional[Type[BaseModel]] = None,
    is_list: bool = False,
) -> Optional[Any]:
    try:
        cache_name = _pack(namespace, key, project_id, user_id)

        raw = await r.get(cache_name)

        if not raw:
            # log.debug(
            #     "[cache] MISS",
            #     name=cache_name,
            # )
            return None

        # log.debug(
        #     "[cache] HIT",
        #     name=cache_name,
        #     value=raw,
        # )
        return _deserialize(raw, model=model, is_list=is_list)

    except Exception as e:  # pylint: disable=broad-exception-caught
        log.warn(
            "[cache] GET",
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
    """Invalidate cached values.

    If ``key`` is provided, only the cache entry for that key is deleted.
    If ``namespace`` is provided without ``key``, all keys under that
    namespace are removed. If neither ``namespace`` nor ``key`` are provided,
    all cache entries for the project/user pair are deleted.
    """
    try:
        if key is not None and namespace is not None:
            cache_name = _pack(namespace, key, project_id, user_id)
            await r.delete(cache_name)
        else:
            pattern = (
                f"{project_id}:{user_id}:{namespace}:*"
                if namespace
                else f"{project_id}:{user_id}:*"
            )
            keys = await _scan_keys(pattern)
            for i in range(0, len(keys), DELETE_BATCH_SIZE):
                await r.delete(*keys[i : i + DELETE_BATCH_SIZE])

        # log.debug(
        #     "[cache] INVALIDATE",
        #     namespace=namespace,
        #     key=key,
        #     project_id=project_id,
        #     user_id=user_id,
        # )

        return True
    except Exception as e:  # pylint: disable=broad-exception-caught
        log.warn(
            "[cache] INVALIDATE",
            project_id=project_id,
            user_id=user_id,
            namespace=namespace,
            key=key,
        )
        log.warn(e)
        return None
