"""
TracingWorker - consumes from streams:otlp.

Replaces the in-memory asyncio.Queue worker from PR #1223 with Redis Streams.
Keeps the same batching, grouping, and entitlements logic.
"""

import os
import asyncio
from typing import Dict, List, Tuple, Optional
from uuid import UUID
from redis.asyncio import Redis

from oss.src.core.tracing.service import TracingService
from oss.src.core.tracing.dtos import OTelFlatSpan
from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee

log = get_module_logger(__name__)

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Counter


class TracingWorker:
    """
    Worker for tracing spans ingestion via Redis Streams.

    Consumes from: streams:otlp
    Consumer group: otlp-workers

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
        batch_size: int = 100,
        block_ms: int = 5000,
        max_batch_bytes: int = 100 * 1024 * 1024,  # 100MB default
    ):
        """
        Initialize tracing worker.

        Args:
            service: TracingService instance for creating spans
            redis_client: Redis async client
            stream_name: Name of the stream (e.g., "streams:otlp")
            consumer_group: Consumer group name (e.g., "otlp-workers")
            consumer_name: Consumer name (defaults to "worker-{pid}")
            batch_size: Max messages to read per batch (COUNT in XREADGROUP)
            block_ms: Max milliseconds to block waiting for messages
            max_batch_bytes: Max batch size in bytes (default: 100MB)
        """
        self.service = service
        self.redis = redis_client
        self.stream_name = stream_name
        self.consumer_group = consumer_group
        self.consumer_name = consumer_name or f"worker-{os.getpid()}"
        self.batch_size = batch_size
        self.block_ms = block_ms
        self.max_batch_bytes = max_batch_bytes

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
        Read batch from stream using XREADGROUP.

        Returns:
            List of (message_id, {field: value}) tuples
        """
        try:
            messages = await self.redis.xreadgroup(
                groupname=self.consumer_group,
                consumername=self.consumer_name,
                streams={self.stream_name: ">"},  # Only new messages
                count=self.batch_size,
                block=self.block_ms,
            )

            if not messages:
                log.warning("[INGEST] Empty batch! (timeout)")
                return []

            # messages format: [(stream_name, [(id, data), (id, data), ...])]
            stream_data = messages[0]
            batch = stream_data[1]  # Return [(id, data), ...]

            # Calculate batch size in bytes
            batch_bytes = sum(len(data.get(b"data", b"")) for _, data in batch)
            batch_mb = batch_bytes / (1024 * 1024)

            log.debug(
                "[INGEST] Read batch from stream",
                batch_size=len(batch),
                batch_bytes=batch_bytes,
                batch_bytes_mb=batch_mb,
                max_batch_size=self.batch_size,
            )

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

            log.debug(f"[INGEST] ACKed and deleted {len(message_ids)} messages")

        except Exception as e:
            log.error(f"[INGEST] Failed to ACK/DEL messages: {e}")
            # Don't raise - messages will remain pending and can be claimed later

    async def process_batch(
        self, batch: List[Tuple[bytes, Dict[bytes, bytes]]]
    ) -> Tuple[int, List[bytes]]:
        """
        Process batch of tracing spans with dual-limit enforcement.

        Enforces both span count (100 max) and byte size (100MB max) limits.
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
                if batch_bytes > self.max_batch_bytes:
                    log.warning(
                        "[INGEST] Batch size limit exceeded, stopping batch processing",
                        batch_bytes=batch_bytes,
                        max_bytes=self.max_batch_bytes,
                        processed_count=processed_count,
                    )
                    break

                # Deserialize using service method (handles zlib decompression)
                (
                    organization_id,
                    project_id,
                    user_id,
                    span_dto,
                ) = self.service.deserialize(span_bytes=span_bytes)

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
                # Continue processing other messages

        if not spans_by_org:
            log.debug(
                "[INGEST] No valid spans in batch",
                processed_count=processed_count,
                batch_bytes=batch_bytes,
            )
            return (processed_count, processed_message_ids)

        log.debug(
            "[INGEST] Batch deserialized and grouped",
            processed_count=processed_count,
            batch_bytes=batch_bytes,
            batch_bytes_mb=batch_bytes / (1024 * 1024),
            org_count=len(spans_by_org),
        )

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
                    await self.service.create(
                        project_id=project_id,
                        user_id=user_id,
                        span_dtos=span_dtos,
                    )

                    log.debug(
                        "[INGEST] Created spans",
                        org_id=str(organization_id),
                        project_id=str(project_id),
                        user_id=str(user_id),
                        count=len(span_dtos),
                    )

                    # Meter already adjusted by check_entitlements(use_cache=False)
                    # Just cache it for soft checks (Layer 1) in OTLP router
                    if is_ee() and meter and allowed:
                        try:
                            meter_data = {
                                "value": meter.value,
                                "synced": meter.synced,
                                "delta": meter.delta,
                                "month": meter.month,
                                "year": meter.year,
                                "key": meter.key,
                            }
                            await self.service.set_meter_cache(
                                organization_id=organization_id,
                                meter_data=meter_data,
                                ttl=3600,  # 1 hour cache
                            )

                            log.debug(
                                "[INGEST] Cached meter after adjustment",
                                org_id=str(organization_id),
                                delta=delta,
                            )

                        except Exception as e:
                            log.error(
                                "[INGEST] Failed to cache meter",
                                org_id=str(organization_id),
                                error=str(e),
                                exc_info=True,
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
            batch_size=self.batch_size,
        )

        while True:
            try:
                # 1. Read batch from stream
                batch = await self.read_batch()
                if not batch:
                    continue

                log.debug(
                    "[INGEST] Processing batch",
                    count=len(batch),
                )

                # 3. Process batch (returns count and processed message IDs)
                processed_count, processed_message_ids = await self.process_batch(batch)

                log.debug(
                    "[INGEST] Batch processing complete",
                    total_count=len(batch),
                    processed_count=processed_count,
                    remaining_count=len(batch) - processed_count,
                )

                # 4. ACK and DELETE only the processed messages
                if processed_message_ids:
                    await self.ack_and_delete(processed_message_ids)

            except Exception as e:
                log.error(
                    "[INGEST] Error in worker loop: {e}",
                    exc_info=True,
                )
                # Sleep before retry to avoid tight error loop
                await asyncio.sleep(1)
