import os
from typing import Dict, List, Tuple, Optional
from uuid import UUID

from redis.asyncio import Redis

from oss.src.core.events.dtos import EventIngestDTO
from oss.src.core.events.service import EventsService
from oss.src.tasks.asyncio.events.utils import deserialize_event
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Flag


class EventsWorker:
    def __init__(
        self,
        service: EventsService,
        redis_client: Redis,
        stream_name: str,
        consumer_group: str,
        consumer_name: Optional[str] = None,
        max_batch_size: int = 100,
        max_block_ms: int = 5000,
    ):
        self.service = service
        self.redis = redis_client
        self.stream_name = stream_name
        self.consumer_group = consumer_group
        self.consumer_name = consumer_name or f"worker-{os.getpid()}"
        self.max_batch_size = max_batch_size
        self.max_block_ms = max_block_ms

    async def create_consumer_group(self):
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
                raise

    async def read_batch(self) -> List[Tuple[bytes, Dict[bytes, bytes]]]:
        messages = await self.redis.xreadgroup(
            groupname=self.consumer_group,
            consumername=self.consumer_name,
            streams={self.stream_name: ">"},
            count=self.max_batch_size,
            block=self.max_block_ms,
        )
        if not messages:
            return []
        return messages[0][1]

    async def ack_and_delete(self, message_ids: List[bytes]):
        if not message_ids:
            return
        await self.redis.xack(self.stream_name, self.consumer_group, *message_ids)
        await self.redis.xdel(self.stream_name, *message_ids)

    async def process_batch(
        self, batch: List[Tuple[bytes, Dict[bytes, bytes]]]
    ) -> Tuple[int, List[bytes]]:
        event_dtos_by_org: Dict[UUID, List[EventIngestDTO]] = {}
        event_dtos_without_org: List[EventIngestDTO] = []
        processed_ids: List[bytes] = []

        for msg_id, data in batch:
            try:
                payload = data[b"data"]
                event_dto = deserialize_event(payload=payload)
                if event_dto.organization_id:
                    event_dtos_by_org.setdefault(event_dto.organization_id, []).append(
                        event_dto
                    )
                else:
                    event_dtos_without_org.append(event_dto)
                processed_ids.append(msg_id)
            except Exception as e:
                log.error(f"[EVENTS] Failed to deserialize message {msg_id!r}: {e}")

        total_ingested = 0

        # Ingest records that have no organization scope (OSS/local paths)
        if event_dtos_without_org:
            total_ingested += await self.service.ingest(
                event_dtos=event_dtos_without_org
            )

        if not event_dtos_by_org:
            return total_ingested, processed_ids

        # Fast entitlement gate with cache, per organization
        for organization_id, org_events in event_dtos_by_org.items():
            if is_ee():
                try:
                    allowed, _, _ = await check_entitlements(
                        organization_id=organization_id,
                        key=Flag.ACCESS,
                        use_cache=True,
                    )
                except Exception as e:
                    log.error(
                        f"[EVENTS] Entitlements check failed for org {organization_id}: {e}"
                    )
                    continue

                if not allowed:
                    log.warning(
                        "[EVENTS] Access denied by entitlements, dropping org batch",
                        org_id=str(organization_id),
                        batch_size=len(org_events),
                    )
                    continue

            total_ingested += await self.service.ingest(event_dtos=org_events)

        if total_ingested == 0:
            return 0, processed_ids

        return total_ingested, processed_ids

    async def run(self):
        log.info(
            "[EVENTS] Worker started",
            stream=self.stream_name,
            group=self.consumer_group,
            consumer=self.consumer_name,
        )

        while True:
            try:
                batch = await self.read_batch()
                if not batch:
                    continue

                ingested, processed_ids = await self.process_batch(batch)
                await self.ack_and_delete(processed_ids)
                log.debug(
                    "[EVENTS] Batch processed",
                    batch_size=len(batch),
                    ingested=ingested,
                )
            except Exception as e:
                log.error(f"[EVENTS] Worker loop error: {e}", exc_info=True)
