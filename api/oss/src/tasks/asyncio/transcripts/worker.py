import asyncio
import os
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from redis.asyncio import Redis

from oss.src.core.transcripts.service import TranscriptsService
from oss.src.core.transcripts.streaming import deserialize_transcript
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

if is_ee():
    from ee.src.core.access.entitlements.service import check_entitlements, scope_from
    from ee.src.core.access.entitlements.types import Counter


class TranscriptsWorker:
    """
    Worker for transcript ingestion via dedicated Redis stream.

    Consumes from: streams:transcripts
    Consumer group: worker-transcripts

    Flow:
    1. Read batch from stream (XREADGROUP)
    2. Deserialize messages
    3. Group by project_id
    4. EE: L2 quota check per org (Counter.TRANSCRIPTS_INGESTED)
    5. Append transcript events to DB
    6. ACK + DEL messages
    """

    def __init__(
        self,
        service: TranscriptsService,
        redis_client: Redis,
        stream_name: str,
        consumer_group: str,
        consumer_name: Optional[str] = None,
        max_batch_size: int = 50,
        max_block_ms: int = 5000,
        max_delay_ms: int = 250,
        max_batch_mb: int = 50,
    ):
        self.service = service
        self.redis = redis_client
        self.stream_name = stream_name
        self.consumer_group = consumer_group
        self.consumer_name = consumer_name or f"worker-{os.getpid()}"
        self.max_batch_size = max_batch_size
        self.max_block_ms = max_block_ms
        self.max_delay_ms = max_delay_ms
        self.max_batch_mb = max_batch_mb

    async def create_consumer_group(self):
        """Create consumer group if it doesn't exist (idempotent)."""
        try:
            await self.redis.xgroup_create(
                name=self.stream_name,
                groupname=self.consumer_group,
                id="0",
                mkstream=True,
            )
            log.info(
                "[TRANSCRIPTS] Created consumer group",
                stream=self.stream_name,
                group=self.consumer_group,
            )
        except Exception as e:
            if "BUSYGROUP" not in str(e):
                log.error(
                    "[TRANSCRIPTS] Failed to create consumer group", exc_info=True
                )
                raise

    async def read_batch(self) -> List[Tuple[bytes, Dict[bytes, bytes]]]:
        import time

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

                    accumulated = await self.redis.xreadgroup(
                        groupname=self.consumer_group,
                        consumername=self.consumer_name,
                        streams={self.stream_name: ">"},
                        count=self.max_batch_size,
                        block=max(10, int(remaining_ms)),
                    )

                    if accumulated:
                        batch.extend(accumulated[0][1])
                        if len(batch) >= self.max_batch_size:
                            break

            return batch

        except Exception:
            log.error("[TRANSCRIPTS] Failed to read batch", exc_info=True)
            return []

    async def ack_and_delete(self, message_ids: List[bytes]):
        if not message_ids:
            return
        try:
            await self.redis.xack(self.stream_name, self.consumer_group, *message_ids)
            await self.redis.xdel(self.stream_name, *message_ids)
        except Exception:
            log.error("[TRANSCRIPTS] Failed to ACK/DEL messages", exc_info=True)

    async def process_batch(
        self,
        batch: List[Tuple[bytes, Dict[bytes, bytes]]],
    ) -> Tuple[int, List[bytes]]:
        """
        Process batch — deserialize, group by org for EE quota, append to DB.

        Returns (total_appended, processed_message_ids).
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

                msg = deserialize_transcript(payload=payload)
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
                    "[TRANSCRIPTS] Failed to deserialize message",
                    msg_id=repr(msg_id),
                    exc_info=True,
                )
                # Unprocessable messages are ACKed so they don't block the PEL.
                processed_ids.append(msg_id)

        batches = list(groups.values())
        total_appended = 0

        # L2 quota: Counter.TRANSCRIPTS_INGESTED — authoritative charge per org.
        org_allowed: Dict[UUID, bool] = {}
        events_per_org: Dict[UUID, int] = {}

        if is_ee():
            for project_batch in batches:
                org_id = project_batch["organization_id"]
                if org_id is None:
                    continue
                events_per_org[org_id] = events_per_org.get(org_id, 0) + len(
                    project_batch["events"]
                )

            for org_id, delta in events_per_org.items():
                if delta <= 0:
                    org_allowed[org_id] = True
                    continue

                try:
                    quota_allowed, _, _ = await check_entitlements(  # type: ignore
                        key=Counter.TRANSCRIPTS_INGESTED,  # type: ignore
                        delta=delta,
                        scope=scope_from(organization_id=org_id),  # type: ignore
                    )
                except Exception:
                    log.error(
                        "[TRANSCRIPTS] L2 quota check failed",
                        organization_id=str(org_id),
                        exc_info=True,
                    )
                    org_allowed[org_id] = False
                    continue

                if not quota_allowed:
                    log.warning(
                        "[TRANSCRIPTS] Quota exceeded, dropping org batch",
                        organization_id=str(org_id),
                        delta=delta,
                    )
                    org_allowed[org_id] = False
                    continue

                org_allowed[org_id] = True

        for project_batch in batches:
            org_id = project_batch["organization_id"]
            if is_ee() and org_id and not org_allowed.get(org_id, True):
                continue

            for msg in project_batch["events"]:
                try:
                    result = await self.service.append(
                        event=msg.transcript_event,
                    )
                    if result is not None:
                        total_appended += 1
                except Exception:
                    log.error(
                        "[TRANSCRIPTS] Failed to append event",
                        session_id=str(msg.transcript_event.session_id),
                        exc_info=True,
                    )

        return total_appended, processed_ids

    async def run(self):
        log.info(
            "[TRANSCRIPTS] Worker started",
            stream=self.stream_name,
            group=self.consumer_group,
            consumer=self.consumer_name,
            max_batch_size=self.max_batch_size,
        )

        while True:
            try:
                batch = await self.read_batch()
                if not batch:
                    continue

                appended, processed_ids = await self.process_batch(batch)

                await self.ack_and_delete(processed_ids)
                log.info(
                    "[TRANSCRIPTS] Batch processed",
                    batch_size=len(batch),
                    appended=appended,
                )
            except Exception:
                log.error("[TRANSCRIPTS] Worker loop error", exc_info=True)
                await asyncio.sleep(1)
