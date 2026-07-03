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
"""

import os
import time
import asyncio
from typing import Dict, List, Optional, Tuple

from redis.asyncio import Redis

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class StreamConsumer:
    """
    Base class for a Redis Streams consumer-group loop.

    Flow:
    1. Read batch from Redis Streams (XREADGROUP)
    2. `process_batch` (subclass): deserialize, group, meter, write
    3. ACK + DEL processed messages
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
    ):
        self.redis = redis_client
        self.stream_name = stream_name
        self.consumer_group = consumer_group
        # Per-pid consumer name — what makes horizontal scale-up safe: all
        # replicas share consumer_group, Redis fans out work across consumers.
        self.consumer_name = consumer_name or f"worker-{os.getpid()}"
        self.max_batch_size = max_batch_size
        self.max_block_ms = max_block_ms
        self.max_batch_mb = max_batch_mb
        self.max_delay_ms = max_delay_ms

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
        1. Read batch via XREADGROUP
        2. Process batch
        3. ACK + DEL on success
        4. On error, messages remain pending for retry
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
                started = time.perf_counter()
                batch = await self.read_batch()
                if not batch:
                    continue

                processed_count, processed_message_ids = await self.process_batch(batch)

                if processed_message_ids:
                    await self.ack_and_delete(processed_message_ids)

                log.tick(
                    f"{self.consumer_group}.processed",
                    count=processed_count,
                    duration_ms=(time.perf_counter() - started) * 1000,
                    dims={"stream": self.stream_name},
                )

            except Exception:
                log.error(
                    f"{self.log_prefix} Error in worker loop",
                    exc_info=True,
                )
                log.tick(
                    f"{self.consumer_group}.errors",
                    dims={"stream": self.stream_name},
                )
                # Sleep before retry to avoid tight error loop
                await asyncio.sleep(1)
