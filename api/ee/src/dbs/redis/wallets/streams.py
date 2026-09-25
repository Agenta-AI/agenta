"""Redis publishers for the two wallet streams.

Best-effort: a failed publish is logged and reported as `False`, never raised into the
caller.
"""

from redis.asyncio import Redis

from oss.src.utils.logging import get_module_logger

from ee.src.core.wallets.contracts import (
    STREAM_DEBITS,
    STREAM_MEASUREMENTS,
    DebitCommandV1,
    MeasurementCommandV1,
)
from ee.src.core.wallets.streaming import (
    serialize_debit_command,
    serialize_measurement_command,
)

log = get_module_logger(__name__)

# The consumers XDEL every entry they finish, so a stream's length is its unprocessed
# backlog. A MAXLEN trim would delete the oldest of that backlog, pending or not; the limit
# is enforced by refusing the publish instead, which the publisher reports and logs.
MAX_BACKLOG = 100_000


async def _xadd(*, redis: Redis, stream: str, payload: bytes) -> bool:
    try:
        # Not atomic with the XADD: concurrent publishers can overshoot by a few entries,
        # which is harmless for a limit whose only job is to stop unbounded growth.
        backlog = await redis.xlen(stream)
        if backlog >= MAX_BACKLOG:
            log.error(
                f"[WALLETS] {stream} backlog is at its limit; not published",
                backlog=backlog,
                max_backlog=MAX_BACKLOG,
            )
            return False

        await redis.xadd(name=stream, fields={"data": payload})
        return True
    except Exception as e:
        log.error(f"[WALLETS] Failed to publish to {stream}: {e}", exc_info=True)
        return False


class RedisMeasurementPublisher:
    """Called by the API request after it already has the managed gateway result. A failed
    publish means no persisted measurement and no debit, but never changes that result."""

    def __init__(self, *, redis_client: Redis):
        self.redis_client = redis_client

    async def publish(self, command: MeasurementCommandV1) -> bool:
        return await _xadd(
            redis=self.redis_client,
            stream=STREAM_MEASUREMENTS,
            payload=serialize_measurement_command(command),
        )


class RedisDebitPublisher:
    """Used only by the measurement worker, for a charge it has already decided to make."""

    def __init__(self, *, redis_client: Redis):
        self.redis_client = redis_client

    async def publish(self, command: DebitCommandV1) -> bool:
        return await _xadd(
            redis=self.redis_client,
            stream=STREAM_DEBITS,
            payload=serialize_debit_command(command),
        )
