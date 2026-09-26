"""
Trace totals: recompute cumulative metrics of traces that arrive in several requests.

Ingest rolls metrics up per OTLP request, so a trace split across requests (an agent
runner exporting under the SDK's workflow span, a BatchSpanProcessor flushing children
before the root) keeps totals that miss the other requests. After the tracing worker
stores spans, it records which requests touched each trace. A trace touched by more
than one request is scheduled once per delay window, then recomputed from all its
stored spans.

A claim moves the trace from the queue to a claims set with a lease deadline, in one
transaction. Each claim has its own token. The worker removes its claim after the
recompute. If the recompute fails or
the worker stops, the lease expires and `recover_expired_trace_totals` puts the trace
back in the queue.
"""

import time
from typing import Dict, Iterable, List, NamedTuple, Set, Tuple
from uuid import UUID, uuid4

from redis.asyncio import Redis

TOTALS_QUEUE_KEY = "tracing:totals:queue"
TOTALS_BATCHES_KEY = "tracing:totals:batches:{project_id}:{trace_id}"
TOTALS_CLAIMS_KEY = "tracing:totals:claims"
TOTALS_BATCHES_TTL_S = 24 * 60 * 60
TOTALS_LEASE_MS = 60_000

_CLAIM_SEP = "|"

TraceKey = Tuple[UUID, UUID]


class TraceClaim(NamedTuple):
    project_id: UUID
    trace_id: UUID
    claim: str


def _decode(value) -> str:
    return value.decode() if isinstance(value, bytes) else value


def _member(project_id: UUID, trace_id: UUID) -> str:
    return f"{project_id.hex}:{trace_id.hex}"


def _parse_member(member) -> TraceKey:
    member = _decode(member)
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
) -> List[TraceClaim]:
    """Take up to `limit` due traces; a queued trace goes to exactly one caller.

    Each claim has its own token, so a claim is removed only by its owner
    (`complete_trace_totals`) or, when its lease expires, by
    `recover_expired_trace_totals`, which queues the trace again. Two claims of one
    trace (the trace was queued again while a recompute ran) are independent.
    """
    now = time.time()
    members: Iterable = await redis.zrangebyscore(
        TOTALS_QUEUE_KEY, "-inf", now, start=0, num=limit
    )
    members = [_decode(member) for member in members]
    if not members:
        return []

    lease = now + lease_ms / 1000
    claims = [f"{member}{_CLAIM_SEP}{uuid4().hex}" for member in members]
    async with redis.pipeline(transaction=True) as pipe:
        for member, claim in zip(members, claims):
            pipe.zrem(TOTALS_QUEUE_KEY, member)
            pipe.zadd(TOTALS_CLAIMS_KEY, {claim: lease})
        results = await pipe.execute()

    won = [int(results[index * 2]) == 1 for index in range(len(members))]
    lost = [claim for claim, ok in zip(claims, won) if not ok]
    if lost:
        # Another caller took these; if this call fails, the lease only adds a recompute.
        await redis.zrem(TOTALS_CLAIMS_KEY, *lost)

    return [
        TraceClaim(*_parse_member(member), claim)
        for member, claim, ok in zip(members, claims, won)
        if ok
    ]


async def complete_trace_totals(
    redis: Redis,
    *,
    claims: Iterable[str],
) -> None:
    """Remove the given claims after their recompute. Other claims are kept."""
    claims = list(claims)
    if claims:
        await redis.zrem(TOTALS_CLAIMS_KEY, *claims)


async def recover_expired_trace_totals(
    redis: Redis,
    *,
    limit: int,
) -> int:
    """Queue again the claimed traces whose lease expired (a failed or lost recompute)."""
    now = time.time()
    claims: Iterable = await redis.zrangebyscore(
        TOTALS_CLAIMS_KEY, "-inf", now, start=0, num=limit
    )
    claims = [_decode(claim) for claim in claims]
    if not claims:
        return 0

    async with redis.pipeline(transaction=True) as pipe:
        for claim in claims:
            pipe.zrem(TOTALS_CLAIMS_KEY, claim)
            # NX: a request that scheduled the trace again meanwhile keeps its due time.
            # A race with the owner or another recovery only queues one more recompute.
            pipe.zadd(TOTALS_QUEUE_KEY, {claim.split(_CLAIM_SEP, 1)[0]: now}, nx=True)
        results = await pipe.execute()

    return sum(1 for index in range(len(claims)) if int(results[index * 2]) == 1)
