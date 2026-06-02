from typing import TYPE_CHECKING, Optional

from oss.src.utils.env import env

if TYPE_CHECKING:
    from redis.asyncio import Redis


class CacheEngine:
    """Redis volatile — caching (short socket timeout).

    Lazily opens a single client and delegates unknown attributes to it, so
    callers use `cache_engine.get(...)`, `cache_engine.scan(...)`, etc. directly
    (no separate accessor). Distributed locks use `LockEngine` instead — it has
    a longer socket timeout suited to blocking lock operations.
    """

    # 0.5s — cache ops are fast; fail quickly rather than stall a request.
    _SOCKET_TIMEOUT = 0.5

    def __init__(self) -> None:
        from redis.asyncio import Redis

        self._r: Optional[Redis] = None

    def _client(self) -> "Redis":
        if self._r is None:
            from redis.asyncio import Redis

            self._r = Redis.from_url(
                url=env.redis.uri_volatile,
                decode_responses=False,
                socket_timeout=self._SOCKET_TIMEOUT,
            )
        return self._r

    def __getattr__(self, name: str):
        # Only reached for attributes not found normally (so `_r`, `_client`,
        # `close`, etc. are unaffected). Proxies redis client methods.
        return getattr(self._client(), name)

    async def close(self) -> None:
        if self._r is not None:
            await self._r.close()
            self._r = None


class LockEngine:
    """Redis volatile — distributed locks (long socket timeout).

    Same volatile Redis as `CacheEngine`, but a separate client with a longer
    socket timeout because lock operations may block. Delegates unknown
    attributes to its lazy client, so callers use `lock_engine.set(...)`,
    `lock_engine.eval(...)`, etc. directly.
    """

    # 30s — lock ops may block (e.g. waiting to acquire); don't time out early.
    _SOCKET_TIMEOUT = 30

    def __init__(self) -> None:
        from redis.asyncio import Redis

        self._r: Optional[Redis] = None

    def _client(self) -> "Redis":
        if self._r is None:
            from redis.asyncio import Redis

            self._r = Redis.from_url(
                url=env.redis.uri_volatile,
                decode_responses=False,
                socket_timeout=self._SOCKET_TIMEOUT,
            )
        return self._r

    def __getattr__(self, name: str):
        return getattr(self._client(), name)

    async def close(self) -> None:
        if self._r is not None:
            await self._r.close()
            self._r = None


class StreamsEngine:
    """Redis durable — persistent streams for tracing/events."""

    def __init__(self) -> None:
        from redis.asyncio import Redis

        self._redis: Optional[Redis] = None

    def get_redis(self) -> "Redis":
        if self._redis is None:
            from redis.asyncio import Redis

            if not env.redis.uri_durable:
                raise RuntimeError("REDIS_URI_DURABLE is required for streams.")
            self._redis = Redis.from_url(env.redis.uri_durable, decode_responses=False)
        return self._redis

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.close()
            self._redis = None


_cache_engine: Optional[CacheEngine] = None
_lock_engine: Optional[LockEngine] = None
_streams_engine: Optional[StreamsEngine] = None


def get_cache_engine() -> CacheEngine:
    global _cache_engine
    if _cache_engine is None:
        _cache_engine = CacheEngine()
    return _cache_engine


def get_lock_engine() -> LockEngine:
    global _lock_engine
    if _lock_engine is None:
        _lock_engine = LockEngine()
    return _lock_engine


def get_streams_engine() -> StreamsEngine:
    global _streams_engine
    if _streams_engine is None:
        _streams_engine = StreamsEngine()
    return _streams_engine
