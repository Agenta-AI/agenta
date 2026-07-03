"""
TracingWorker - consumes from streams:otlp.

Replaces the in-memory asyncio.Queue worker from PR #1223 with Redis Streams.
Keeps the same batching, grouping, and entitlements logic.
"""

import asyncio
from typing import Dict, List, Tuple, Optional
from uuid import UUID
from redis.asyncio import Redis

from oss.src.core.tracing.service import TracingService
from oss.src.core.tracing.dtos import OTelFlatSpan
from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee
from oss.src.core.tracing.streaming import deserialize_span
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer

log = get_module_logger(__name__)

if is_ee():
    from ee.src.core.access.entitlements.service import (
        check_entitlements,
        scope_from,
        Counter,
    )


class TracingWorker(StreamConsumer):
    """
    Worker for tracing spans ingestion via Redis Streams.

    Consumes from: streams:tracing
    Consumer group: worker-tracing

    Flow:
    1. Read batch from Redis Streams (XREADGROUP) — StreamConsumer
    2. Deserialize spans from bytes
    3. Group by organization_id → (project_id, user_id)
    4. Check entitlements per org (Layer 2 - authoritative)
    5. Bulk create spans per project/user if allowed
    6. ACK + DEL messages — StreamConsumer
    """

    log_prefix = "[INGEST]"

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
        super().__init__(
            redis_client=redis_client,
            stream_name=stream_name,
            consumer_group=consumer_group,
            consumer_name=consumer_name,
            max_batch_size=max_batch_size,
            max_block_ms=max_block_ms,
            max_delay_ms=max_delay_ms,
            max_batch_mb=max_batch_mb,
        )
        self.service = service

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
                    log.warning(
                        "[INGEST] Batch size limit exceeded, stopping batch processing",
                        batch_bytes=batch_bytes,
                        max_mb=self.max_batch_mb,
                        processed_count=processed_count,
                    )
                    break

                # Deserialize (handles zlib decompression)
                msg = deserialize_span(span_bytes=span_bytes)

                # Group by org → (project, user)
                spans_by_org.setdefault(msg.organization_id, {}).setdefault(
                    (msg.project_id, msg.user_id), []
                ).append(msg.span_dto)

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
                    # Layer 2: Authoritative DB check + adjust (cache=False for hard check)
                    allowed, meter, rollback = await check_entitlements(  # type: ignore
                        key=Counter.TRACES_INGESTED,  # type: ignore
                        delta=delta,
                        scope=scope_from(organization_id=organization_id),  # type: ignore
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
