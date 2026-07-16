"""Shared TaskIQ RedisStreamBroker mixins.

`TrimOnAckRedisStreamBroker` XDELs each entry right after XACK. Without it, a
TaskIQ queue retains every acked entry until maxlen-trims it, so XLEN reflects
retained history (a rolling maxlen window) rather than backlog — the stream
workers already XACK+XDEL, so this makes the queues match. XDEL fires only on
ack (a terminal state), so retries (re-kicked as new messages) and crash
redelivery (unacked, reclaimed via XAUTOCLAIM from the PEL) are unaffected.

`ProducerOnlyRedisStreamBroker` skips consumer-group declaration on startup, for
a broker used only to register tasks and `.kiq()` — never to `.listen()`. The
base `startup()` unconditionally XGROUP-CREATEs a group that then sits at 0-0
forever (0 consumers), reporting lag == XLEN permanently.
"""

from typing import Awaitable, Callable

from redis.asyncio import Redis
from taskiq_redis import RedisStreamBroker
from taskiq_redis.redis_broker import BaseRedisBroker


class TrimOnAckRedisStreamBroker(RedisStreamBroker):
    def _ack_generator(self, id: str, queue_name: str) -> Callable[[], Awaitable[None]]:
        async def _ack() -> None:
            async with Redis(connection_pool=self.connection_pool) as redis_conn:
                await redis_conn.xack(queue_name, self.consumer_group_name, id)
                await redis_conn.xdel(queue_name, id)

        return _ack


class ProducerOnlyRedisStreamBroker(RedisStreamBroker):
    async def startup(self) -> None:
        await BaseRedisBroker.startup(self)
