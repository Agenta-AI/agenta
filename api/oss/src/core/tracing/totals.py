"""
Trace totals: recompute cumulative metrics of traces that arrive in several requests.

Ingest rolls metrics up per OTLP request, so a trace split across requests (an agent
runner exporting under the SDK's workflow span, a BatchSpanProcessor flushing children
before the root) keeps totals that miss the other requests. After the tracing worker
stores spans, it records which requests touched each trace. A trace touched by more
than one request is scheduled once per delay window, then recomputed from all its
stored spans.

A claim moves the trace from the queue to a claims set with a lease deadline, in one
transaction. The worker removes the claim after the recompute. If the recompute fails or
the worker stops, the lease expires and `recover_expired_trace_totals` puts the trace
back in the queue.
"""

import time
from typing import Dict, Iterable, List, Set, Tuple
from uuid import UUID

from redis.asyncio import Redis

TOTALS_QUEUE_KEY = "tracing:totals:queue"
TOTALS_BATCHES_KEY = "tracing:totals:batches:{project_id}:{trace_id}"
TOTALS_CLAIMS_KEY = "tracing:totals:claims"
TOTALS_BATCHES_TTL_S = 24 * 60 * 60
TOTALS_LEASE_MS = 60_000

TraceKey = Tuple[UUID, UUID]


def _member(project_id: UUID, trace_id: UUID) -> str:
    return f"{project_id.hex}:{trace_id.hex}"


def _parse_member(member) -> TraceKey:
    if isinstance(member, bytes):
        member = member.decode()
    project_hex, trace_hex = member.split(":", 1)
    return UUID(hex=project_hex), UUID(hex=trace_hex)


async def schedule_trace_totals(
    redis: Redis,
    *,
    batches_by_trace: Dict[TraceKey, Set[str]],
    delay_ms: int,
) -> int:
    """Record which requests touched each trace; schedule traces touched by several."""
    keys = [key for key, batch_ids in batches_by_trace.items() if batch_ids]
    if not keys:
        return 0

    async with redis.pipeline(transaction=False) as pipe:
        for project_id, trace_id in keys:
            name = TOTALS_BATCHES_KEY.format(
                project_id=project_id.hex, trace_id=trace_id.hex
            )
            pipe.sadd(name, *batches_by_trace[(project_id, trace_id)])
            pipe.expire(name, TOTALS_BATCHES_TTL_S)
            pipe.scard(name)
        results = await pipe.execute()

    due = time.time() + delay_ms / 1000
    scheduled = {
        _member(project_id, trace_id): due
        for index, (project_id, trace_id) in enumerate(keys)
        if int(results[index * 3 + 2]) > 1
    }

    if scheduled:
        # NX keeps the first due time, so a busy trace is recomputed once per window.
        await redis.zadd(TOTALS_QUEUE_KEY, scheduled, nx=True)

    return len(scheduled)


async def claim_due_trace_totals(
    redis: Redis,
    *,
    limit: int,
    lease_ms: int = TOTALS_LEASE_MS,
) -> List[TraceKey]:
    """Take up to `limit` due traces; a trace goes to exactly one caller.

    Each claimed trace stays in the claims set until `complete_trace_totals` removes it,
    or its lease expires and `recover_expired_trace_totals` queues it again.
    """
    now = time.time()
    members: Iterable = await redis.zrangebyscore(
        TOTALS_QUEUE_KEY, "-inf", now, start=0, num=limit
    )
    members = list(members)
    if not members:
        return []

    lease = now + lease_ms / 1000
    async with redis.pipeline(transaction=True) as pipe:
        for member in members:
            pipe.zrem(TOTALS_QUEUE_KEY, member)
            # NX: when another caller won this member, do not extend its lease.
            pipe.zadd(TOTALS_CLAIMS_KEY, {member: lease}, nx=True)
        results = await pipe.execute()

    return [
        _parse_member(member)
        for index, member in enumerate(members)
        if int(results[index * 2]) == 1
    ]


async def complete_trace_totals(
    redis: Redis,
    *,
    trace_keys: Iterable[TraceKey],
) -> None:
    """Remove the claims of recomputed traces."""
    members = [_member(project_id, trace_id) for project_id, trace_id in trace_keys]
    if members:
        await redis.zrem(TOTALS_CLAIMS_KEY, *members)


async def recover_expired_trace_totals(
    redis: Redis,
    *,
    limit: int,
) -> int:
    """Queue again the claimed traces whose lease expired (a failed or lost recompute)."""
    now = time.time()
    members: Iterable = await redis.zrangebyscore(
        TOTALS_CLAIMS_KEY, "-inf", now, start=0, num=limit
    )
    members = list(members)
    if not members:
        return 0

    async with redis.pipeline(transaction=True) as pipe:
        for member in members:
            pipe.zrem(TOTALS_CLAIMS_KEY, member)
            # NX: a request that scheduled the trace again meanwhile keeps its due time.
            pipe.zadd(TOTALS_QUEUE_KEY, {member: now}, nx=True)
        results = await pipe.execute()

    return sum(1 for index in range(len(members)) if int(results[index * 2]) == 1)
