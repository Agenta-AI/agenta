import asyncio
import os
import time
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple
from uuid import UUID

from redis.asyncio import Redis

from oss.src.core.events.service import EventsService
from oss.src.core.events.streaming import deserialize_event
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Flag

if TYPE_CHECKING:
    from oss.src.tasks.asyncio.webhooks.dispatcher import WebhooksDispatcher


class EventsWorker:
    """
    Worker for events ingestion via Redis Streams.

    Consumes from: streams:events
    Consumer group: worker-events

    Flow:
    1. Read batch from Redis Streams (XREADGROUP)
    2. Deserialize events from bytes
    3. Group by project_id
    4. Check entitlements per org (EE only)
    5. Ingest events per project if allowed
    6. Dispatch to webhooks (if configured)
    7. ACK + DEL messages
    """

    def __init__(
        self,
        service: EventsService,
        redis_client: Redis,
        stream_name: str,
        consumer_group: str,
        consumer_name: Optional[str] = None,
        max_batch_size: int = 50,  # 50 events
        max_block_ms: int = 5000,  # 5 seconds
        max_delay_ms: int = 250,  # 250 milliseconds
        max_batch_mb: int = 50,  # 50 MB
        #
        webhooks_dispatcher: Optional["WebhooksDispatcher"] = None,
    ):
        self.service = service
        self.redis = redis_client
        self.stream_name = stream_name
        self.consumer_group = consumer_group
        self.consumer_name = consumer_name or f"worker-{os.getpid()}"
        self.max_batch_size = max_batch_size
        self.max_block_ms = max_block_ms
        self.max_batch_mb = max_batch_mb
        self.max_delay_ms = max_delay_ms
        self.webhooks_dispatcher = webhooks_dispatcher

    async def create_consumer_group(self):
        """Create consumer group if it doesn't exist. Safe to call multiple times (idempotent)."""
        try:
            await self.redis.xgroup_create(
                name=self.stream_name,
                groupname=self.consumer_group,
                id="0",
                mkstream=True,
            )
            log.info(
                "[EVENTS] Created consumer group",
                stream=self.stream_name,
                group=self.consumer_group,
            )
        except Exception as e:
            if "BUSYGROUP" not in str(e):
                log.error("[EVENTS] Failed to create consumer group", exc_info=True)
                raise

    async def read_batch(self) -> List[Tuple[bytes, Dict[bytes, bytes]]]:
        """
        Read batch from stream using XREADGROUP with time-based accumulation.

        Strategy:
        1. Read up to max_batch_size messages with max_block_ms timeout
        2. If batch is smaller than max_batch_size, accumulate more within max_delay_ms window
        3. Return combined batch once full or time window expires

        Returns:
            List of (message_id, {field: value}) tuples
        """
        try:
            messages = await self.redis.xreadgroup(
                groupname=self.consumer_group,
                consumername=self.consumer_name,
                streams={self.stream_name: ">"},
                count=self.max_batch_size,
                block=self.max_block_ms,
            )

            if not messages:
                return []

            batch = messages[0][1]

            if len(batch) < self.max_batch_size:
                start_time = time.time()

                while True:
                    elapsed = (time.time() - start_time) * 1000
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

        except Exception:
            log.error("[EVENTS] Failed to read batch", exc_info=True)
            return []

    async def ack_and_delete(self, message_ids: List[bytes]):
        """ACK and DELETE messages after successful processing."""
        if not message_ids:
            return

        try:
            await self.redis.xack(self.stream_name, self.consumer_group, *message_ids)
            await self.redis.xdel(self.stream_name, *message_ids)
        except Exception:
            log.error("[EVENTS] Failed to ACK/DEL messages", exc_info=True)
            # Don't raise — messages will remain pending and can be claimed later

    async def process_batch(
        self, batch: List[Tuple[bytes, Dict[bytes, bytes]]]
    ) -> Tuple[int, List[bytes], List[Dict[str, Any]]]:
        """
        Process batch of events grouped by project.

        Enforces byte size limit (max_batch_mb) and checks EE entitlements per org.

        Args:
            batch: List of (message_id, {b"data": serialized_event}) tuples

        Returns:
            Tuple of (total_ingested, processed_message_ids, project_batches)
        """
        groups: Dict[UUID, Dict[str, Any]] = {}
        processed_ids: List[bytes] = []
        batch_bytes = 0

        for msg_id, data in batch:
            try:
                payload = data[b"data"]

                batch_bytes += len(payload)
                if batch_bytes > self.max_batch_mb * 1024 * 1024:
                    break

                msg = deserialize_event(payload=payload)
                group = groups.get(msg.project_id)
                if group is None:
                    group = {
                        "organization_id": msg.organization_id,
                        "project_id": msg.project_id,
                        "events": [],
                    }
                    groups[msg.project_id] = group
                group["events"].append(msg)
                processed_ids.append(msg_id)
            except Exception:
                log.error(
                    "[EVENTS] Failed to deserialize message",
                    msg_id=repr(msg_id),
                    exc_info=True,
                )
                # Intentionally ACK unprocessable messages: a malformed message will
                # never succeed on retry, so keeping it in the PEL would block the
                # consumer indefinitely. Drop and log — wontfix by design.
                processed_ids.append(msg_id)

        batches = list(groups.values())
        total_ingested = 0

        for project_batch in batches:
            if project_batch["organization_id"] and is_ee():
                try:
                    allowed, _, _ = await check_entitlements(
                        organization_id=project_batch["organization_id"],
                        key=Flag.ACCESS,
                        use_cache=True,
                    )
                except Exception:
                    log.error(
                        "[EVENTS] Entitlements check failed",
                        organization_id=str(project_batch["organization_id"]),
                        exc_info=True,
                    )
                    continue

                if not allowed:
                    log.warning(
                        "[EVENTS] Access denied by entitlements, dropping org batch",
                        organization_id=str(project_batch["organization_id"]),
                        batch_size=len(project_batch["events"]),
                    )
                    # Intentionally drop and ACK: events for an org that isn't
                    # entitled will never become processable in this batch. Keeping
                    # them in the PEL would block the consumer — wontfix by design.
                    continue

            total_ingested += await self.service.ingest(
                project_id=project_batch["project_id"],
                events=[msg.to_event() for msg in project_batch["events"]],
            )

        return total_ingested, processed_ids, batches

    async def run(self):
        """
        Main worker loop.

        Flow:
        1. Read batch via XREADGROUP
        2. Process batch (returns ingested count, message IDs, project batches)
        3. Dispatch to webhooks (if configured) — skip ACK/DEL on failure to allow retry
        4. ACK + DEL processed messages
        5. On error, messages remain pending for retry
        """
        log.info(
            "[EVENTS] Worker started",
            stream=self.stream_name,
            group=self.consumer_group,
            consumer=self.consumer_name,
            max_batch_size=self.max_batch_size,
            webhooks=self.webhooks_dispatcher is not None,
        )

        while True:
            try:
                # 1. Read batch from stream
                batch = await self.read_batch()
                if not batch:
                    continue

                # 2. Process batch
                ingested, processed_ids, batches = await self.process_batch(batch)

                # 3. Dispatch to webhooks (skip ACK/DEL on failure to allow retry)
                if self.webhooks_dispatcher and batches:
                    try:
                        await self.webhooks_dispatcher.dispatch(batches)
                    except Exception:
                        log.error("[EVENTS] Webhook dispatch failed", exc_info=True)
                        log.warning(
                            "[EVENTS] Skipping ACK/DEL due to webhook dispatch failure",
                            batch_size=len(batch),
                        )
                        continue

                # 4. ACK and DELETE processed messages
                await self.ack_and_delete(processed_ids)
                log.debug(
                    "[EVENTS] Batch processed",
                    batch_size=len(batch),
                    ingested=ingested,
                )
            except Exception:
                log.error("[EVENTS] Worker loop error", exc_info=True)
                await asyncio.sleep(1)
