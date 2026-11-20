"""ChildUpdatesWorker: the consumer of turn-ended signals that writes child updates.

Consumes from: streams:session-turn-ends
Consumer group: worker-sessions-child-updates

It runs beside the channels outbox, off the record ingest loop, so the fold, the result
file and the dispatch of an update never delay the records of other sessions. The
payload is the plain JSON `SessionTurnEvent` that `_publish_turn_event` writes.

Failure rule (design D5): only a short failure (the database or Redis unavailable)
leaves the entry pending, and the reclaim pass delivers it again until the outage ends.
A refusal, a missing calling session, a key conflict or any other failure is logged and
the entry is acknowledged. The key check of the producer makes a repeat write nothing.

One more case is retried, a bounded number of times: `SessionStartNotDurable`, when the
update row is written but its dispatch could not be shown to have started. A retry with
the same key finishes that dispatch and never starts a second turn. A dispatch claim
that stays held makes every retry fail the same way, so after `max_deliveries` the
entry is dropped with the loss log, and the update row stays as the helper left it.
"""

import asyncio
from typing import Dict, List, Optional, Set, Tuple

from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError
from sqlalchemy.exc import DisconnectionError, InterfaceError, OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

from oss.src.core.sessions.child_updates.service import SessionChildUpdatesService
from oss.src.core.sessions.starts.types import SessionStartNotDurable
from oss.src.tasks.asyncio.sessions.streaming import deserialize_turn_event
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

CHILD_UPDATES_CONSUMER_GROUP = "worker-sessions-child-updates"

_SHORT_FAILURES = (
    OperationalError,
    InterfaceError,
    DisconnectionError,
    PoolTimeoutError,
    RedisConnectionError,
    RedisTimeoutError,
    ConnectionError,
    asyncio.TimeoutError,
)


def is_short_failure(error: BaseException) -> bool:
    """True for a failure that a retry can fix: the database or Redis unavailable, or
    a dispatch that could not be shown to have started (`SessionStartNotDurable`)."""
    return isinstance(error, (*_SHORT_FAILURES, SessionStartNotDurable))


class ChildUpdatesWorker(StreamConsumer):
    log_prefix = "[CHILD-UPDATES]"

    def __init__(
        self,
        *,
        service: SessionChildUpdatesService,
        redis_client: Redis,
        stream_name: str,
        consumer_group: str = CHILD_UPDATES_CONSUMER_GROUP,
        consumer_name: Optional[str] = None,
        max_batch_size: int = 50,
        max_block_ms: int = 5000,
        max_delay_ms: int = 250,
        max_batch_mb: int = 50,
        reclaim_min_idle_ms: int = 30_000,
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
            # An entry is left pending only on a short failure; without the reclaim pass
            # nothing would read it again and the calling session would get no update.
            # An outage is retried until it ends; see `is_permanent_failure`.
            reclaim_pending=True,
            reclaim_min_idle_ms=reclaim_min_idle_ms,
        )
        self.service = service
        # Entries whose last failure was `SessionStartNotDurable`, in this process.
        self._not_durable: Set[bytes] = set()

    def is_permanent_failure(self, msg_id: bytes, data: Dict[bytes, bytes]) -> bool:
        """Past `max_deliveries`, only an entry whose last failure here was
        `SessionStartNotDurable` is dropped; an outage keeps its entry."""
        if msg_id not in self._not_durable:
            return False
        self._not_durable.discard(msg_id)
        return True

    def describe_message(self, data: Dict[bytes, bytes]) -> Optional[str]:
        try:
            event = deserialize_turn_event(payload=data[b"data"])
        except Exception:
            return None
        return f"{event.kind} session={event.session_id} turn={event.turn_id}"

    async def process_batch(
        self,
        batch: List[Tuple[bytes, Dict[bytes, bytes]]],
    ) -> Tuple[int, List[bytes]]:
        processed_ids: List[bytes] = []

        for msg_id, data in batch:
            try:
                event = deserialize_turn_event(payload=data[b"data"])
            except Exception:
                log.error(
                    "[CHILD-UPDATES] Failed to deserialize message",
                    msg_id=repr(msg_id),
                    exc_info=True,
                )
                processed_ids.append(msg_id)
                continue

            if event.kind != "turn_ended":
                processed_ids.append(msg_id)
                continue

            try:
                await self.service.handle_turn_ended(
                    project_id=event.project_id,
                    session_id=event.session_id,
                    execution_id=event.turn_id,
                )
                processed_ids.append(msg_id)
                self._not_durable.discard(msg_id)
            except Exception as error:
                if isinstance(error, SessionStartNotDurable):
                    self._not_durable.add(msg_id)
                else:
                    self._not_durable.discard(msg_id)
                if is_short_failure(error):
                    log.warning(
                        "[CHILD-UPDATES] Short failure; the signal stays pending",
                        msg_id=repr(msg_id),
                        session_id=event.session_id,
                        turn_id=event.turn_id,
                        error=str(error)[:200],
                    )
                    continue
                log.error(
                    "[CHILD-UPDATES] Child update not written; the signal is acknowledged",
                    msg_id=repr(msg_id),
                    project_id=str(event.project_id),
                    session_id=event.session_id,
                    turn_id=event.turn_id,
                    exc_info=True,
                )
                processed_ids.append(msg_id)
                self._not_durable.discard(msg_id)

        return len(processed_ids), processed_ids
