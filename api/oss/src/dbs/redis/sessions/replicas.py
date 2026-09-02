"""Runner replica census.

The direct control-delivery adapter posts a Stop to ONE service address. With a single runner
process that is exactly right. With two behind a load balancer the call lands on the correct
process only by luck, and the failure is quiet: the wrong process honestly answers "I do not
hold that session", which is also what a session that really ended answers.

So count the replicas. Every heartbeat already computes its own `replica_id`; each beat adds one
sorted-set entry scored by the time of the beat, and delivery reads how many distinct ids have
beaten inside the census window. One write per beat, one read per delivery, no key scan.

The set is volatile Redis, like every other coordination key, and it is deliberately NOT
project-scoped: a replica is a process, not a tenant.
"""

import time
from typing import List

from oss.src.dbs.redis.shared.engine import LockEngine

RUNNER_REPLICAS_KEY = "runner:replicas"

# Long enough that a set entry outlives a few missed beats, short enough that a replica removed
# in a deploy stops counting quickly.
_REPLICAS_KEY_TTL_SECONDS = 3600


async def record_replica_beat(
    engine: LockEngine,
    *,
    replica_id: str,
    now: float = None,
) -> None:
    """Note that `replica_id` is alive. Never raises: a census failure must not fail a beat."""
    if not replica_id:
        return
    stamp = now if now is not None else time.time()
    try:
        await engine.zadd(RUNNER_REPLICAS_KEY, {replica_id.encode(): stamp})
        await engine.expire(RUNNER_REPLICAS_KEY, _REPLICAS_KEY_TTL_SECONDS)
    except Exception:  # noqa: BLE001 — bookkeeping, never a reason to drop a heartbeat
        return


async def recent_replicas(
    engine: LockEngine,
    *,
    window_seconds: int,
    now: float = None,
) -> List[str]:
    """The replica ids that beat inside the window, oldest first. Empty on any Redis failure,
    which reads as "cannot tell" and must not by itself refuse a delivery."""
    stamp = now if now is not None else time.time()
    floor = stamp - window_seconds
    try:
        members = await engine.zrangebyscore(RUNNER_REPLICAS_KEY, floor, "+inf")
    except Exception:  # noqa: BLE001
        return []
    return [m.decode() if isinstance(m, bytes) else str(m) for m in members]
