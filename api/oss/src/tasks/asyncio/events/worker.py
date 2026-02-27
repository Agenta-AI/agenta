import os
from collections import defaultdict
from typing import TYPE_CHECKING, Dict, List, Optional, Tuple
from uuid import UUID

from redis.asyncio import Redis

from oss.src.core.events.service import EventsService
from oss.src.core.events.streaming import EventMessage, deserialize_event
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Flag

if TYPE_CHECKING:
    from oss.src.tasks.asyncio.webhooks.dispatcher import WebhooksDispatcher

EventKey = Tuple[Optional[UUID], UUID]


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
        webhooks_dispatcher: Optional["WebhooksDispatcher"] = None,
    ):
        self.service = service
        self.redis = redis_client
        self.stream_name = stream_name
        self.consumer_group = consumer_group
        self.consumer_name = consumer_name or f"worker-{os.getpid()}"
        self.max_batch_size = max_batch_size
        self.max_block_ms = max_block_ms
        self.webhooks_dispatcher = webhooks_dispatcher

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
    ) -> Tuple[int, List[bytes], Dict[EventKey, List[EventMessage]]]:
        messages_by_key: Dict[EventKey, List[EventMessage]] = defaultdict(list)
        processed_ids: List[bytes] = []

        for msg_id, data in batch:
            try:
                payload = data[b"data"]
                msg = deserialize_event(payload=payload)
                key: EventKey = (msg.organization_id, msg.project_id)
                messages_by_key[key].append(msg)
                processed_ids.append(msg_id)
            except Exception as e:
                log.error(f"[EVENTS] Failed to deserialize message {msg_id!r}: {e}")
                # ACK unprocessable messages to prevent PEL buildup
                processed_ids.append(msg_id)

        total_ingested = 0

        for (organization_id, project_id), msgs in messages_by_key.items():
            if organization_id and is_ee():
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
                        batch_size=len(msgs),
                    )
                    continue

            total_ingested += await self.service.ingest(
                project_id=project_id,
                events=[msg.to_event() for msg in msgs],
            )

        return total_ingested, processed_ids, messages_by_key

    async def run(self):
        log.info(
            "[EVENTS] Worker started",
            stream=self.stream_name,
            group=self.consumer_group,
            consumer=self.consumer_name,
            webhooks=self.webhooks_dispatcher is not None,
        )

        while True:
            try:
                batch = await self.read_batch()
                if not batch:
                    continue

                ingested, processed_ids, messages_by_key = await self.process_batch(
                    batch
                )

                # --- webhook dispatch parenthesis ---
                dispatch_ok = True
                if self.webhooks_dispatcher and messages_by_key:
                    try:
                        await self.webhooks_dispatcher.dispatch(messages_by_key)
                    except Exception as e:
                        log.error(
                            f"[EVENTS] Webhook dispatch error: {e}", exc_info=True
                        )
                        dispatch_ok = False
                # --- end webhook dispatch -----------

                if not dispatch_ok:
                    log.warning(
                        "[EVENTS] Skipping ACK/DEL because webhook dispatch failed",
                        batch_size=len(batch),
                    )
                    continue

                await self.ack_and_delete(processed_ids)
                log.debug(
                    "[EVENTS] Batch processed",
                    batch_size=len(batch),
                    ingested=ingested,
                )
            except Exception as e:
                log.error(f"[EVENTS] Worker loop error: {e}", exc_info=True)
