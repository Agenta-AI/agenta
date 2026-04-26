from typing import TYPE_CHECKING, Optional

from oss.src.utils.env import env

if TYPE_CHECKING:
    from redis.asyncio import Redis


class CacheEngine:
    """Redis volatile — caching and distributed locks."""

    def __init__(self) -> None:
        from redis.asyncio import Redis

        self._r: Optional[Redis] = None
        self._r_lock: Optional[Redis] = None

    def get_r(self) -> "Redis":
        if self._r is None:
            from redis.asyncio import Redis

            self._r = Redis.from_url(
                url=env.redis.uri_volatile,
                decode_responses=False,
                socket_timeout=0.5,
            )
        return self._r

    def get_r_lock(self) -> "Redis":
        if self._r_lock is None:
            from redis.asyncio import Redis

            AGENTA_LOCK_SOCKET_TIMEOUT = 30

            self._r_lock = Redis.from_url(
                url=env.redis.uri_volatile,
                decode_responses=False,
                socket_timeout=AGENTA_LOCK_SOCKET_TIMEOUT,
            )
        return self._r_lock

    async def close(self) -> None:
        if self._r is not None:
            await self._r.close()
            self._r = None
        if self._r_lock is not None:
            await self._r_lock.close()
            self._r_lock = None


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
_streams_engine: Optional[StreamsEngine] = None


def get_cache_engine() -> CacheEngine:
    global _cache_engine
    if _cache_engine is None:
        _cache_engine = CacheEngine()
    return _cache_engine


def get_streams_engine() -> StreamsEngine:
    global _streams_engine
    if _streams_engine is None:
        _streams_engine = StreamsEngine()
    return _streams_engine
