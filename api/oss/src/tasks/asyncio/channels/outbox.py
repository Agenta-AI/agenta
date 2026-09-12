import asyncio
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
from oss.src.core.channels.render.render import (
    extract_answer_text,
    render_indicator,
    render_no_answer,
    render_progress,
    render_thinking,
    render_turn_result,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelConnectionNotFound, ChannelSpaceNotFound
from oss.src.core.channels.utils import compose_outbox_key
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.tasks.asyncio.sessions.streaming import deserialize_turn_event
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer
from oss.src.core.channels.types import ChannelCredentialRevoked
from oss.src.core.shared.dtos import Status
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# One read plus two re-reads, 0.8s apart: enough to cover the ~150ms commit
# race measured live with room to spare, and short enough that a genuinely
# empty turn still reports within two seconds.
_EMPTY_FOLD_ATTEMPTS = 3
_EMPTY_FOLD_BACKOFF_SECONDS = 0.8

# While a turn runs on a channel that edits in place: how often the answer so
# far is folded and edited into the indicator, how often the platform's
# activity signal is re-sent (Telegram's typing action fades after ~5s), and
# the hard stop for a turn whose end event never arrives here.
_PROGRESS_INTERVAL_SECONDS = 2.0
_ACTIVITY_EVERY_TICKS = 2
_PROGRESS_MAX_SECONDS = 20 * 60


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
        interactions_service: Optional[SessionInteractionsService] = None,
        progress_interval_seconds: float = _PROGRESS_INTERVAL_SECONDS,
        progress_max_seconds: float = _PROGRESS_MAX_SECONDS,
    ) -> None:
        self.channels_service = channels_service
        self.turns_service = turns_service
        self.records_service = records_service
        self.progress_interval_seconds = progress_interval_seconds
        self.progress_max_seconds = progress_max_seconds
        # One progress loop per running turn, keyed by turn id; turn_ended
        # stops it before the final edit.
        self._progress_tasks: Dict[str, asyncio.Task] = {}
        # Resolves the real SessionInteraction row id for an approval card. The
        # fold carries the runner's ACP token, not the row id the sessions
        # respond path answers by; None means approvals render but cannot be
        # answered (the click is logged and dropped downstream).
        self.interactions_service = interactions_service

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
                project_id=project_id,
                thread=thread,
                turn_id=turn_id,
                session_id=session_id,
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
        session_id: Optional[str] = None,
    ) -> None:
        """Post an indicator; the receipt lands on the same row. On a channel
        that edits in place, then keep the chat alive until the turn ends:
        re-send the activity signal, move the indicator's dots, and edit the
        answer so far into it as records land (`session_id` names the turn's
        records; without it there is no progress loop)."""

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
        if event.state not in (
            ChannelDeliveryState.CREATED,
            ChannelDeliveryState.FAILED,
        ):
            return  # already sent — redelivery of turn-started, no second post

        item = render_indicator(capabilities=capabilities)

        await self._send(
            project_id=project_id,
            event=event,
            connection=connection,
            capabilities=capabilities,
            item=item,
            thread=thread,
        )

        if session_id and capabilities.rendering.controls.update:
            self._start_progress(
                project_id=project_id,
                thread=thread,
                turn_id=turn_id,
                session_id=session_id,
                connection=connection,
                capabilities=capabilities,
            )

    # --- progress: keep the chat alive while the turn runs ------------------#

    def _start_progress(
        self,
        *,
        project_id: UUID,
        thread: ChannelThread,
        turn_id: str,
        session_id: str,
        connection: ChannelConnection,
        capabilities: ChannelCapabilities,
    ) -> None:
        existing = self._progress_tasks.get(turn_id)
        if existing is not None and not existing.done():
            return
        self._progress_tasks[turn_id] = asyncio.create_task(
            self._run_progress(
                project_id=project_id,
                thread=thread,
                turn_id=turn_id,
                session_id=session_id,
                connection=connection,
                capabilities=capabilities,
            )
        )

    async def stop_progress(self, turn_id: str) -> None:
        """Cancel this turn's progress loop and wait for it, so a final edit
        never interleaves with a progress edit."""

        task = self._progress_tasks.pop(turn_id, None)
        if task is None or task.done():
            return
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

    async def _run_progress(
        self,
        *,
        project_id: UUID,
        thread: ChannelThread,
        turn_id: str,
        session_id: str,
        connection: ChannelConnection,
        capabilities: ChannelCapabilities,
    ) -> None:
        adapter = self.channels_service.adapter_registry.get(connection.channel)
        started = asyncio.get_running_loop().time()
        last_text: Optional[str] = None
        tick = 0
        try:
            while True:
                await asyncio.sleep(self.progress_interval_seconds)
                tick += 1
                if (
                    asyncio.get_running_loop().time() - started
                    > self.progress_max_seconds
                ):
                    return
                event = await self._get_or_create_item(
                    project_id=project_id,
                    connection_id=connection.id,
                    thread_id=thread.id,
                    turn_id=turn_id,
                    item_index=0,
                )
                locator = (event.data.external_locator if event.data else None) or (
                    thread.data.external_locator or {}
                )
                try:
                    if tick % _ACTIVITY_EVERY_TICKS == 1:
                        await adapter.signal_activity(
                            connection=connection, locator=locator
                        )
                    folded = await self._fold_turn(
                        project_id=project_id, session_id=session_id, turn_id=turn_id
                    )
                    if folded.get("stop_reason") is not None:
                        return  # the turn is over; turn_ended posts the result
                    text = extract_answer_text(folded.get("messages") or [])
                    if text and text != last_text:
                        item = render_progress(capabilities=capabilities, text=text)
                        last_text = text
                    elif text:
                        continue
                    else:
                        item = render_thinking(capabilities=capabilities, tick=tick)
                    await self._send(
                        project_id=project_id,
                        event=event,
                        connection=connection,
                        capabilities=capabilities,
                        item=item,
                        thread=thread,
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # one bad tick never ends the loop
                    log.warning(
                        "[SESSIONS-OUTBOX] progress tick failed turn=%s: %s",
                        turn_id,
                        str(exc)[:200],
                    )
        finally:
            self._progress_tasks.pop(turn_id, None)

    async def _fold_turn(
        self, *, project_id: UUID, session_id: str, turn_id: str
    ) -> Dict:
        """This turn's agent records, folded. The inbound user turn is
        persisted into the same log and fold() labels every message record
        `assistant`, so the source filter is what keeps the reply from
        repeating the user back to themselves."""

        records = await self.records_service.get_records(
            project_id=project_id, session_id=session_id
        )
        turn_events = [
            {"type": record.record_type, "data": record.attributes}
            for record in records
            if record.turn_id == turn_id and record.record_source == "agent"
        ]
        return fold(turn_events, stop_reason=None)

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

        await self.stop_progress(turn_id)

        connection, capabilities = await self._connection_and_capabilities(
            project_id=project_id, thread=thread
        )

        # The turn-ended event can outrun the final record commit (measured
        # ~150ms live): reading too early folds to an EMPTY answer, which used
        # to render an empty section Slack rejects, orphaning the indicator.
        # A bounded re-read absorbs the race; the real ordering guarantee is a
        # design question (QA, 2026-08-17).
        folded: Dict = {}
        has_answer = False
        for attempt in range(_EMPTY_FOLD_ATTEMPTS):
            folded = await self._fold_turn(
                project_id=project_id, session_id=session_id, turn_id=turn_id
            )
            has_answer = bool(
                any(
                    (message.get("content") or "") != ""
                    for message in (folded.get("messages") or [])
                    if message.get("role") == "assistant"
                )
                or folded.get("pending_interaction")
            )
            if has_answer or attempt == _EMPTY_FOLD_ATTEMPTS - 1:
                break
            await asyncio.sleep(_EMPTY_FOLD_BACKOFF_SECONDS)

        # Still empty after the bounded re-reads: say so in the chat and fail
        # LOUDLY in the log. Never a blank bubble (a silent empty delivery
        # erases the only signal that the answer was lost, DM-wave finding,
        # 2026-08-17), and never a "Thinking…" that sits there forever.
        if not has_answer:
            log.error(
                "[SESSIONS-OUTBOX] answer still empty after re-reads; telling "
                "the chat the run failed turn=%s session=%s",
                turn_id,
                session_id,
            )
            event = await self._get_or_create_item(
                project_id=project_id,
                connection_id=connection.id,
                thread_id=thread.id,
                turn_id=turn_id,
                item_index=0,
            )
            await self._send(
                project_id=project_id,
                event=event,
                connection=connection,
                capabilities=capabilities,
                item=render_no_answer(capabilities=capabilities),
                thread=thread,
            )
            return

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
                interaction_id = await self._resolve_interaction_row_id(
                    project_id=project_id,
                    session_id=session_id,
                    turn_id=turn_id,
                    token=item.interaction_id,
                )
                await self.channels_service.set_pending_choice(
                    project_id=project_id,
                    thread_id=thread.id,
                    pending_choice=ChannelPendingChoice(
                        choices=[
                            ChannelPendingChoiceItem(label=o.label, token=o.token)
                            for o in item.choice
                        ],
                        posted_at=datetime.now(timezone.utc),
                        interaction_id=interaction_id,
                    ),
                )

            await self._send(
                project_id=project_id,
                event=event,
                connection=connection,
                capabilities=capabilities,
                item=item,
                thread=thread,
            )

    async def _resolve_interaction_row_id(
        self, *, project_id, session_id: str, turn_id: str, token: Optional[str]
    ) -> Optional[str]:
        """The SessionInteraction row id for this turn's open approval, which the
        sessions respond path answers by. The fold carries the ACP `token`;
        match on it, else take the turn's single open interaction."""
        if self.interactions_service is None:
            return None
        # No try/except: a transient lookup failure must raise so the stream
        # worker retries, not store an unusable (None) interaction id.
        rows = await self.interactions_service.fetch_turn_interactions(
            project_id=project_id, session_id=session_id, turn_id=turn_id
        )
        if token:
            for row in rows:
                if row.token == token:
                    return str(row.id)
        # A turn can hold resolved interactions beside the open one, so a bare
        # "first row" would answer the wrong interaction. Fall back only when
        # there is exactly one.
        if len(rows) == 1:
            return str(rows[0].id)
        return None

    # --- send: post or edit, then record the receipt ------------------------#

    async def _send(
        self,
        *,
        project_id: UUID,
        event: ChannelOutboxEvent,
        connection: ChannelConnection,
        capabilities: ChannelCapabilities,
        item: RenderItem,
        thread: ChannelThread,
    ) -> None:
        content = [part.model_dump(exclude_none=True) for part in item.parts]

        # Idempotent delivery. turn_ended is published by two sources
        # (SessionTurnsService.complete_turn and the records worker post-commit),
        # so on_turn_ended can run twice for one turn. If this row already went
        # out with exactly this content, skip it: on a channel that posts a fresh
        # message per delivery (no in-place edit, e.g. Telegram) a second send is
        # a duplicate message the user sees, and on an edit channel it is a
        # wasted "message is not modified" call that overwrites the SENT row.
        if event.state is ChannelDeliveryState.SENT and event.data is not None:
            if (event.data.processed or {}).get("content") == content:
                return

        # One wire token per (row, content): a retry of the same content after a
        # FAILED write reuses it, so a post the platform accepted but whose reply
        # timed out is never duplicated; an edit to new content mints a new one.
        idempotency_key = _delivery_key(event.key, content)

        adapter = self.channels_service.adapter_registry.get(connection.channel)

        has_receipt = bool(event.data.external_locator)
        can_edit = capabilities.rendering.controls.update

        try:
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
                # First post for this item: no receipt exists yet, so the target
                # comes from the THREAD's locator (team/channel/thread_ts). An
                # empty locator here KeyError'd inside the Slack adapter and the
                # first-ever reply on any thread silently never reached Slack.
                receipt = await adapter.post_message(
                    connection=connection,
                    locator=thread.data.external_locator or {},
                    content=content,
                    idempotency_key=idempotency_key,
                )
        except ChannelCredentialRevoked as exc:
            # The platform refused the credential itself: switch the
            # connection off so the agent page shows "token revoked" and
            # offers an update, and stop retrying a call that cannot pass.
            await self.channels_service.channels_dao.transition_outbox_event(
                project_id=project_id,
                event_id=event.id,
                state=ChannelDeliveryState.FAILED,
                status=Status(code="credential_revoked", message=str(exc)[:500]),
            )
            await self.channels_service.deactivate_connection(
                project_id=project_id, connection_id=connection.id
            )
            log.error(
                "[SESSIONS-OUTBOX] credential revoked; connection switched off "
                "connection=%s: %s",
                connection.id,
                str(exc)[:200],
            )
            return
        except Exception as exc:
            # The row said CREATED forever after a rejected post, which reads
            # as "not attempted yet" from outside (F87). Write the failure
            # down with the platform's reason, then let the caller's retry
            # and logging see the error as before.
            await self.channels_service.channels_dao.transition_outbox_event(
                project_id=project_id,
                event_id=event.id,
                state=ChannelDeliveryState.FAILED,
                status=Status(code="delivery_failed", message=str(exc)[:500]),
            )
            raise

        await self.channels_service.channels_dao.transition_outbox_event(
            project_id=project_id,
            event_id=event.id,
            state=ChannelDeliveryState.SENT,
            # a success after a FAILED attempt replaces the failure it recorded
            status=Status(code="sent"),
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


def _delivery_key(event_key: UUID, content: List[Dict]) -> UUID:
    """The idempotency token for one (outbox row, content) pair."""
    from uuid import uuid5

    from oss.src.core.channels.utils import canonical_json

    return uuid5(event_key, canonical_json(content))
