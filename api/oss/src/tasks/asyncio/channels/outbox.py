from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from uuid import UUID

from agenta.sdk.agents.fold import fold
from redis.asyncio import Redis

from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelDeliveryState,
    ChannelOutboxEvent,
    ChannelOutboxEventCreate,
    ChannelOutboxEventData,
    ChannelPendingChoice,
    ChannelPendingChoiceItem,
    ChannelThread,
    ChannelThreadQuery,
)
from oss.src.core.channels.render.dtos import RenderItem
from oss.src.core.channels.render.render import render_indicator, render_turn_result
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelConnectionNotFound, ChannelSpaceNotFound
from oss.src.core.channels.utils import compose_idempotency_key, compose_outbox_key
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.tasks.asyncio.sessions.streaming import deserialize_turn_event
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class ChannelsOutboxWorker:
    """Fold, render, post, receipt — one turn at a time.

    Entity-agnostic and self-contained: every dependency is a service
    interface, so tests drive it without a broker.

    Reaches `channels_service.channels_dao` directly for the outbox
    read/write methods (`fetch_outbox_event_by_key`, `record_outbox_event`,
    `transition_outbox_event`, `claim_outbox_events`) — `ChannelsService
    .enqueue_output`/`.deliver` are still `NotImplementedError` stubs owned
    elsewhere, so this worker does not call them.
    """

    def __init__(
        self,
        *,
        channels_service: ChannelsService,
        turns_service: SessionTurnsService,
        records_service: RecordsService,
    ) -> None:
        self.channels_service = channels_service
        self.turns_service = turns_service
        self.records_service = records_service

    # --- driven by the session-turn stream ---------------------------------#

    async def handle_turn_event(
        self,
        *,
        project_id: UUID,
        session_id: str,
        turn_id: str,
        kind: str,
    ) -> None:
        """Routes one `SessionTurnEvent` to its handler by its own `kind` —
        no re-read of `latest_turn`, so a concurrent second turn on the same
        session can never be mistaken for this one."""

        thread = await self._fetch_thread_for_session(
            project_id=project_id, session_id=session_id
        )
        if thread is None:
            return  # no channel_threads row for this session — not our turn

        if kind == "turn_started":
            await self.on_turn_started(
                project_id=project_id, thread=thread, turn_id=turn_id
            )
        elif kind == "turn_ended":
            await self.on_turn_ended(
                project_id=project_id,
                thread=thread,
                turn_id=turn_id,
                session_id=session_id,
            )

    async def _fetch_thread_for_session(
        self, *, project_id: UUID, session_id: str
    ) -> Optional[ChannelThread]:
        threads = await self.channels_service.query_threads(
            project_id=project_id,
            thread=ChannelThreadQuery(session_id=session_id),
        )
        return threads[0] if threads else None

    # --- turn started -------------------------------------------------------#

    async def on_turn_started(
        self,
        *,
        project_id: UUID,
        thread: ChannelThread,
        turn_id: str,
    ) -> None:
        """Post an indicator; the receipt lands on the same row."""

        connection, capabilities = await self._connection_and_capabilities(
            project_id=project_id, thread=thread
        )

        event = await self._get_or_create_item(
            project_id=project_id,
            connection_id=connection.id,
            thread_id=thread.id,
            turn_id=turn_id,
            item_index=0,
        )
        if event.state is not ChannelDeliveryState.CREATED:
            return  # already sent — redelivery of turn-started, no second post

        item = render_indicator(capabilities=capabilities)

        await self._send(
            project_id=project_id,
            event=event,
            connection=connection,
            capabilities=capabilities,
            item=item,
        )

    # --- turn ended ---------------------------------------------------------#

    async def on_turn_ended(
        self,
        *,
        project_id: UUID,
        thread: ChannelThread,
        turn_id: str,
        session_id: str,
    ) -> None:
        """Fold this turn's records; edit the indicator into the result."""

        connection, capabilities = await self._connection_and_capabilities(
            project_id=project_id, thread=thread
        )

        records = await self.records_service.get_records(
            project_id=project_id, session_id=session_id
        )
        # The answer is what the agent said. The inbound user turn is persisted
        # into the same log, and fold() labels every message record `assistant`,
        # so without this the reply repeats the user back to themselves.
        turn_events = [
            {"type": record.record_type, "data": record.attributes}
            for record in records
            if record.turn_id == turn_id and record.record_source == "agent"
        ]

        folded = fold(turn_events, stop_reason=None)

        items = render_turn_result(capabilities=capabilities, folded=folded)

        for item_index, item in enumerate(items):
            event = await self._get_or_create_item(
                project_id=project_id,
                connection_id=connection.id,
                thread_id=thread.id,
                turn_id=turn_id,
                item_index=item_index,
            )

            if item.choice:
                # written here, not at send time -- a choice is state on the
                # thread from the moment it renders, independent of delivery.
                await self.channels_service.channels_dao.set_pending_choice(
                    project_id=project_id,
                    thread_id=thread.id,
                    pending_choice=ChannelPendingChoice(
                        choices=[
                            ChannelPendingChoiceItem(label=o.label, token=o.token)
                            for o in item.choice
                        ],
                        posted_at=datetime.now(timezone.utc),
                    ),
                )

            await self._send(
                project_id=project_id,
                event=event,
                connection=connection,
                capabilities=capabilities,
                item=item,
            )

    # --- send: post or edit, then record the receipt ------------------------#

    async def _send(
        self,
        *,
        project_id: UUID,
        event: ChannelOutboxEvent,
        connection: ChannelConnection,
        capabilities: ChannelCapabilities,
        item: RenderItem,
    ) -> None:
        content = [part.model_dump(exclude_none=True) for part in item.parts]

        idempotency_key = compose_idempotency_key(
            key=event.key, updated_at=event.updated_at
        )

        adapter = self.channels_service.adapter_registry.get(connection.channel)

        has_receipt = bool(event.data.external_locator)
        can_edit = capabilities.rendering.controls.update

        if has_receipt and can_edit:
            receipt = await adapter.edit_message(
                connection=connection,
                external_locator=event.data.external_locator,
                content=content,
                idempotency_key=idempotency_key,
            )
        elif has_receipt:
            # controls.update is false: post a NEW message rather than an
            # edit — the old receipt is superseded.
            receipt = await adapter.post_message(
                connection=connection,
                locator=event.data.external_locator,
                content=content,
                idempotency_key=idempotency_key,
            )
        else:
            receipt = await adapter.post_message(
                connection=connection,
                locator={},
                content=content,
                idempotency_key=idempotency_key,
            )

        await self.channels_service.channels_dao.transition_outbox_event(
            project_id=project_id,
            event_id=event.id,
            state=ChannelDeliveryState.SENT,
            data=ChannelOutboxEventData(
                external_locator=receipt,
                processed={"content": content},
            ),
        )

    # --- helpers -------------------------------------------------------------#

    async def _get_or_create_item(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        thread_id: UUID,
        turn_id: str,
        item_index: int,
    ) -> ChannelOutboxEvent:
        """Idempotent on `key`: a retry of either call finds, not forks, the
        row for this item."""

        key = compose_outbox_key(thread_id=thread_id, turn_id=turn_id, item=item_index)

        existing = await self.channels_service.channels_dao.fetch_outbox_event_by_key(
            project_id=project_id, key=key
        )
        if existing is not None:
            return existing

        return await self.channels_service.channels_dao.record_outbox_event(
            project_id=project_id,
            event=ChannelOutboxEventCreate(
                connection_id=connection_id,
                thread_id=thread_id,
                turn_id=turn_id,
                key=key,
                data=ChannelOutboxEventData(),
            ),
        )

    async def _connection_and_capabilities(
        self,
        *,
        project_id: UUID,
        thread: ChannelThread,
    ) -> "tuple[ChannelConnection, ChannelCapabilities]":
        space = await self.channels_service.channels_dao.fetch_space(
            project_id=project_id, space_id=thread.space_id
        )
        if space is None:
            raise ChannelSpaceNotFound(space_id=thread.space_id)

        connection = await self.channels_service.fetch_connection(
            project_id=project_id,
            connection_id=space.connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=space.connection_id)

        capabilities = await self.channels_service.fetch_capabilities(
            channel=connection.channel, connection=connection
        )

        return connection, capabilities


class ChannelsOutboxStreamWorker(StreamConsumer):
    """Consumes `streams:sessions` and drives `ChannelsOutboxWorker` off each
    event's own `kind`/`turn_id`.

    Consumes from: streams:sessions
    Consumer group: worker-sessions-channels-outbox

    Unlike the sibling spans/records/events streams, this payload is plain
    JSON (`orjson.dumps`, no zlib) — `deserialize_turn_event` matches that.
    """

    log_prefix = "[SESSIONS-OUTBOX]"

    def __init__(
        self,
        *,
        outbox: ChannelsOutboxWorker,
        redis_client: Redis,
        stream_name: str,
        consumer_group: str,
        consumer_name: Optional[str] = None,
        max_batch_size: int = 50,
        max_block_ms: int = 5000,
        max_delay_ms: int = 250,
        max_batch_mb: int = 50,
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
        self.outbox = outbox

    async def process_batch(
        self,
        batch: List[Tuple[bytes, Dict[bytes, bytes]]],
    ) -> Tuple[int, List[bytes]]:
        processed_ids: List[bytes] = []

        for msg_id, data in batch:
            try:
                turn_event = deserialize_turn_event(payload=data[b"data"])
            except Exception:
                log.error(
                    "[SESSIONS-OUTBOX] Failed to deserialize message",
                    msg_id=repr(msg_id),
                    exc_info=True,
                )
                processed_ids.append(msg_id)  # unparseable: ack to avoid PEL buildup
                continue

            try:
                await self.outbox.handle_turn_event(
                    project_id=turn_event.project_id,
                    session_id=turn_event.session_id,
                    turn_id=turn_event.turn_id,
                    kind=turn_event.kind,
                )
                processed_ids.append(msg_id)
            except Exception:
                log.error(
                    "[SESSIONS-OUTBOX] Failed to handle turn event",
                    msg_id=repr(msg_id),
                    turn_id=turn_event.turn_id,
                    exc_info=True,
                )
                # left un-acked: pending, retried on the next read

        return len(processed_ids), processed_ids
