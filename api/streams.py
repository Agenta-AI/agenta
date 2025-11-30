"""
Redis Streams workers for OTLP tracing ingestion.

Consumes from: streams:otlp (durable Redis instance)

See /sandbox/architecture/redis.split.specs.md for architecture details.
"""

import sys
import asyncio
import os
from typing import Dict, List, Tuple, Optional
from uuid import UUID
from redis.asyncio import Redis

from oss.src.core.tracing.service import TracingService
from oss.src.core.tracing.dtos import OTelFlatSpan
from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee
from oss.src.utils.helpers import warn_deprecated_env_vars, validate_required_env_vars
from oss.src.utils.env import env

from oss.src.dbs.postgres.tracing.dao import TracingDAO

log = get_module_logger(__name__)

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Counter


class TracingWorker:
    """
    Worker for tracing spans ingestion via Redis Streams.

    Consumes from: streams:otlp (durable Redis)
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
    ):
        """
        Initialize tracing worker.

        Args:
            service: TracingService instance for creating spans
            redis_client: Redis async client (durable instance)
            stream_name: Name of the stream (e.g., "streams:otlp")
            consumer_group: Consumer group name (e.g., "otlp-workers")
            consumer_name: Consumer name (defaults to "worker-{pid}")
            batch_size: Max messages to read per batch (COUNT in XREADGROUP)
            block_ms: Max milliseconds to block waiting for messages
        """
        self.service = service
        self.redis = redis_client
        self.stream_name = stream_name
        self.consumer_group = consumer_group
        self.consumer_name = consumer_name or f"worker-{os.getpid()}"
        self.batch_size = batch_size
        self.block_ms = block_ms

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
                "[TracingWorker] Created consumer group",
                stream=self.stream_name,
                group=self.consumer_group,
            )
        except Exception as e:
            # BUSYGROUP means group already exists - this is fine
            if "BUSYGROUP" not in str(e):
                log.error(f"[TracingWorker] Failed to create consumer group: {e}")
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
                return []

            # messages format: [(stream_name, [(id, data), (id, data), ...])]
            stream_data = messages[0]
            return stream_data[1]  # Return [(id, data), ...]

        except Exception as e:
            log.error(f"[TracingWorker] Failed to read batch: {e}")
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

            log.debug(f"[TracingWorker] ACKed and deleted {len(message_ids)} messages")

        except Exception as e:
            log.error(f"[TracingWorker] Failed to ACK/DEL messages: {e}")
            # Don't raise - messages will remain pending and can be claimed later

    async def process_batch(self, batch: List[Tuple[bytes, Dict[bytes, bytes]]]):
        """
        Process batch of tracing spans.

        Args:
            batch: List of (message_id, {b"data": serialized_span}) tuples
        """
        # Group spans by org → (project, user)
        spans_by_org: Dict[UUID, Dict[Tuple[UUID, UUID], List[OTelFlatSpan]]] = {}

        # 1. Deserialize & group by org + project/user
        for msg_id, data in batch:
            try:
                # Extract serialized span from Redis message
                span_bytes = data[b"data"]

                # Deserialize
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

            except Exception as e:
                log.error(
                    f"[TracingWorker] Failed to deserialize span: {e}",
                    msg_id=msg_id,
                )
                # Continue processing other messages

        if not spans_by_org:
            log.debug("[TracingWorker] No valid spans in batch")
            return

        # 2. Enforce entitlements per org (Layer 2, authoritative)
        for organization_id, spans_by_proj_user in spans_by_org.items():
            # Count root spans (delta)
            delta = sum(
                len([s for s in spans if s.parent_span_id is None])
                for spans in spans_by_proj_user.values()
            )

            if is_ee() and delta > 0:
                try:
                    # Layer 2: Authoritative DB check + adjust
                    allowed, meter, rollback = await check_entitlements(
                        organization_id=organization_id,
                        key=Counter.TRACES,
                        delta=delta,
                        use_cache=False,  # Authoritative check in worker
                    )

                    if not allowed:
                        log.warning(
                            "[TracingWorker] Quota exceeded, dropping batch",
                            org_id=str(organization_id),
                            delta=delta,
                        )
                        continue  # Skip this org's spans

                except Exception as e:
                    log.error(
                        "[TracingWorker] Entitlements check failed",
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
                        "[TracingWorker] Created spans",
                        org_id=str(organization_id),
                        project_id=str(project_id),
                        user_id=str(user_id),
                        count=len(span_dtos),
                    )

                except Exception as e:
                    log.error(
                        "[TracingWorker] Failed to create spans",
                        org_id=str(organization_id),
                        project_id=str(project_id),
                        user_id=str(user_id),
                        error=str(e),
                        exc_info=True,
                    )
                    # Sleep briefly to avoid hammering DB on errors
                    await asyncio.sleep(0.05)

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
            "[TracingWorker] Starting worker",
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

                # 2. Extract message IDs for ACK later
                message_ids = [msg_id for msg_id, _ in batch]

                log.debug(
                    "[TracingWorker] Processing batch",
                    count=len(batch),
                )

                # 3. Process batch
                await self.process_batch(batch)

                # 4. ACK and DELETE on success
                await self.ack_and_delete(message_ids)

            except Exception as e:
                log.error(
                    "[TracingWorker] Error in worker loop",
                    error=str(e),
                    exc_info=True,
                )
                # Sleep before retry to avoid tight error loop
                await asyncio.sleep(1)


async def main_async() -> int:
    """
    Main async entry point for tracing worker.

    Creates and runs TracingWorker for consuming from streams:otlp (durable Redis).

    Returns:
        Exit code (0 for success, non-zero for failure)
    """
    try:
        log.info("[Streams] Initializing tracing worker")

        # Validate environment
        warn_deprecated_env_vars()
        validate_required_env_vars()

        # Create durable Redis client for streams
        redis_client = Redis.from_url(env.REDIS_URI_STREAMS, decode_responses=False)

        # Initialize DAO
        tracing_dao = TracingDAO()

        # Initialize service
        tracing_service = TracingService(
            tracing_dao=tracing_dao,
        )

        # Initialize worker
        tracing_worker = TracingWorker(
            service=tracing_service,
            redis_client=redis_client,
            stream_name="streams:otlp",
            consumer_group="otlp-workers",
            batch_size=100,  # From OTLP specs: max 1000, but 100 is reasonable
            block_ms=5000,  # 5s block time
        )

        # Create consumer group (idempotent)
        await tracing_worker.create_consumer_group()

        log.info("[Streams] Starting tracing worker")

        # Run worker
        await tracing_worker.run()

        return 0

    except Exception as e:
        log.error("[Streams] Fatal error", error=str(e), exc_info=True)
        return 1


def main() -> int:
    """
    Main entry point for streams workers.

    Returns:
        Exit code (0 for success, non-zero for failure)
    """
    try:
        return asyncio.run(main_async())
    except KeyboardInterrupt:
        log.info("[Streams] Shutdown requested")
        return 0
    except Exception as e:
        log.error("[Streams] Fatal error", error=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
