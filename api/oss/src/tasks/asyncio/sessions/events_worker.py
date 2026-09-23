from typing import Dict, List, Tuple

from oss.src.tasks.asyncio.sessions.streaming import deserialize_turn_event
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class SessionEventsWorker(StreamConsumer):
    """
    Worker for session-turn events via dedicated Redis stream.

    Consumes from: streams:sessions
    Consumer group: worker-sessions

    Flow:
    1. Read batch from stream (XREADGROUP) — StreamConsumer
    2. Deserialize messages
    3. Log each turn-started/turn-ended event
    4. ACK + DEL messages — StreamConsumer

    Minimal by design: this only proves the stream is observable. A consumer
    that acts on the events is the subscriber's own to build.
    """

    log_prefix = "[SESSIONS]"

    async def process_batch(
        self,
        batch: List[Tuple[bytes, Dict[bytes, bytes]]],
    ) -> Tuple[int, List[bytes]]:
        processed_ids: List[bytes] = []

        for msg_id, data in batch:
            try:
                payload = data[b"data"]
                turn_event = deserialize_turn_event(payload=payload)
                log.info(
                    "[SESSIONS] Turn event observed",
                    kind=turn_event.kind,
                    project_id=str(turn_event.project_id),
                    session_id=turn_event.session_id,
                    turn_id=turn_event.turn_id,
                )
                processed_ids.append(msg_id)
            except Exception:
                log.error(
                    "[SESSIONS] Failed to deserialize message",
                    msg_id=repr(msg_id),
                    exc_info=True,
                )
                processed_ids.append(msg_id)

        return len(processed_ids), processed_ids
