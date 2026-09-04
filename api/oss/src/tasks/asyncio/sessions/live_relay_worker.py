from datetime import datetime, timezone
from typing import Dict, List, Tuple

from orjson import dumps

from oss.src.core.sessions.records.streaming import (
    DurableEventMessage,
    LiveFrameMessage,
    deserialize_live_relay_message,
)
from oss.src.dbs.redis.sessions.contract import live_events_channel
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class LiveRelayWorker(StreamConsumer):
    log_prefix = "[SESSION-LIVE-RELAY]"

    async def create_consumer_group(self):
        try:
            await self.redis.xgroup_create(
                name=self.stream_name,
                groupname=self.consumer_group,
                id="$",
                mkstream=True,
            )
        except Exception as exc:
            if "BUSYGROUP" not in str(exc):
                raise

    async def process_batch(
        self,
        batch: List[Tuple[bytes, Dict[bytes, bytes]]],
    ) -> Tuple[int, List[bytes]]:
        processed_ids: List[bytes] = []
        published = 0
        cutoff = (
            datetime.now(timezone.utc).timestamp()
            - env.sessions.live_frame_max_age_seconds
        )

        for msg_id, data in batch:
            processed_ids.append(msg_id)
            try:
                message = deserialize_live_relay_message(payload=data[b"data"])
                envelope = (
                    message.frame
                    if isinstance(message, LiveFrameMessage)
                    else message.event
                )
                created_at = envelope.created_at
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=timezone.utc)
                if created_at.timestamp() < cutoff:
                    continue
                await self.redis.publish(
                    live_events_channel(str(message.project_id), envelope.session_id),
                    dumps(envelope.model_dump(mode="json")),
                )
                published += 1
            except Exception:
                log.warning(
                    "[SESSION-LIVE-RELAY] Frame relay failed",
                    msg_id=repr(msg_id),
                    exc_info=True,
                )

        return published, processed_ids
