"""Shared TaskIQ RedisStreamBroker mixins.

`TrimOnAckRedisStreamBroker` XDELs each entry right after XACK. Without it, a
TaskIQ queue retains every acked entry until maxlen-trims it, so XLEN reflects
retained history (a rolling maxlen window) rather than backlog — the stream
workers already XACK+XDEL, so this makes the queues match. XDEL fires only on
ack (a terminal state), so retries (re-kicked as new messages) and crash
redelivery (unacked, reclaimed via XAUTOCLAIM from the PEL) are unaffected.

`ProducerOnlyMixin` skips consumer-group declaration on startup, for a broker
used only to register tasks and `.kiq()` — never to `.listen()`. The base
`startup()` unconditionally XGROUP-CREATEs a group that then sits at 0-0 forever
(0 consumers), reporting lag == XLEN permanently. Every producer broker (one per
queue) must mix this in; only the consumer side declares the group.

`stable_consumer_name()` derives the consumer name from the container id
(`HOSTNAME`), so it is unique per concurrent process — N replicas get N distinct
names and never collide on one PEL — while being far more legible than the base
broker's per-construction `uuid4()`. The name still rotates per redeploy (new
container id), so pair it with `prune_idle_consumers()` at boot to bound registry
growth: without pruning, each redeploy leaves a dead consumer behind and the
group registry climbs to tens of thousands of idle (pending=0) entries.
"""

import os
import socket
from typing import Awaitable, Callable

from redis.asyncio import Redis
from taskiq_redis import RedisStreamBroker
from taskiq_redis.redis_broker import BaseRedisBroker


def stable_consumer_name(consumer_group_name: str) -> str:
    """Per-container consumer name: unique per concurrent process (N-replica safe)."""
    host = os.environ.get("HOSTNAME") or socket.gethostname()
    return f"{consumer_group_name}@{host}"


# 24h: a rolling deploy runs old+new replicas concurrently, so a live peer's
# idle time never approaches this — only long-dead containers get pruned.
PRUNE_MIN_IDLE_MS = 24 * 60 * 60 * 1000


async def prune_idle_consumers(
    *,
    url: str,
    queue_name: str,
    consumer_group_name: str,
    min_idle_ms: int = PRUNE_MIN_IDLE_MS,
    keep: str | None = None,
) -> int:
    """DELCONSUMER every idle, empty (pending=0) consumer in the group.

    Bounds registry growth from per-redeploy consumer-name rotation. Only removes
    consumers with pending=0 (DELCONSUMER on a consumer holding pending entries
    would silently orphan them) and idle >= `min_idle_ms`, and never `keep` (this
    process's own name). Best-effort: swallows errors so a prune failure never
    blocks worker startup.
    """
    removed = 0
    try:
        async with Redis.from_url(url) as redis_conn:
            try:
                consumers = await redis_conn.xinfo_consumers(
                    queue_name, consumer_group_name
                )
            except Exception:
                return 0
            for c in consumers:
                name = c["name"]
                name = name.decode() if isinstance(name, bytes) else name
                if name == keep:
                    continue
                if int(c["pending"]) != 0 or int(c["idle"]) < min_idle_ms:
                    continue
                try:
                    await redis_conn.xgroup_delconsumer(
                        queue_name, consumer_group_name, name
                    )
                    removed += 1
                except Exception:
                    continue
    except Exception:
        return removed
    return removed


class TrimOnAckRedisStreamBroker(RedisStreamBroker):
    def _ack_generator(self, id: str, queue_name: str) -> Callable[[], Awaitable[None]]:
        async def _ack() -> None:
            async with Redis(connection_pool=self.connection_pool) as redis_conn:
                await redis_conn.xack(queue_name, self.consumer_group_name, id)
                await redis_conn.xdel(queue_name, id)

        return _ack


class ProducerOnlyMixin:
    """Skip consumer-group declaration on startup — for `.kiq()`-only brokers."""

    async def startup(self) -> None:
        await BaseRedisBroker.startup(self)


class ProducerOnlyRedisStreamBroker(ProducerOnlyMixin, RedisStreamBroker):
    pass
