"""Each organization's running agent turns, as one Redis sorted set: member = turn id,
score = when its hold expires (Redis server time, milliseconds). Expired holds are
dropped before every count, so a runner that died stops counting on its own."""

from uuid import UUID

# KEYS[1] set, KEYS[2] the turn's release marker; ARGV[1] turn id, ARGV[2] limit, ARGV[3] ttl
# ms. 1 = held, 0 = at the limit. Holding clears the marker: the same turn id may run again
# (a resume after an approval).
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
redis.call('DEL', KEYS[2])
return 1
"""

# KEYS[1] set, KEYS[2] the turn's release marker; ARGV[1] turn id, ARGV[2] ttl ms. A beat
# that lands after its turn's release (it was in flight, or timed out at the runner and still
# reached Redis) must not hold the slot again.
_RENEW = """
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local ttl = tonumber(ARGV[2])
redis.call('ZADD', KEYS[1], now + ttl, ARGV[1])
redis.call('PEXPIRE', KEYS[1], ttl)
return 1
"""


# KEYS[1] set, KEYS[2] release marker; ARGV[1] turn id, ARGV[2] marker ttl ms.
_RELEASE = """
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], 1, 'PX', tonumber(ARGV[2]))
return 1
"""

# Longer than any beat can be in flight.
RELEASED_MARKER_SECONDS = 600


def _key(organization_id: UUID) -> str:
    return f"wallets:turns:{organization_id}"


def _released_key(organization_id: UUID, turn_id: str) -> str:
    return f"wallets:turns:{organization_id}:released:{turn_id}"


class RedisTurnSlots:
    def __init__(self, *, redis_client):
        self.redis_client = redis_client

    async def acquire(
        self, *, organization_id: UUID, turn_id: str, limit: int, ttl_seconds: int
    ) -> bool:
        held = await self.redis_client.eval(
            _ACQUIRE,
            2,
            _key(organization_id),
            _released_key(organization_id, turn_id),
            turn_id,
            limit,
            ttl_seconds * 1000,
        )
        return int(held) == 1

    async def renew(
        self, *, organization_id: UUID, turn_id: str, ttl_seconds: int
    ) -> None:
        await self.redis_client.eval(
            _RENEW,
            2,
            _key(organization_id),
            _released_key(organization_id, turn_id),
            turn_id,
            ttl_seconds * 1000,
        )

    async def release(self, *, organization_id: UUID, turn_id: str) -> None:
        await self.redis_client.eval(
            _RELEASE,
            2,
            _key(organization_id),
            _released_key(organization_id, turn_id),
            turn_id,
            RELEASED_MARKER_SECONDS * 1000,
        )
