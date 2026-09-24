"""Inbox dispatcher — asyncio side of the channels inbound pipeline.

Entity-agnostic and self-contained: routes one already-recorded
`channel_inbox_events` row through resolution, backlog composition, and a
detached invoke, driven directly by tests without a broker. The taskiq entry
point (`tasks/taskiq/channels/inbox_worker.py`) is the thin wrapper around this.

Calls only the four `ChannelsService` routing methods (`resolve`,
`compose_input`, `open_turn`, `settle_turn`) — routing detail (grants, policy,
thread get-or-create) stays inside the service.
"""

import asyncio
from functools import partial
from typing import Any, Awaitable, Callable, Dict, List, Optional
from uuid import UUID, uuid4, uuid5

from oss.src.core.channels.commands import (
    COMMAND_NEW,
    COMMAND_SESSIONS,
    COMMAND_STOP,
    COMMAND_USE,
    CommandArgumentInvalid,
    CommandNotOffered,
    dispatch_command,
    parse_command,
)
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelDeliveryState,
    ChannelEventKind,
    ChannelInboxEvent,
    ChannelInboxEventQuery,
    ChannelKeyGrain,
    ChannelOutboxEventCreate,
    ChannelOutboxEventData,
    ChannelResolution,
    ChannelThreadCreate,
    ChannelThreadData,
    ChannelTriggerState,
    ChannelTurnInput,
)
from oss.src.core.channels.queue import ChannelQueueDecision, ChannelSessionQueue
from oss.src.core.channels.render.dtos import RenderItem
from oss.src.core.channels.render.render import (
    OPTED_IN_TEXT,
    OPTED_OUT_TEXT,
    UNSUPPORTED_TEXT,
    render_busy,
    render_failed_start,
    render_notice,
)
from oss.src.core.channels.utils import canonical_json, compose_outbox_key
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequest,
    WorkflowServiceRequestData,
)
from oss.src.core.workflows.types import WorkflowDetachedStartFailed
from oss.src.core.channels.fill import run_backfill
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import (
    ChannelConnectionNotFound,
    ChannelThreadNotFound,
)
from oss.src.core.shared.dtos import Status
from oss.src.core.channels.identity import (
    ChannelIdentityService,
    compose_external_user_key,
)
from oss.src.core.sessions.attachments.service import SessionAttachmentsService
from oss.src.core.sessions.attachments.types import AttachmentTooLarge
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# Bounds the retry-on-refusal loop. With the session queue wired, a refusal
# re-admits the message, which queues it behind the turn that won the race;
# without it, the refusal is retried with backoff and then answered once, so
# a worker process never spins forever and the chat never hears silence.
_MAX_INVOKE_ATTEMPTS = 5
_RETRY_BACKOFF_SECONDS = 0.5

InvokeFn = Callable[..., Awaitable[str]]

# the runner's refusal of a second turn on a running session, as the workflow
# service reports it in the first frame of a detached start
_TURN_IN_USE_CODE = "session_turn_in_use"

# answers one parked session interaction: (project_id, user_id, interaction_id, answer)
RespondInteractionFn = Callable[..., Awaitable[None]]


class TurnRefused(Exception):
    """Raised by an `invoke_fn` when the runner refuses an overlapping turn.

    The real signal is `SessionTurnInUse`, owned by `core/sessions/streams`,
    not a channels type. It reaches the default invoke function
    (`_invoke_via_workflows_service`) either as that exception or, through
    the workflow service, as a detached-start failure carrying its
    `session_turn_in_use` code; both are re-raised as this marker.
    """


class InboxDispatcher:
    """Resolves and runs one already-logged inbound event against its
    addressed agent, if any."""

    def __init__(
        self,
        *,
        channels_service: ChannelsService,
        workflows_service: Optional[WorkflowsService] = None,
        identity_service: Optional[ChannelIdentityService] = None,
        streams_service: Optional[SessionStreamsService] = None,
        invoke_fn: Optional[InvokeFn] = None,
        respond_interaction_fn: Optional[RespondInteractionFn] = None,
        session_queue: Optional[ChannelSessionQueue] = None,
        attachments_service: Optional[SessionAttachmentsService] = None,
    ):
        self.channels_service = channels_service
        self.workflows_service = workflows_service
        # None means the turn runs as the agent's creator, not the sender.
        self.identity_service = identity_service
        # None means `!stop` is not offered; commands.dispatch_command raises
        # CommandNotOffered before ever touching this attribute either way.
        self.streams_service = streams_service
        # `invoke_fn` overrides the default entirely (tests inject a fake
        # here); otherwise the default closes over `workflows_service`.
        self._invoke_fn = invoke_fn or self._invoke_via_workflows_service
        # answers a parked session interaction (an approval card's click or
        # typed reply) through the sessions respond path; None means this
        # deployment has no wiring for it and the click is logged and dropped
        self._respond_interaction_fn = respond_interaction_fn
        # None means a follow-up to a running turn cannot be queued; it is
        # retried, then answered with one "still working" reply.
        self.session_queue = session_queue
        # Stores an inbound image or document as a session attachment for the
        # agent. None means files reach the agent as a short note instead.
        self.attachments_service = attachments_service

    async def dispatch(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        channel: str,
        external_id: str,
    ) -> None:
        """Entry point from the taskiq task: look up the already-recorded row
        by `(connection_id, external_id)`, then run the chain."""

        events = await self.channels_service.query_inbox_events(
            project_id=project_id,
            event=ChannelInboxEventQuery(
                connection_id=connection_id,
                external_id=external_id,
            ),
        )
        if not events:
            log.info(
                "[INBOX DISPATCHER] no logged event for connection=%s external_id=%s",
                connection_id,
                external_id,
            )
            return

        await self.dispatch_event(
            project_id=project_id,
            connection_id=connection_id,
            event=events[0],
        )

    async def _answer_interaction(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        event: ChannelInboxEvent,
        resolution: ChannelResolution,
    ) -> None:
        interaction_id = resolution.answered_interaction_id
        assert interaction_id is not None
        if self._respond_interaction_fn is None:
            log.error(
                "[INBOX DISPATCHER] event=%s answered interaction=%s but no "
                "respond path is wired -- the approval stays parked",
                event.id,
                interaction_id,
            )
            return
        user_id = await self._invoking_user_id(
            project_id=project_id,
            connection_id=connection_id,
            event=event,
            resolution=resolution,
        )
        approved = (resolution.resolved_token or "").rsplit(":", 1)[-1] == "approve"
        # The decision only. An answer's `message` is replayed to the agent as
        # a user turn after the tool result, and here it could only ever be the
        # button label: the agent read the user saying "Approve" and replied to
        # it ("What would you like me to approve?", live QA 2026-09-23).
        await self._respond_interaction_fn(
            project_id=project_id,
            user_id=user_id or resolution.agent.created_by_id,
            interaction_id=UUID(interaction_id),
            answer={"approved": approved},
        )
        # Clear only the answered card; a continuation may already have parked
        # on a newer interaction while the response admission was returning.
        await self.channels_service.set_pending_choice(
            project_id=project_id,
            thread_id=resolution.thread.id,
            pending_choice=None,
            expected_interaction_id=interaction_id,
        )
        try:
            await self.channels_service.dismiss_approval_choices(
                project_id=project_id,
                connection_id=connection_id,
                thread=resolution.thread,
                interaction_id=interaction_id,
            )
        except Exception:  # UI cleanup must not replay an admitted decision.
            log.warning(
                "[CHANNELS] could not dismiss resolved approval controls", exc_info=True
            )
        log.info(
            "[INBOX DISPATCHER] event=%s answered interaction=%s approved=%s",
            event.id,
            interaction_id,
            approved,
        )

    async def _invoking_user_id(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        event: ChannelInboxEvent,
        resolution,
    ) -> Optional[UUID]:
        """The platform sender's linked account. None means unlinked or
        unconfigured — the caller falls back to the agent's creator, which
        is attribution's stand-in, not its mechanism."""

        if self.identity_service is None:
            return None

        platform_user_id = (event.data.processed.sender or {}).get("id")
        if not platform_user_id:
            return None

        connection = await self.channels_service.fetch_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=connection_id)

        capabilities = await self.channels_service.fetch_capabilities(
            channel=connection.channel,
            connection=connection,
        )

        # scope_id comes from the first `identity.keys[space]` field, which is
        # the one that bounds the scope (Slack: "team"), not from `scope`'s
        # own name ("workspace") — that names the boundary, not a locator key.
        space_keys = capabilities.identity.keys.get(ChannelKeyGrain.SPACE) or []
        locator = event.data.external_locator or {}
        scope_id = locator.get(space_keys[0]) if space_keys else None

        external_user_key = compose_external_user_key(
            capabilities,
            str(platform_user_id),
            scope_id=str(scope_id) if scope_id is not None else None,
        )

        link = await self.identity_service.resolve_link(
            project_id=project_id,
            connection_id=connection_id,
            external_user_key=external_user_key,
        )

        return link.user_id if link is not None else None

    async def _dispatch_command(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        event: ChannelInboxEvent,
        resolution: ChannelResolution,
        capabilities,
        parsed,
    ) -> None:
        """Routes an already-parsed command; never opens a turn.

        `user_id` falls back to the agent's creator exactly like the invoke
        path, since a command still needs an actor for audit (`close_thread`)
        and for `SessionStreamsService.command`.
        """

        user_id = await self._invoking_user_id(
            project_id=project_id,
            connection_id=connection_id,
            event=event,
            resolution=resolution,
        )
        user_id = user_id or resolution.agent.created_by_id

        sigil = capabilities.addressing.sigils.command or ""
        try:
            result = await dispatch_command(
                channels_service=self.channels_service,
                streams_service=self.streams_service,
                project_id=project_id,
                user_id=user_id,
                thread=resolution.thread,
                capabilities=capabilities,
                parsed=parsed,
            )
        except (CommandNotOffered, CommandArgumentInvalid, ChannelThreadNotFound) as e:
            log.info(
                "[INBOX DISPATCHER] command=%s rejected for event=%s: %s",
                parsed.command,
                event.id,
                e,
            )
            if isinstance(e, CommandArgumentInvalid):
                ack = f"That command needs a session id, like {sigil}use:<id>."
            elif isinstance(e, ChannelThreadNotFound):
                ack = "That session is not part of this conversation."
            else:
                ack = "That command is not available here."
        else:
            ack = await self._command_ack(
                project_id=project_id,
                resolution=resolution,
                command=parsed.command,
                result=result,
            )

        # A command is not a turn, but it is never answered with silence
        # (QA finding, 2026-09-23: `!new` closed the thread and posted
        # nothing). Keyed on the event, so a redelivered task posts once.
        await self._notify_not_started(
            project_id=project_id,
            resolution=resolution,
            turn_id=str(uuid5(event.id, "command-ack")),
            connection=await self.channels_service.fetch_connection(
                project_id=project_id,
                connection_id=connection_id,
            ),
            capabilities=capabilities,
            render=partial(render_notice, text=ack),
        )

    async def _command_ack(
        self,
        *,
        project_id: UUID,
        resolution: ChannelResolution,
        command: str,
        result,
    ) -> str:
        if command == COMMAND_NEW:
            # Open the fresh conversation now rather than on the next
            # addressing: in a channel thread a follow-up without a mention is
            # admitted only by an ACTIVE thread row, so a bare close left the
            # user's next message in that thread unanswered.
            # Best-effort: without it the next addressing still opens one.
            closed = resolution.thread
            try:
                await self.channels_service.channels_dao.create_thread(
                    project_id=project_id,
                    user_id=None,
                    thread=ChannelThreadCreate(
                        space_id=closed.space_id,
                        agent_id=closed.agent_id,
                        external_key=closed.external_key,
                        session_id=str(uuid4()),
                        data=ChannelThreadData(
                            external_locator=closed.data.external_locator,
                        ),
                    ),
                )
            except Exception:
                log.error(
                    "[INBOX DISPATCHER] could not open the new thread after !new "
                    "thread=%s",
                    closed.id,
                    exc_info=True,
                )
            return "Started a new conversation."
        if command == COMMAND_STOP:
            return "Stopping the current run."
        if command == COMMAND_SESSIONS:
            count = len(result or [])
            noun = "session" if count == 1 else "sessions"
            return f"This conversation has {count} {noun}."
        if command == COMMAND_USE:
            return "Switching to an earlier session is not available yet."
        return "Done."

    async def _run_backfill(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        resolution: ChannelResolution,
        capabilities,
    ) -> None:
        """Fetches this space's history once, ahead of composing the turn.

        A refusal is logged and never reaches the trigger row — no trigger
        exists yet at this point, and a backfill refusal is a per-space
        capability fact, not this turn's outcome. `is_backfilled` stays
        false, so the next addressing retries. On success this mutates
        `resolution.space.flags.is_backfilled` in place so the same
        `compose_input` call downstream sees it without a re-fetch.

        `run_backfill` returns `None` for "already backfilled", "not
        supported" and "success" alike, so whether to set the local flag is
        decided here from the capability declaration, not from that return
        value alone. `capabilities` is the caller's — same connection,
        already fetched for the command parse — so a not-supported channel
        never even re-fetches the connection.
        """

        space = resolution.space
        if space.flags.is_backfilled:
            return

        if not capabilities.fill.backfill.supported:
            return

        connection = await self.channels_service.fetch_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if connection is None:
            return

        adapter = self.channels_service.adapter_registry.get(connection.channel)

        status = await run_backfill(
            project_id=project_id,
            channels_dao=self.channels_service.channels_dao,
            adapter=adapter,
            connection=connection,
            space=space,
            capabilities=capabilities,
        )
        if status is not None:
            log.info(
                "[INBOX DISPATCHER] backfill refused for space=%s: %s",
                space.id,
                status.message,
            )
            return

        space.flags.is_backfilled = True

    async def dispatch_event(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        event: ChannelInboxEvent,
    ) -> None:
        """Resolve, dispatch-or-compose, open, and invoke for one event.
        Takes an already-fetched row so tests can drive it directly, without
        a DB.

        Two parses run in sequence, neither owning the other: the agent sigil
        (inside `resolve()`, deciding which thread exists at all) runs first,
        the command sigil second — a message carrying both is unambiguous
        under that order. A matched command never opens a turn.
        """

        resolution = await self.channels_service.resolve(
            project_id=project_id,
            connection_id=connection_id,
            event=event,
        )
        if resolution is None:
            # default-deny, no addressed agent, or a silent grant refusal —
            # the logged row is all there is.
            log.info(
                "[INBOX DISPATCHER] no resolution for event=%s — nothing beyond the log",
                event.id,
            )
            return

        connection = await self.channels_service.fetch_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=connection_id)

        capabilities = await self.channels_service.fetch_capabilities(
            channel=connection.channel,
            connection=connection,
        )

        if await self._handle_consent(
            project_id=project_id,
            event=event,
            resolution=resolution,
            connection=connection,
            capabilities=capabilities,
        ):
            return

        if capabilities.conversation.reply_window_seconds:
            # The person wrote, so the reply window is open again: replies
            # held while it was closed go out first, oldest first.
            await self.channels_service.release_held_replies(
                project_id=project_id,
                thread=resolution.thread,
                connection=connection,
            )

        if resolution.answered_interaction_id is not None:
            # The message answered a parked approval. The answer belongs to the
            # turn that parked, so it goes to the sessions respond path and no
            # new turn opens; the continuation's own turn events reach the
            # outbox through the thread's session as any turn does.
            await self._answer_interaction(
                project_id=project_id,
                connection_id=connection_id,
                event=event,
                resolution=resolution,
            )
            return

        if _only_unsupported(event):
            # A voice note, a video, a sticker: nothing the agent can read.
            # One fixed reply, keyed on the event so a redelivery sends none.
            await self._notify_not_started(
                project_id=project_id,
                resolution=resolution,
                turn_id=str(uuid5(event.id, "unsupported")),
                connection=connection,
                capabilities=capabilities,
                render=partial(render_notice, text=UNSUPPORTED_TEXT),
            )
            return

        parsed = parse_command(
            content=event.data.processed.content,
            capabilities=capabilities,
        )
        if parsed is not None:
            await self._dispatch_command(
                project_id=project_id,
                connection_id=connection_id,
                event=event,
                resolution=resolution,
                capabilities=capabilities,
                parsed=parsed,
            )
            return

        await self._run_backfill(
            project_id=project_id,
            connection_id=connection_id,
            resolution=resolution,
            capabilities=capabilities,
        )

        turn_input = await self.channels_service.compose_input(
            project_id=project_id,
            resolution=resolution,
            event_id=event.id,
            capabilities=capabilities,
        )

        turn_id = str(uuid4())

        trigger = await self.channels_service.open_turn(
            project_id=project_id,
            resolution=resolution,
            turn_id=turn_id,
            event_id=event.id,
        )
        if trigger is None:
            # (thread_id, event_id) already claimed by a concurrent worker
            # racing the same addressing — the other one invokes.
            log.info(
                "[INBOX DISPATCHER] trigger claim lost for event=%s thread=%s",
                event.id,
                resolution.thread.id,
            )
            return

        user_id = await self._invoking_user_id(
            project_id=project_id,
            connection_id=connection_id,
            event=event,
            resolution=resolution,
        )

        turn_input.content = await self._attach_media(
            project_id=project_id,
            connection=connection,
            resolution=resolution,
            user_id=user_id or resolution.agent.created_by_id,
            content=turn_input.content,
        )

        await self._invoke_with_retry(
            project_id=project_id,
            resolution=resolution,
            turn_input=turn_input,
            turn_id=turn_id,
            trigger_id=trigger.id,
            user_id=user_id,
            connection=connection,
            capabilities=capabilities,
        )

    async def _handle_consent(
        self,
        *,
        project_id: UUID,
        event: ChannelInboxEvent,
        resolution: ChannelResolution,
        connection: ChannelConnection,
        capabilities: ChannelCapabilities,
    ) -> bool:
        """STOP and START, on a channel that declares opt-out. True when the
        event is fully handled here: a STOP or START that changed the state
        (confirmed once), or any message from someone who opted out (stored,
        never answered)."""

        if not capabilities.conversation.opt_out:
            return False

        space = resolution.space
        opted_out = space.flags.is_opted_out
        keyword = _consent_keyword(event)
        if (keyword == "stop" and not opted_out) or (keyword == "start" and opted_out):
            opting_out = keyword == "stop"
            await self.channels_service.channels_dao.set_space_opted_out(
                project_id=project_id, space_id=space.id, opted_out=opting_out
            )
            await self._notify_not_started(
                project_id=project_id,
                resolution=resolution,
                turn_id=str(uuid5(event.id, "consent")),
                connection=connection,
                capabilities=capabilities,
                render=partial(
                    render_notice,
                    text=OPTED_OUT_TEXT if opting_out else OPTED_IN_TEXT,
                ),
            )
            return True
        if opted_out:
            log.info(
                "[INBOX DISPATCHER] space=%s opted out; event=%s stored, not answered",
                space.id,
                event.id,
            )
            return True
        return False

    async def _attach_media(
        self,
        *,
        project_id: UUID,
        connection: ChannelConnection,
        resolution: ChannelResolution,
        user_id: Optional[UUID],
        content: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Replace each `media` part (an inbound image or document, named by
        the platform's media id) with a session attachment the agent can
        open. A file that cannot be stored becomes a short note, so the agent
        still knows one was sent."""

        if not any(part.get("type") == "media" for part in content):
            return content

        adapter = self.channels_service.adapter_registry.get(connection.channel)
        session_id = resolution.thread.session_id
        attached: List[Dict[str, Any]] = []
        for part in content:
            if part.get("type") != "media":
                attached.append(part)
                continue
            label = f"[{part.get('kind') or 'file'}]"
            if self.attachments_service is None or not session_id or user_id is None:
                attached.append(
                    {"type": "text", "text": f"{label} (files cannot be read here)"}
                )
                continue
            try:
                limits = getattr(self.attachments_service, "limits", None)
                fetched = await adapter.fetch_media(
                    connection=connection,
                    media=part,
                    max_bytes=limits.max_raw_bytes if limits else None,
                )
                if fetched is None:
                    raise AttachmentTooLarge(size=0, limit=0)
                data, media_type = fetched
                attachment = await self.attachments_service.create_attachment(
                    project_id=project_id,
                    user_id=user_id,
                    session_id=session_id,
                    idempotency_key=f"channels:{part.get('media_id')}",
                    filename=part.get("filename") or part.get("kind"),
                    declared_media_type=media_type,
                    data=data,
                )
                await self.attachments_service.reference_attachments(
                    project_id=project_id,
                    session_id=session_id,
                    attachment_ids=[attachment.id],
                )
            except AttachmentTooLarge:
                attached.append(
                    {"type": "text", "text": f"{label} (too large to read)"}
                )
                continue
            except Exception as exc:  # noqa: BLE001 - the text still reaches the agent
                log.warning(
                    "[INBOX DISPATCHER] media %s could not be attached: %s",
                    part.get("media_id"),
                    str(exc)[:200],
                )
                attached.append(
                    {"type": "text", "text": f"{label} (could not be read)"}
                )
                continue
            attached.append(
                {
                    "type": "attachment",
                    "attachmentId": str(attachment.id),
                    "filename": attachment.filename,
                    "mimeType": attachment.media_type,
                    "size": attachment.size,
                }
            )
        return attached

    async def _queue_behind_running_turn(
        self,
        *,
        project_id: UUID,
        resolution: ChannelResolution,
        turn_input: ChannelTurnInput,
        trigger_id: UUID,
        user_id: Optional[UUID],
    ) -> ChannelQueueDecision:
        """Admit the message to the thread session's queue, the way the
        playground admits a message sent while a turn runs. A free session
        answers RUN_NOW and nothing is written. The trigger id keys the
        admission, so a redelivered task never queues the message twice."""

        session_id = resolution.thread.session_id
        if self.session_queue is None or not session_id:
            return ChannelQueueDecision.UNAVAILABLE
        try:
            return await self.session_queue.admit(
                project_id=project_id,
                user_id=user_id or resolution.agent.created_by_id,
                session_id=session_id,
                request=self._build_request(
                    resolution=resolution, turn_input=turn_input
                ).model_dump(mode="json", exclude_none=True),
                idempotency_key=f"channels:{trigger_id}",
            )
        except Exception:
            # An admission that cannot answer must not lose the message: the
            # invoke below either runs it or is refused into the retry path.
            log.error(
                "[INBOX DISPATCHER] session queue admission failed trigger=%s",
                trigger_id,
                exc_info=True,
            )
            return ChannelQueueDecision.UNAVAILABLE

    async def _invoke_with_retry(
        self,
        *,
        project_id: UUID,
        resolution: ChannelResolution,
        turn_input: ChannelTurnInput,
        turn_id: str,
        trigger_id: UUID,
        user_id: Optional[UUID] = None,
        connection: Optional[ChannelConnection] = None,
        capabilities: Optional[ChannelCapabilities] = None,
    ) -> None:
        """Queue behind a running turn, else invoke once, retrying only on a
        refused overlapping turn — never the `force` path, never coalescing.
        Any other failure settles the trigger FAILED, tells the chat the run
        never started, and stops."""

        attempt = 0
        while True:
            attempt += 1
            decision = await self._queue_behind_running_turn(
                project_id=project_id,
                resolution=resolution,
                turn_input=turn_input,
                trigger_id=trigger_id,
                user_id=user_id,
            )
            if decision is ChannelQueueDecision.QUEUED:
                # The offset stands: the message is the session's next turn,
                # and that turn's events reach the chat through the thread's
                # session like any other.
                log.info(
                    "[INBOX DISPATCHER] turn_id=%s queued behind the running turn",
                    turn_id,
                )
                await self.channels_service.settle_turn(
                    project_id=project_id,
                    trigger_id=trigger_id,
                    state=ChannelTriggerState.SETTLED,
                    status=Status(code="202", message="Queued behind the running turn"),
                )
                return
            try:
                # user_id is passed only when identity resolved a linked
                # account; an injected invoke_fn keeps its four-argument shape.
                extra = {"user_id": user_id} if user_id is not None else {}
                await self._invoke_fn(
                    project_id=project_id,
                    resolution=resolution,
                    turn_input=turn_input,
                    turn_id=turn_id,
                    **extra,
                )
            except TurnRefused:
                if attempt >= _MAX_INVOKE_ATTEMPTS:
                    log.error(
                        "[INBOX DISPATCHER] turn_id=%s refused %d times — giving up",
                        turn_id,
                        attempt,
                    )
                    await self.channels_service.settle_turn(
                        project_id=project_id,
                        trigger_id=trigger_id,
                        state=ChannelTriggerState.REFUSED,
                        status=Status(code="409", message="Turn refused"),
                    )
                    await self._notify_not_started(
                        project_id=project_id,
                        resolution=resolution,
                        turn_id=turn_id,
                        connection=connection,
                        capabilities=capabilities,
                        render=render_busy,
                    )
                    return

                log.info(
                    "[INBOX DISPATCHER] turn_id=%s refused (attempt %d) — retrying",
                    turn_id,
                    attempt,
                )
                await asyncio.sleep(_RETRY_BACKOFF_SECONDS * attempt)
                continue
            except Exception as e:
                log.error(
                    "[INBOX DISPATCHER] turn_id=%s invoke failed: %s",
                    turn_id,
                    e,
                    exc_info=True,
                )
                await self.channels_service.settle_turn(
                    project_id=project_id,
                    trigger_id=trigger_id,
                    state=ChannelTriggerState.FAILED,
                    status=Status(code="500", message=str(e)),
                )
                await self._notify_not_started(
                    project_id=project_id,
                    resolution=resolution,
                    turn_id=turn_id,
                    connection=connection,
                    capabilities=capabilities,
                    render=render_failed_start,
                )
                return
            else:
                await self.channels_service.settle_turn(
                    project_id=project_id,
                    trigger_id=trigger_id,
                    state=ChannelTriggerState.SETTLED,
                )
                return

    async def _notify_not_started(
        self,
        *,
        project_id: UUID,
        resolution: ChannelResolution,
        turn_id: str,
        connection: Optional[ChannelConnection],
        capabilities: Optional[ChannelCapabilities],
        render: Callable[..., RenderItem],
    ) -> None:
        """Tell the chat the run never started. `render` is the failed-start
        notice, or the busy reply for a refusal that could not be queued.
        (QA finding, 2026-09-22: the dispatcher settled the trigger before any
        turn-start event existed, so the sessions outbox had nothing to render
        from and the user got silence.)

        Same idempotency contract as the sessions outbox: the notice claims
        this turn's item 0 by outbox key, so a task redelivery finds the row
        SENT and posts nothing. A row that already carries a receipt belongs
        to a turn that DID start (the indicator landed before the failure) —
        the sessions outbox owns that row, so it is left alone. Fixed text,
        never the exception: the invoke error is an internal detail.

        Best-effort by design: the trigger is already settled, and a
        notification failure must not turn a handled error into a task retry
        that would re-invoke the turn.
        """

        try:
            if connection is None or capabilities is None:
                return  # injected-invoke test path with no delivery context

            thread = resolution.thread
            key = compose_outbox_key(thread_id=thread.id, turn_id=turn_id, item=0)
            dao = self.channels_service.channels_dao

            event = await dao.fetch_outbox_event_by_key(project_id=project_id, key=key)
            if event is None:
                event = await dao.record_outbox_event(
                    project_id=project_id,
                    event=ChannelOutboxEventCreate(
                        connection_id=connection.id,
                        thread_id=thread.id,
                        turn_id=turn_id,
                        key=key,
                        data=ChannelOutboxEventData(),
                    ),
                )
            elif event.state is ChannelDeliveryState.SENT or (
                event.data and event.data.external_locator
            ):
                return

            item = render(capabilities=capabilities)
            content = [part.model_dump(exclude_none=True) for part in item.parts]

            adapter = self.channels_service.adapter_registry.get(connection.channel)
            receipt = await adapter.post_message(
                connection=connection,
                locator=thread.data.external_locator or {},
                content=content,
                idempotency_key=uuid5(event.key, canonical_json(content)),
            )

            await dao.transition_outbox_event(
                project_id=project_id,
                event_id=event.id,
                state=ChannelDeliveryState.SENT,
                status=Status(code="sent"),
                data=ChannelOutboxEventData(
                    external_locator=receipt,
                    processed={"content": content},
                ),
            )
        except Exception:
            log.error(
                "[INBOX DISPATCHER] failed-start notice not delivered turn_id=%s",
                turn_id,
                exc_info=True,
            )

    async def _invoke_via_workflows_service(
        self,
        *,
        project_id: UUID,
        resolution: ChannelResolution,
        turn_input: ChannelTurnInput,
        turn_id: str,
        user_id: Optional[UUID] = None,
    ) -> str:
        """Invoke via `WorkflowsService.invoke_workflow_detached` over the
        agent's bound references, on the thread's session.

        `invoke_workflow_detached` honours no caller-supplied `turnId` — only
        `run_id` and `session_id` reach the wire — so the minted turn id travels
        as `run_id`. If a distinct `turnId` is ever threaded through
        `WorkflowsService`, this is the one call site to update.

        `user_id` is the platform sender's linked account when identity resolved
        one, else the agent's creator.
        """

        if self.workflows_service is None:
            raise RuntimeError(
                "InboxDispatcher has no workflows_service and no invoke_fn override"
            )

        request = self._build_request(resolution=resolution, turn_input=turn_input)

        try:
            response = await self.workflows_service.invoke_workflow_detached(
                project_id=project_id,
                user_id=user_id or resolution.agent.created_by_id,
                request=request,
                run_id=turn_id,
                # A first frame that reports an error is a failed start, not
                # an accepted run: otherwise the trigger settles and the chat
                # hears nothing, because no turn event ever follows.
                strict_start=True,
            )
        except Exception as e:
            if type(e).__name__ == "SessionTurnInUse" or (
                isinstance(e, WorkflowDetachedStartFailed)
                and f"({_TURN_IN_USE_CODE})" in str(e)
            ):
                raise TurnRefused() from e
            raise

        return response.run_id

    @staticmethod
    def _build_request(
        *,
        resolution: ChannelResolution,
        turn_input: ChannelTurnInput,
    ) -> WorkflowServiceRequest:
        """The turn's invoke request over the agent's bound references, on
        the thread's session. A queued follow-up stores exactly this."""

        references = {
            key: ref.model_dump(mode="json", exclude_none=True)
            for key, ref in resolution.agent.data.references.items()
        }

        return WorkflowServiceRequest(
            references=references,
            session_id=resolution.thread.session_id,
            data=WorkflowServiceRequestData(
                inputs={
                    "messages": [{"role": "user", "content": turn_input.content}],
                }
            ),
        )


_OPT_OUT_WORDS = {"STOP", "UNSUBSCRIBE"}
_OPT_IN_WORDS = {"START"}


def _consent_keyword(event: ChannelInboxEvent) -> Optional[str]:
    """ "stop" or "start" when the whole message is one of those words, else
    None. A sentence that contains "stop" is an ordinary message."""

    if event.kind is not ChannelEventKind.MESSAGE:
        return None
    texts = [
        (part.get("text") or "").strip().upper()
        for part in event.data.processed.content
        if part.get("type") == "text"
    ]
    if len(texts) != 1:
        return None
    if texts[0] in _OPT_OUT_WORDS:
        return "stop"
    if texts[0] in _OPT_IN_WORDS:
        return "start"
    return None


def _only_unsupported(event: ChannelInboxEvent) -> bool:
    content = event.data.processed.content
    return bool(content) and all(part.get("unsupported") for part in content)
