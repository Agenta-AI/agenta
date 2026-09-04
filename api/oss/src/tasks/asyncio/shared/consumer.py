"""
StreamConsumer - shared base for the Redis Streams consumer loops.

Extracted from tracing/records/events workers, which were the same program
copy-pasted three times (create_consumer_group/read_batch/ack_and_delete/run
were byte-identical). Subclasses provide only `process_batch` (and may
override `run` when they need an extra stage around it, e.g. events' webhook
dispatch with skip-ack-on-failure).

Batch Configuration:
- max_batch_size: 50 (XREADGROUP COUNT) - max messages per read
- max_block_ms: 5000ms (XREADGROUP BLOCK) - max wait time when queue is empty
- max_batch_mb: 50 - max batch size in megabytes
- max_delay_ms: 250ms - max wait time for batch accumulation when small batches arrive

Redelivery (opt-in, `reclaim_pending`):
- reclaim_min_idle_ms: 30000 - how long an unacknowledged entry sits before it is retried
- max_deliveries: 5 - deliveries after which an entry is dropped loudly instead of retried
"""

import time
import asyncio
from typing import Dict, List, Optional, Tuple

from redis.asyncio import Redis

from oss.src.tasks.taskiq.shared.broker import stable_consumer_name
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class StreamConsumer:
    """
    Base class for a Redis Streams consumer-group loop.

    Flow:
    1. Read batch from Redis Streams (XREADGROUP), or reclaim entries an earlier
       pass left unacknowledged (opt-in, see `reclaim_batch`)
    2. `process_batch` (subclass): deserialize, group, meter, write
    3. ACK + DEL the message ids `process_batch` reports as durable
    """

    #: Short tag prepended to log messages by subclasses (e.g. "[INGEST]").
    log_prefix: str = "[STREAM]"

    def __init__(
        self,
        redis_client: Redis,
        stream_name: str,
        consumer_group: str,
        consumer_name: Optional[str] = None,
        max_batch_size: int = 50,  # 50 messages
        max_block_ms: int = 5000,  # 5 seconds
        max_delay_ms: int = 250,  # 250 milliseconds
        max_batch_mb: int = 50,  # 50 MB
        reclaim_pending: bool = False,
        reclaim_min_idle_ms: int = 30_000,  # 30 seconds
        max_deliveries: int = 5,
    ):
        self.redis = redis_client
        self.stream_name = stream_name
        self.consumer_group = consumer_group
        self.metric_stream = consumer_group.removeprefix("worker-")
        # Container-unique consumer name (PID is always 1 in a container, so it
        # can't distinguish replicas): all replicas share consumer_group and
        # Redis fans out work across the distinct per-container consumers.
        self.consumer_name = consumer_name or stable_consumer_name(consumer_group)
        self.max_batch_size = max_batch_size
        self.max_block_ms = max_block_ms
        self.max_batch_mb = max_batch_mb
        self.max_delay_ms = max_delay_ms
        self.reclaim_pending = reclaim_pending
        self.reclaim_min_idle_ms = reclaim_min_idle_ms
        self.max_deliveries = max_deliveries
        #: Messages this process gave up on. Only ever grows; read by tests and logs.
        self.dropped_messages = 0
        self._last_reclaim_at = 0.0

    async def create_consumer_group(self):
        """Create consumer group if it doesn't exist. Safe to call multiple times (idempotent)."""
        try:
            await self.redis.xgroup_create(
                name=self.stream_name,
                groupname=self.consumer_group,
                id="0",  # Start from beginning for new group
                mkstream=True,  # Create stream if it doesn't exist
            )
            log.info(
                f"{self.log_prefix} Created consumer group",
                stream=self.stream_name,
                group=self.consumer_group,
            )
        except Exception as e:
            # BUSYGROUP means group already exists - this is fine
            if "BUSYGROUP" not in str(e):
                log.error(f"{self.log_prefix} Failed to create consumer group: {e}")
                raise

    async def read_batch(self) -> List[Tuple[bytes, Dict[bytes, bytes]]]:
        """
        Read batch from stream using XREADGROUP with time-based accumulation.

        Strategy:
        1. Read up to max_batch_size messages with max_block_ms timeout
        2. If batch is smaller than max_batch_size, start accumulation timer and accumulate more messages
        3. Continuously do blocking reads with remaining time until max_delay_ms elapsed from accumulation start
        4. Return combined batch once full or time window expires

        Returns:
            List of (message_id, {field: value}) tuples
        """
        try:
            messages = await self.redis.xreadgroup(
                groupname=self.consumer_group,
                consumername=self.consumer_name,
                streams={self.stream_name: ">"},  # Only new messages
                count=self.max_batch_size,
                block=self.max_block_ms,
            )

            if not messages:
                return []

            # messages format: [(stream_name, [(id, data), (id, data), ...])]
            batch = messages[0][1]  # [(id, data), ...]

            # If batch is small, accumulate more messages within time window
            if len(batch) < self.max_batch_size:
                start_time = time.time()

                while True:
                    elapsed = (time.time() - start_time) * 1000  # Convert to ms
                    remaining_ms = self.max_delay_ms - elapsed

                    if remaining_ms <= 0:
                        break

                    accumulated_messages = await self.redis.xreadgroup(
                        groupname=self.consumer_group,
                        consumername=self.consumer_name,
                        streams={self.stream_name: ">"},
                        count=self.max_batch_size,
                        block=max(10, int(remaining_ms)),
                    )

                    if accumulated_messages:
                        batch.extend(accumulated_messages[0][1])
                        if len(batch) >= self.max_batch_size:
                            break

            return batch

        except Exception as e:
            log.error(f"{self.log_prefix} Failed to read batch: {e}")
            return []

    def describe_message(self, data: Dict[bytes, bytes]) -> Optional[str]:
        """Subclass hook: a short identity for a dropped message, for the loss log."""
        return None

    def is_permanent_failure(
        self,
        msg_id: bytes,
        data: Dict[bytes, bytes],
    ) -> bool:
        """Subclass hook: whether this exact message is known not to succeed on retry."""
        return False

    async def reclaim_batch(self) -> List[Tuple[bytes, Dict[bytes, bytes]]]:
        """Re-deliver entries an earlier pass left unacknowledged.

        `read_batch` only ever asks Redis for `>`, so an entry that is never acknowledged is
        invisible to every later read of this group. Without this pass, "skip the ACK so Redis
        retries it" means "lose it quietly with a growing pending list". Redis' delivery count
        bounds retries only for a message the subclass has identified as permanently invalid;
        it cannot distinguish a poison message from a transient write-path outage.
        """
        if not self.reclaim_pending:
            return []

        # One XPENDING per idle window, not one per loop turn: a busy stream spins this loop
        # as fast as Postgres answers, and the pending list cannot change faster than the
        # window anyway.
        now = time.monotonic()
        if (now - self._last_reclaim_at) * 1000 < self.reclaim_min_idle_ms:
            return []
        self._last_reclaim_at = now

        try:
            pending = await self.redis.xpending_range(
                name=self.stream_name,
                groupname=self.consumer_group,
                min="-",
                max="+",
                count=self.max_batch_size,
                # A zero window means "no idle filter", not "idle exactly zero".
                idle=self.reclaim_min_idle_ms or None,
            )
        except Exception as e:
            log.error(f"{self.log_prefix} Failed to read pending entries: {e}")
            return []

        if not pending:
            return []

        deliveries = {
            entry["message_id"]: int(entry["times_delivered"]) for entry in pending
        }

        try:
            claimed = await self.redis.xclaim(
                name=self.stream_name,
                groupname=self.consumer_group,
                consumername=self.consumer_name,
                min_idle_time=self.reclaim_min_idle_ms,
                message_ids=list(deliveries.keys()),
            )
        except Exception as e:
            log.error(f"{self.log_prefix} Failed to claim pending entries: {e}")
            return []

        # XCLAIM returns nothing for an entry whose stream payload is already gone (MAXLEN
        # trim), and removes it from the pending list itself.
        retry: List[Tuple[bytes, Dict[bytes, bytes]]] = []
        expired: List[Tuple[bytes, Dict[bytes, bytes]]] = []
        over_budget = 0
        for msg_id, data in claimed:
            if not data:
                continue
            if deliveries.get(msg_id, 1) >= self.max_deliveries:
                over_budget += 1
                if self.is_permanent_failure(msg_id, data):
                    expired.append((msg_id, data))
                    continue
            retry.append((msg_id, data))

        if expired:
            await self.drop_expired(expired)
        elif over_budget:
            log.warning(
                f"{self.log_prefix} Keeping over-budget messages: failure is not known to be permanent",
                stream=self.stream_name,
                group=self.consumer_group,
                count=over_budget,
            )

        if retry:
            log.warning(
                f"{self.log_prefix} Redelivering unacknowledged messages",
                stream=self.stream_name,
                group=self.consumer_group,
                count=len(retry),
            )

        return retry

    async def drop_expired(self, entries: List[Tuple[bytes, Dict[bytes, bytes]]]):
        """Give up on entries that failed `max_deliveries` times, loudly.

        This is data loss. It is preferred over an unbounded retry because a single entry the
        write path can never accept would otherwise stall every later entry in the group. The
        log line names each lost message so the loss is countable after the fact.
        """
        self.dropped_messages += len(entries)
        log.error(
            f"{self.log_prefix} Dropping messages after repeated delivery failures",
            stream=self.stream_name,
            group=self.consumer_group,
            max_deliveries=self.max_deliveries,
            count=len(entries),
            messages=[
                self.describe_message(data) or repr(msg_id) for msg_id, data in entries
            ],
            dropped_total=self.dropped_messages,
        )
        await self.ack_and_delete([msg_id for msg_id, _ in entries])

    async def ack_and_delete(self, message_ids: List[bytes]):
        """ACK and DELETE messages after successful processing."""
        if not message_ids:
            return

        try:
            await self.redis.xack(
                self.stream_name,
                self.consumer_group,
                *message_ids,
            )
            await self.redis.xdel(self.stream_name, *message_ids)
        except Exception as e:
            log.error(f"{self.log_prefix} Failed to ACK/DEL messages: {e}")
            # Don't raise - messages will remain pending and can be claimed later

    async def process_batch(
        self, batch: List[Tuple[bytes, Dict[bytes, bytes]]]
    ) -> Tuple[int, List[bytes]]:
        """Process one batch. Subclasses implement deserialize/group/meter/write."""
        raise NotImplementedError

    async def run(self):
        """
        Main worker loop.

        Flow:
        1. Reclaim entries an earlier pass left unacknowledged, else read via XREADGROUP
        2. Process batch
        3. ACK + DEL only the message ids `process_batch` reports as durable
        4. Everything else stays pending and comes back through step 1
        """
        log.info(
            f"{self.log_prefix} Starting worker",
            stream=self.stream_name,
            consumer_group=self.consumer_group,
            consumer=self.consumer_name,
            max_batch_size=self.max_batch_size,
        )

        while True:
            try:
                batch = await self.reclaim_batch()
                if not batch:
                    batch = await self.read_batch()
                if not batch:
                    continue

                _, processed_message_ids = await self.process_batch(batch)

                if processed_message_ids:
                    await self.ack_and_delete(processed_message_ids)

            except Exception:
                log.error(
                    f"{self.log_prefix} Error in worker loop",
                    exc_info=True,
                )
                # Sleep before retry to avoid tight error loop
                await asyncio.sleep(1)
