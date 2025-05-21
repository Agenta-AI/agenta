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

r = Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    db=AGENTA_CACHE_DB,
    decode_responses=True,
    socket_timeout=0.100,  # read/write timeout
)


# ---------------------------
# 🔑 Key Parsing
# ---------------------------


def _pack(
    project_id: str,
    user_id: str,
    namespace: str,
    key: Union[str, dict],
) -> str:
    if isinstance(key, str):
        return f"{project_id}:{user_id}:{namespace}:{key}"
    elif isinstance(key, dict):
        return f"{project_id}:{user_id}:{namespace}:" + ":".join(
            f"{k}:{v}" for k, v in sorted(key.items())
        )

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


# ---------------------------
# 🚀 Public Async Cache Interface
# ---------------------------


async def set_cache(
    project_id: str,
    user_id: str,
    namespace: str,
    key: Union[str, dict],
    value: Any,
    ttl: int = AGENTA_CACHE_TTL,
) -> Optional[bool]:
    try:
        cache_name = _pack(project_id, user_id, namespace, key)
        cache_value = _serialize(value)
        cache_px = int(ttl * 1000)

        await r.set(cache_name, cache_value, px=cache_px)

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
    project_id: str,
    user_id: str,
    namespace: str,
    key: Union[str, dict],
    model: Optional[Type[BaseModel]] = None,
    is_list: bool = False,
) -> Optional[Any]:
    try:
        cache_name = _pack(project_id, user_id, namespace, key)

        raw = await r.get(cache_name)

        if not raw:
            # log.debug(f"Cache miss for {namespace} {key}")
            return None

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
