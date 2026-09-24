import asyncio
import time
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
from oss.src.core.sessions.interactions.dtos import SessionInteractionStatus
from oss.src.core.channels.render.render import (
    extract_answer_text,
    render_indicator,
    FAILED_START_TEXT,
    render_no_answer,
    render_progress,
    render_thinking,
    render_turn_result,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelConnectionNotFound, ChannelSpaceNotFound
from oss.src.core.channels.utils import compose_outbox_key
from oss.src.core.channels.utils import delivery_outcome_unknown as _outcome_unknown
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.tasks.asyncio.sessions.streaming import deserialize_turn_event
from oss.src.tasks.asyncio.shared.consumer import StreamConsumer
from oss.src.core.channels.types import (
    ChannelCredentialRevoked,
)
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

# Delivery claims. A post or edit holds its row for at most this long: well
# past the adapters' HTTP timeouts, so only a worker that died mid-post leaves
# a claim this old, and the next delivery takes it over. A worker that finds
# the row claimed by another polls briefly (the holder usually finishes in a
# second), then gives up and leaves its stream entry pending for redelivery.
_CLAIM_TTL_SECONDS = 60.0
_CLAIM_WAIT_SECONDS = 15.0
_CLAIM_POLL_SECONDS = 0.25


# A reclaimed stream entry older than this is dropped, not retried: the normal
# retry window is `max_deliveries` x the reclaim idle time (about 2.5 minutes),
# so anything older is a backlog left by an earlier deploy, and replaying it
# would post a weeks-old "Thinking…" or answer into a live chat.
_MAX_REDELIVERY_AGE_SECONDS = 10 * 60


class ChannelOutboxDeliveryBusy(Exception):
    """Another worker still holds this row's delivery claim."""


class ChannelsOutboxWorker:
    """Fold, render, post, receipt — one turn at a time.

    Entity-agnostic and self-contained: every dependency is a service
    interface, so tests drive it without a broker.

    Reaches `channels_service.channels_dao` directly for the outbox
    read/write methods (`fetch_outbox_event_by_key`, `record_outbox_event`,
    `claim_outbox_delivery`, `transition_outbox_event`) — `ChannelsService
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
        # respond path answers by. Without this service, do not publish
        # actionable approval cards.
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
            space_id=thread.space_id,
            turn_id=turn_id,
            item_index=0,
        )
        if event.state not in (
            ChannelDeliveryState.CREATED,
            ChannelDeliveryState.FAILED,
        ):
            return  # already sent — redelivery of turn-started, no second post
        if event.data and event.data.external_locator:
            # The indicator landed (the receipt proves it); this FAILED marks a
            # later edit of the same row. A redelivered turn-started must not
            # write the indicator back over an answer the platform may hold.
            return

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
                    space_id=thread.space_id,
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
                    elif text:
                        continue
                    else:
                        item = render_thinking(capabilities=capabilities, tick=tick)
                    if not (event.data and event.data.external_locator):
                        # Progress only edits the indicator. Without its
                        # receipt (the post failed, or its outcome is unknown
                        # and it may be in the chat) a tick would post a
                        # second bubble.
                        continue
                    # stop_progress may cancel this mid-edit; _send finishes a
                    # started claim, edit and receipt write before the cancel
                    # lands, so the final answer never finds the row stuck.
                    delivered = await self._send(
                        project_id=project_id,
                        event=event,
                        connection=connection,
                        capabilities=capabilities,
                        item=item,
                        thread=thread,
                        wait_for_claim=False,
                    )
                    # Only text that reached the chat counts as shown: a tick
                    # that found the row busy leaves it for the next tick.
                    if text and delivered:
                        last_text = text
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
                space_id=thread.space_id,
                turn_id=turn_id,
                item_index=0,
            )
            if _holds_failed_start_notice(event):
                # The dispatcher already told the chat this run never
                # started; a second "failed" line would be the same news twice.
                return
            await self._send(
                project_id=project_id,
                event=event,
                connection=connection,
                capabilities=capabilities,
                item=render_no_answer(capabilities=capabilities),
                thread=thread,
                final=True,
                # A duplicate handler may already have sent the real answer;
                # "no answer" must never replace it.
                overwrite_final=False,
            )
            return

        items = render_turn_result(capabilities=capabilities, folded=folded)

        for item_index, item in enumerate(items):
            event = await self._get_or_create_item(
                project_id=project_id,
                connection_id=connection.id,
                thread_id=thread.id,
                space_id=thread.space_id,
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
                if interaction_id is None:
                    log.info(
                        "[SESSIONS-OUTBOX] no pending interaction for approval "
                        "turn=%s session=%s; ignoring the card",
                        turn_id,
                        session_id,
                    )
                    continue
                # Bind callbacks to the row, not the reusable approve/deny labels.
                tokens = {
                    option.token: f"{interaction_id}:{option.token}"
                    for option in item.choice
                }
                for option in item.choice:
                    option.token = tokens[option.token]
                for part in item.parts:
                    if part.type == "button" and part.value in tokens:
                        part.value = tokens[part.value]
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
                        outbox_event_id=event.id,
                    ),
                )

            await self._send(
                project_id=project_id,
                event=event,
                connection=connection,
                capabilities=capabilities,
                item=item,
                thread=thread,
                final=True,
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
        # Only an interaction still waiting can take an answer: a delayed park
        # signal must not put a card back for one answered or cancelled
        # elsewhere.
        pending = [
            row
            for row in rows
            if getattr(row, "status", None)
            in (None, SessionInteractionStatus.pending, "pending")
        ]
        if token:
            for row in pending:
                if row.token == token:
                    return str(row.id)
            # The card names a token; a row with another token is another
            # question, never this one.
            return None
        # No token on the fold: fall back only when exactly one is open.
        if len(pending) == 1:
            return str(pending[0].id)
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
        final: bool = False,
        overwrite_final: Optional[bool] = None,
        wait_for_claim: bool = True,
    ) -> bool:
        """Deliver `item` on this row at most once per (row, content). True
        when the chat now shows this content, by this call or another.

        `final` marks a turn's answer, and once one is sent only a delivery
        with `overwrite_final` (by default: any final one) replaces it.
        `wait_for_claim=False` is for progress edits, which skip a busy row
        rather than queue."""

        if overwrite_final is None:
            overwrite_final = final

        content = [part.model_dump(exclude_none=True) for part in item.parts]

        # Two workers can hold the same delivery: turn_ended is published by
        # two sources (SessionTurnsService.complete_turn and the records worker
        # post-commit), a pending stream entry is redelivered, and a deploy
        # overlap runs two consumers. Only the worker that claims the row
        # posts; the claimed row is re-read, so an edit targets the receipt
        # another worker may have written meanwhile.
        delivery_key = _delivery_key(event.key, content)

        async def claim_then_deliver() -> bool:
            claimed, already_delivered = await self._claim_delivery(
                project_id=project_id,
                event=event,
                content=content,
                overwrite_final=overwrite_final,
                delivery_key=delivery_key,
                wait=wait_for_claim,
            )
            if claimed is None:
                return already_delivered
            return await self._deliver(
                project_id=project_id,
                event=claimed,
                connection=connection,
                capabilities=capabilities,
                content=content,
                thread=thread,
                final=final,
                delivery_key=delivery_key,
            )

        # The claim, the post and its receipt write run to the end even if
        # this task is cancelled (SIGTERM, stop_progress). A cancel between
        # them would leave the row `sending`: after the post, with the message
        # already in the chat, the next worker would post it again once the
        # lease ran out; after the claim alone, the next delivery would wait
        # the lease out. The extra delay a cancel sees is bounded by the claim
        # wait (none for progress edits) and the adapters' HTTP timeouts.
        return await _finish_even_if_cancelled(claim_then_deliver())

    async def _deliver(
        self,
        *,
        project_id: UUID,
        event: ChannelOutboxEvent,
        connection: ChannelConnection,
        capabilities: ChannelCapabilities,
        content: List[Dict],
        thread: ChannelThread,
        final: bool,
        delivery_key: UUID,
    ) -> bool:
        dao = self.channels_service.channels_dao
        # Fences every write below: a worker whose claim went stale and was
        # taken over cannot overwrite the new holder's receipt.
        claim_token = event.status.message if event.status else None

        adapter = self.channels_service.adapter_registry.get(connection.channel)

        has_receipt = bool(event.data.external_locator)
        can_edit = capabilities.rendering.controls.update
        creates_message = not (has_receipt and can_edit)

        # Passed through for adapters that honour it. Slack and Telegram do
        # not: neither API takes an idempotency key for a new message, so a
        # post whose outcome is unknown is never retried (see below).
        idempotency_key = delivery_key

        try:
            if not creates_message:
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
            await dao.transition_outbox_event(
                project_id=project_id,
                event_id=event.id,
                state=ChannelDeliveryState.FAILED,
                status=Status(code="credential_revoked", message=str(exc)[:500]),
                claim_token=claim_token,
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
            return False
        except Exception as exc:
            if creates_message and _outcome_unknown(exc):
                # The platform may have shown the message (a read timeout, a
                # 5xx, a later chunk failing after an earlier one landed). A
                # repost could show it twice, which is worse than a missing
                # reply, so this delivery is recorded and never retried: the
                # key in `status.type` makes the claim refuse it.
                await dao.transition_outbox_event(
                    project_id=project_id,
                    event_id=event.id,
                    state=ChannelDeliveryState.FAILED,
                    status=Status(
                        code="delivery_uncertain",
                        type=str(delivery_key),
                        message=str(exc)[:500],
                    ),
                    claim_token=claim_token,
                )
                log.error(
                    "[SESSIONS-OUTBOX] post outcome unknown; not retrying row=%s: %s",
                    event.id,
                    str(exc)[:200],
                )
                return False
            # The row said CREATED forever after a rejected post, which reads
            # as "not attempted yet" from outside (F87). Write the failure
            # down with the platform's reason, then let the caller's retry
            # and logging see the error as before.
            await dao.transition_outbox_event(
                project_id=project_id,
                event_id=event.id,
                state=ChannelDeliveryState.FAILED,
                status=Status(code="delivery_failed", message=str(exc)[:500]),
                claim_token=claim_token,
            )
            raise

        recorded = await dao.transition_outbox_event(
            project_id=project_id,
            event_id=event.id,
            claim_token=claim_token,
            state=ChannelDeliveryState.SENT,
            # a success after a FAILED attempt replaces the failure it recorded
            status=Status(code="sent"),
            data=ChannelOutboxEventData(
                external_locator=receipt,
                processed=(
                    {"content": content, "final": True}
                    if final
                    else {"content": content}
                ),
            ),
        )
        if recorded is None:
            log.warning(
                "[SESSIONS-OUTBOX] delivery claim was taken over mid-send; "
                "receipt not recorded row=%s",
                event.id,
            )
        return True

    async def _claim_delivery(
        self,
        *,
        project_id: UUID,
        event: ChannelOutboxEvent,
        content: List[Dict],
        overwrite_final: bool,
        delivery_key: UUID,
        wait: bool,
    ) -> Tuple[Optional[ChannelOutboxEvent], bool]:
        """`(claimed row, None-reason)`: the row when this delivery is ours to
        make; otherwise None, with True when the row already went out with
        this content and False when it holds a final answer this delivery may
        not replace (or is busy and `wait` is off). A row another worker is
        still sending is polled for a bounded time; past it, raise so the
        stream entry stays pending and is redelivered."""

        dao = self.channels_service.channels_dao
        loop = asyncio.get_running_loop()
        deadline = loop.time() + _CLAIM_WAIT_SECONDS

        while True:
            claimed = await dao.claim_outbox_delivery(
                project_id=project_id,
                event_id=event.id,
                content=content,
                claim_ttl_seconds=_CLAIM_TTL_SECONDS,
                overwrite_final=overwrite_final,
                delivery_key=str(delivery_key),
            )
            if claimed is not None:
                return claimed, False

            current = await dao.fetch_outbox_event(
                project_id=project_id, event_id=event.id
            )
            if current is None:
                return None, False
            if _sent_with(current, content):
                return None, True
            if not overwrite_final and _holds_final(current):
                return None, False
            if _uncertain_with(current, delivery_key):
                return None, False
            if not wait:
                return None, False
            if loop.time() >= deadline:
                raise ChannelOutboxDeliveryBusy(
                    f"outbox row {event.id} is still claimed by another worker"
                )
            await asyncio.sleep(_CLAIM_POLL_SECONDS)

    # --- helpers -------------------------------------------------------------#

    async def _get_or_create_item(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        thread_id: UUID,
        space_id: UUID,
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
                space_id=space_id,
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
        reclaim_min_idle_ms: int = 30_000,
        max_deliveries: int = 5,
        max_redelivery_age_seconds: float = _MAX_REDELIVERY_AGE_SECONDS,
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
            # A failed post is left pending; without the reclaim pass nothing
            # ever reads it again and the reply is lost. Redelivery is safe
            # because a delivery is claimed per (row, content).
            reclaim_pending=True,
            reclaim_min_idle_ms=reclaim_min_idle_ms,
            max_deliveries=max_deliveries,
        )
        self.outbox = outbox
        self.max_redelivery_age_seconds = max_redelivery_age_seconds

    async def reclaim_batch(self) -> List[Tuple[bytes, Dict[bytes, bytes]]]:
        batch = await super().reclaim_batch()
        if not batch:
            return batch

        fresh: List[Tuple[bytes, Dict[bytes, bytes]]] = []
        stale: List[Tuple[bytes, Dict[bytes, bytes]]] = []
        for msg_id, data in batch:
            if self._past_retry_window(msg_id):
                stale.append((msg_id, data))
            else:
                fresh.append((msg_id, data))

        if stale:
            self.dropped_messages += len(stale)
            log.warning(
                "[SESSIONS-OUTBOX] Dropping stale unacknowledged turn events",
                count=len(stale),
                messages=[
                    self.describe_message(data) or repr(msg_id)
                    for msg_id, data in stale
                ],
            )
            await self.ack_and_delete([msg_id for msg_id, _ in stale])

        return fresh

    def _past_retry_window(self, msg_id: bytes) -> bool:
        """The one retry bound for this consumer: an entry is retried (every
        `reclaim_min_idle_ms` or so) until it is `max_redelivery_age_seconds`
        old, then dropped. A delivery count would turn a short platform
        outage into a lost reply after a couple of minutes."""

        age_ms = time.time() * 1000 - _entry_time_ms(msg_id)
        return age_ms > self.max_redelivery_age_seconds * 1000

    def is_permanent_failure(
        self,
        msg_id: bytes,
        data: Dict[bytes, bytes],
    ) -> bool:
        # The base consumer asks this only for an entry that has used up
        # `max_deliveries`, and drops it on True. Here the delivery count is
        # not the bound, the entry's age is: past `max_deliveries` an entry
        # keeps being retried until it leaves the retry window.
        return self._past_retry_window(msg_id)

    def describe_message(self, data: Dict[bytes, bytes]) -> Optional[str]:
        try:
            turn_event = deserialize_turn_event(payload=data[b"data"])
        except Exception:
            return None
        return f"{turn_event.kind} turn={turn_event.turn_id}"

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
            except (ChannelSpaceNotFound, ChannelConnectionNotFound) as exc:
                # The thread's space or connection is gone: no retry can
                # deliver this, so acknowledge it instead of redelivering.
                log.warning(
                    "[SESSIONS-OUTBOX] Dropping turn event with nowhere to deliver",
                    msg_id=repr(msg_id),
                    turn_id=turn_event.turn_id,
                    reason=str(exc)[:200],
                )
                processed_ids.append(msg_id)
            except Exception:
                log.error(
                    "[SESSIONS-OUTBOX] Failed to handle turn event",
                    msg_id=repr(msg_id),
                    turn_id=turn_event.turn_id,
                    exc_info=True,
                )
                # left un-acked: pending, redelivered by the reclaim pass

        return len(processed_ids), processed_ids


async def _finish_even_if_cancelled(coroutine):
    """Run `coroutine` to completion, then re-raise a cancel that arrived
    meanwhile. For work that must not stop halfway, bounded by the adapters'
    HTTP timeouts."""

    task = asyncio.ensure_future(coroutine)
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            if task.cancelled():
                raise
            cancelled = True
        except Exception:
            if not cancelled:
                raise
    if cancelled:
        if not task.cancelled():
            task.exception()  # collected: the cancel wins, the row holds the failure
        raise asyncio.CancelledError()
    return task.result()


def _sent_with(event: ChannelOutboxEvent, content: List[Dict]) -> bool:
    if event.state is not ChannelDeliveryState.SENT or event.data is None:
        return False
    return (event.data.processed or {}).get("content") == content


def _uncertain_with(event: ChannelOutboxEvent, delivery_key: UUID) -> bool:
    status = event.status
    return (
        status is not None
        and status.code == "delivery_uncertain"
        and status.type == str(delivery_key)
    )


def _holds_final(event: ChannelOutboxEvent) -> bool:
    if event.state is not ChannelDeliveryState.SENT or event.data is None:
        return False
    return bool((event.data.processed or {}).get("final"))


def _entry_time_ms(msg_id: bytes) -> int:
    """A Redis stream id is `<milliseconds>-<sequence>`."""
    raw = msg_id.decode() if isinstance(msg_id, bytes) else str(msg_id)
    try:
        return int(raw.split("-", 1)[0])
    except ValueError:
        return 0


def _holds_failed_start_notice(event: ChannelOutboxEvent) -> bool:
    if event.state is not ChannelDeliveryState.SENT or event.data is None:
        return False
    content = (event.data.processed or {}).get("content") or []
    return any(part.get("text") == FAILED_START_TEXT for part in content)


def _delivery_key(event_key: UUID, content: List[Dict]) -> UUID:
    """The idempotency token for one (outbox row, content) pair."""
    from uuid import uuid5

    from oss.src.core.channels.utils import canonical_json

    return uuid5(event_key, canonical_json(content))
