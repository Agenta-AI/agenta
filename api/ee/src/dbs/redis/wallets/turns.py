"""Each organization's running agent turns, as one Redis sorted set: member = turn id,
score = when its hold expires (Redis server time, milliseconds). Expired holds are
dropped before every count, so a runner that died stops counting on its own."""

from uuid import UUID

# KEYS[1] set; ARGV[1] turn id, ARGV[2] limit, ARGV[3] ttl ms. 1 = held, 0 = at the limit.
_ACQUIRE = """
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local ttl = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) and
   redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  return 0
end
redis.call('ZADD', KEYS[1], now + ttl, ARGV[1])
redis.call('PEXPIRE', KEYS[1], ttl)
return 1
"""

# KEYS[1] set; ARGV[1] turn id, ARGV[2] ttl ms.
_RENEW = """
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local ttl = tonumber(ARGV[2])
redis.call('ZADD', KEYS[1], now + ttl, ARGV[1])
redis.call('PEXPIRE', KEYS[1], ttl)
return 1
"""


def _key(organization_id: UUID) -> str:
    return f"wallets:turns:{organization_id}"


class RedisTurnSlots:
    def __init__(self, *, redis_client):
        self.redis_client = redis_client

    async def acquire(
        self, *, organization_id: UUID, turn_id: str, limit: int, ttl_seconds: int
    ) -> bool:
        held = await self.redis_client.eval(
            _ACQUIRE, 1, _key(organization_id), turn_id, limit, ttl_seconds * 1000
        )
        return int(held) == 1

    async def renew(
        self, *, organization_id: UUID, turn_id: str, ttl_seconds: int
    ) -> None:
        await self.redis_client.eval(
            _RENEW, 1, _key(organization_id), turn_id, ttl_seconds * 1000
        )

    async def release(self, *, organization_id: UUID, turn_id: str) -> None:
        await self.redis_client.zrem(_key(organization_id), turn_id)
