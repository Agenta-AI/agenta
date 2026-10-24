"""Count the Redis commands that the cache helpers send.

`count_redis_calls()` wraps `execute_command` of the Redis client behind
`oss.src.utils.caching` (the volatile cache engine), so every command is recorded, also the
ones sent indirectly (for example inside `MembershipsService.resolve`). Pipelines and
`MGET` go through the same method.
"""

from contextlib import contextmanager
from typing import Iterator, List

from pydantic import BaseModel

from oss.src.dbs.redis.shared.engine import get_cache_engine


class RedisCall(BaseModel):
    command: str
    key: str

    def __eq__(self, other):  # compare with a bare command name too
        if isinstance(other, str):
            return self.command == other
        return super().__eq__(other)

    __hash__ = None


@contextmanager
def count_redis_calls() -> Iterator[List[RedisCall]]:
    client = get_cache_engine()._client()
    calls: List[RedisCall] = []
    original = client.execute_command

    async def _recording(*args, **kwargs):
        command = str(args[0]).upper() if args else "?"
        key = args[1] if len(args) > 1 else b""
        key = key.decode() if isinstance(key, (bytes, bytearray)) else str(key)
        calls.append(RedisCall(command=command, key=key))
        return await original(*args, **kwargs)

    client.execute_command = _recording
    try:
        yield calls
    finally:
        del client.execute_command
