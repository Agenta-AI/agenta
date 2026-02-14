"""
TracingWorker - consumes from streams:otlp.

Replaces the in-memory asyncio.Queue worker from PR #1223 with Redis Streams.
Keeps the same batching, grouping, and entitlements logic.
"""

import os
import asyncio
import time
from typing import Dict, List, Tuple, Optional
from uuid import UUID
from redis.asyncio import Redis

from oss.src.core.tracing.service import TracingService
from oss.src.core.tracing.dtos import OTelFlatSpan
from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee
from oss.src.tasks.asyncio.tracing.utils import serialize_span, deserialize_span

log = get_module_logger(__name__)

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Counter


class TracingWorker:
    """
    Worker for tracing spans ingestion via Redis Streams.

    Consumes from: streams:tracing
    Consumer group: worker-tracing

    Flow:
    1. Read batch from Redis Streams (XREADGROUP)
    2. Deserialize spans from bytes
    3. Group by organization_id → (project_id, user_id)
    4. Check entitlements per org (Layer 2 - authoritative)
    5. Bulk create spans per project/user if allowed
    6. ACK + DEL messages
    """

    def __init__(
        self,
        service: TracingService,
        redis_client: Redis,
        stream_name: str,
        consumer_group: str,
        consumer_name: Optional[str] = None,
        max_batch_size: int = 50,  # 50 spans
        max_block_ms: int = 5000,  # 5 seconds
        max_delay_ms: int = 250,  # 250 milliseconds
        max_batch_mb: int = 50,  # 50 MB
    ):
        """
        Initialize tracing worker.

        Args:
            service: TracingService instance for creating spans
            redis_client: Redis async client
            stream_name: Name of the stream (e.g., "streams:tracing")
            consumer_group: Consumer group name (e.g., "worker-tracing")
            consumer_name: Consumer name (defaults to "worker-{pid}")
            max_batch_size: Max messages to read per batch (COUNT in XREADGROUP)
            max_block_ms: Max milliseconds to block waiting for messages
            max_batch_mb: Max batch size in megabytes (default: 100MB)
            max_delay_ms: Max milliseconds to wait for batch accumulation when small batches arrive (default: 100ms)
        """
        self.service = service
        self.redis = redis_client
        self.stream_name = stream_name
        self.consumer_group = consumer_group
        self.consumer_name = consumer_name or f"worker-{os.getpid()}"
        self.max_batch_size = max_batch_size
        self.max_block_ms = max_block_ms
        self.max_batch_mb = max_batch_mb
        self.max_delay_ms = max_delay_ms

    async def publish_to_stream(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        span_dtos: List[OTelFlatSpan],
    ) -> int:
        """
        Publish spans to Redis Streams.

        Args:
            organization_id: Organization UUID
            project_id: Project UUID
            user_id: User UUID
            span_dtos: Spans to publish

        Returns:
            Number of spans published
        """
        count = 0

        for span_dto in span_dtos:
            span_bytes = serialize_span(
                organization_id=organization_id,
                project_id=project_id,
                user_id=user_id,
                span_dto=span_dto,
            )

            await self.redis.xadd(
                name=self.stream_name,
                fields={"data": span_bytes},
            )

            count += 1

        return count

    async def create_consumer_group(self):
        """
        Create consumer group if it doesn't exist.

        Safe to call multiple times (idempotent).
        """
        try:
            await self.redis.xgroup_create(
                name=self.stream_name,
                groupname=self.consumer_group,
                id="0",  # Start from beginning for new group
                mkstream=True,  # Create stream if it doesn't exist
            )
            log.info(
                "[INGEST] Created consumer group",
                stream=self.stream_name,
                group=self.consumer_group,
            )
        except Exception as e:
            # BUSYGROUP means group already exists - this is fine
            if "BUSYGROUP" not in str(e):
                log.error(f"[INGEST] Failed to create consumer group: {e}")
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
            # 1. Initial blocking read
            messages = await self.redis.xreadgroup(
                groupname=self.consumer_group,
                consumername=self.consumer_name,
                streams={self.stream_name: ">"},  # Only new messages
                count=self.max_batch_size,
                block=self.max_block_ms,
            )

            if not messages:
                # log.warning(
                #     "[INGEST] Empty batch! (timeout)",
                # )
                return []

            # messages format: [(stream_name, [(id, data), (id, data), ...])]
            stream_data = messages[0]
            batch = stream_data[1]  # [(id, data), ...]

            # 2. If batch is small, accumulate more spans within time window
            if len(batch) < self.max_batch_size:
                # Record when accumulation starts (after initial read returns)
                start_time = time.time()
                accumulated_total = 0

                while True:
                    elapsed = (time.time() - start_time) * 1000  # Convert to ms
                    remaining_ms = self.max_delay_ms - elapsed

                    # Stop if we've exceeded the max delay window
                    if remaining_ms <= 0:
                        break

                    # Blocking read with remaining time to wait for more spans
                    accumulated_messages = await self.redis.xreadgroup(
                        groupname=self.consumer_group,
                        consumername=self.consumer_name,
                        streams={self.stream_name: ">"},
                        count=self.max_batch_size,
                        block=max(10, int(remaining_ms)),  # Block for remaining time
                    )

                    if accumulated_messages:
                        accumulated_batch = accumulated_messages[0][1]
                        batch.extend(accumulated_batch)
                        accumulated_total += len(accumulated_batch)

                        elapsed = (time.time() - start_time) * 1000  # Update elapsed

                        # Stop if we've reached target batch size
                        if len(batch) >= self.max_batch_size:
                            break
                    # If no messages, loop will check time and either read again or break

            # Calculate batch size in bytes
            return batch

        except Exception as e:
            log.error(f"[INGEST] Failed to read batch: {e}")
            return []

    async def ack_and_delete(self, message_ids: List[bytes]):
        """
        ACK and DELETE messages after successful processing.

        Args:
            message_ids: List of message IDs to acknowledge
        """
        if not message_ids:
            return

        try:
            # ACK messages (mark as processed in consumer group)
            await self.redis.xack(
                self.stream_name,
                self.consumer_group,
                *message_ids,
            )

            # DEL messages (remove from stream)
            await self.redis.xdel(self.stream_name, *message_ids)

        except Exception as e:
            log.error(f"[INGEST] Failed to ACK/DEL messages: {e}")
            # Don't raise - messages will remain pending and can be claimed later

    async def process_batch(
        self, batch: List[Tuple[bytes, Dict[bytes, bytes]]]
    ) -> Tuple[int, List[bytes]]:
        """
        Process batch of tracing spans with dual-limit enforcement.

        Enforces both span count (100 max) and configurable byte size limits.
        Stops processing when hitting either limit and leaves remaining
        messages for next batch processing.

        Args:
            batch: List of (message_id, {b"data": serialized_span}) tuples

        Returns:
            Tuple of (processed_count, processed_message_ids) for ACK/DEL
        """
        # Group spans by org → (project, user) (same as PR #1223)
        spans_by_org: Dict[UUID, Dict[Tuple[UUID, UUID], List[OTelFlatSpan]]] = {}
        processed_message_ids: List[bytes] = []
        batch_bytes = 0
        processed_count = 0

        # 1. Deserialize & group by org + project/user (with size enforcement)
        for msg_id, data in batch:
            try:
                # Extract serialized span from Redis message
                span_bytes = data[b"data"]

                # Track cumulative batch size (compressed size)
                batch_bytes += len(span_bytes)

                # Check if we've exceeded the batch size limit
                if batch_bytes > self.max_batch_mb * 1024 * 1024:
                    # log.warning(
                    #     "[INGEST] Batch size limit exceeded, stopping batch processing",
                    #     batch_bytes=batch_bytes,
                    #     max_mb=self.max_batch_mb,
                    #     processed_count=processed_count,
                    # )
                    break

                # Deserialize (handles zlib decompression)
                (
                    organization_id,
                    project_id,
                    user_id,
                    span_dto,
                ) = deserialize_span(span_bytes=span_bytes)

                # Group by org → (project, user)
                spans_by_org.setdefault(organization_id, {}).setdefault(
                    (project_id, user_id), []
                ).append(span_dto)

                processed_message_ids.append(msg_id)
                processed_count += 1

            except Exception as e:
                log.error(
                    f"[INGEST] Failed to deserialize span: {e}",
                    msg_id=msg_id,
                )
                # ACK unprocessable messages to prevent PEL buildup
                processed_message_ids.append(msg_id)

        if not spans_by_org:
            return (processed_count, processed_message_ids)

        # 2. Enforce entitlements per org (Layer 2, authoritative - same as PR #1223)
        for organization_id, spans_by_proj_user in spans_by_org.items():
            # Count root spans (delta)
            delta = sum(
                len([s for s in spans if s.parent_id is None])
                for spans in spans_by_proj_user.values()
            )

            meter = None
            allowed = True

            if is_ee() and delta > 0:
                try:
                    # Layer 2: Authoritative DB check + adjust (use_cache=False for hard check)
                    allowed, meter, rollback = await check_entitlements(
                        organization_id=organization_id,
                        key=Counter.TRACES,
                        delta=delta,
                        use_cache=False,
                    )

                    if not allowed:
                        log.warning(
                            "[INGEST] Quota exceeded, dropping batch",
                            org_id=str(organization_id),
                            delta=delta,
                        )
                        continue  # Skip this org's spans

                except Exception as e:
                    log.error(
                        "[INGEST] Entitlements check failed",
                        org_id=str(organization_id),
                        error=str(e),
                    )
                    # On error, drop batch to be safe
                    continue

            # 3. Create spans per project/user
            for (project_id, user_id), span_dtos in spans_by_proj_user.items():
                try:
                    await self.service.ingest(
                        project_id=project_id,
                        user_id=user_id,
                        span_dtos=span_dtos,
                    )

                except Exception as e:
                    log.error(
                        "[INGEST] Failed to create spans",
                        org_id=str(organization_id),
                        project_id=str(project_id),
                        user_id=str(user_id),
                        error=str(e),
                        exc_info=True,
                    )
                    # Sleep briefly to avoid hammering DB on errors
                    await asyncio.sleep(0.05)

        # Return count and message IDs for ACK/DEL
        return (processed_count, processed_message_ids)

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
            "[INGEST] Starting worker",
            stream=self.stream_name,
            consumer_group=self.consumer_group,
            consumer=self.consumer_name,
            max_batch_size=self.max_batch_size,
        )

        while True:
            try:
                # 1. Read batch from stream
                batch = await self.read_batch()
                if not batch:
                    continue

                # 3. Process batch (returns count and processed message IDs)
                processed_count, processed_message_ids = await self.process_batch(batch)

                # 4. ACK and DELETE only the processed messages
                if processed_message_ids:
                    await self.ack_and_delete(processed_message_ids)

            except Exception:
                log.error(
                    "[INGEST] Error in worker loop",
                    exc_info=True,
                )
                # Sleep before retry to avoid tight error loop
                await asyncio.sleep(1)
