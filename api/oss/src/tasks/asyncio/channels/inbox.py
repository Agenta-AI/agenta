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
from typing import Awaitable, Callable, Optional
from uuid import UUID, uuid4

from oss.src.core.channels.commands import (
    CommandArgumentInvalid,
    CommandNotOffered,
    dispatch_command,
    parse_command,
)
from oss.src.core.channels.dtos import (
    ChannelInboxEvent,
    ChannelInboxEventQuery,
    ChannelKeyGrain,
    ChannelResolution,
    ChannelTriggerState,
    ChannelTurnInput,
)
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
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# Bounds the retry-on-refusal loop: a refused overlapping turn is retried
# with backoff, never dropped, but a worker process must not spin forever
# if the runner never accepts.
_MAX_INVOKE_ATTEMPTS = 5
_RETRY_BACKOFF_SECONDS = 0.5

InvokeFn = Callable[..., Awaitable[str]]


class TurnRefused(Exception):
    """Raised by an `invoke_fn` when the runner refuses an overlapping turn.

    The real signal is `SessionTurnInUse` (a 409), owned by
    `core/sessions/streams`, not a channels type. The default invoke function
    (`_invoke_via_workflows_service`) recognises `SessionTurnInUse`
    structurally (by class name) and re-raises it as this marker, so the
    retry loop below never has to import `core/sessions/*` directly.
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

        connection = await self.channels_service.connections_service.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=connection_id)

        capabilities = await self.channels_service.fetch_capabilities(
            channel=connection.provider_key,
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

        try:
            await dispatch_command(
                channels_service=self.channels_service,
                streams_service=self.streams_service,
                project_id=project_id,
                user_id=user_id,
                thread=resolution.thread,
                capabilities=capabilities,
                parsed=parsed,
            )
        except (CommandNotOffered, CommandArgumentInvalid, ChannelThreadNotFound) as e:
            # not a turn, and not silently dropped either — the addressing
            # event's own log row is the record of the attempt.
            log.info(
                "[INBOX DISPATCHER] command=%s rejected for event=%s: %s",
                parsed.command,
                event.id,
                e,
            )

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
        never even reaches `connections_service`.
        """

        space = resolution.space
        if space.flags.is_backfilled:
            return

        if not capabilities.fill.backfill.supported:
            return

        connection = await self.channels_service.connections_service.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if connection is None:
            return

        adapter = self.channels_service.adapter_registry.get(connection.provider_key)

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

        connection = await self.channels_service.connections_service.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if connection is None:
            raise ChannelConnectionNotFound(connection_id=connection_id)

        capabilities = await self.channels_service.fetch_capabilities(
            channel=connection.provider_key,
            connection=connection,
        )

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

        await self._invoke_with_retry(
            project_id=project_id,
            resolution=resolution,
            turn_input=turn_input,
            turn_id=turn_id,
            trigger_id=trigger.id,
            user_id=user_id,
        )

    async def _invoke_with_retry(
        self,
        *,
        project_id: UUID,
        resolution: ChannelResolution,
        turn_input: ChannelTurnInput,
        turn_id: str,
        trigger_id: UUID,
        user_id: Optional[UUID] = None,
    ) -> None:
        """Invoke once, retrying only on a refused overlapping turn — never
        the `force` path, never coalescing. Any other failure settles the
        trigger FAILED and stops."""

        attempt = 0
        while True:
            attempt += 1
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
                return
            else:
                await self.channels_service.settle_turn(
                    project_id=project_id,
                    trigger_id=trigger_id,
                    state=ChannelTriggerState.SETTLED,
                )
                return

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

        from oss.src.core.workflows.dtos import (
            WorkflowRequestData,
            WorkflowServiceRequest,
        )

        references = {
            key: ref.model_dump(mode="json", exclude_none=True)
            for key, ref in resolution.agent.data.references.items()
        }

        request = WorkflowServiceRequest(
            references=references,
            session_id=resolution.thread.session_id,
            data=WorkflowRequestData(inputs={"content": turn_input.content}),
        )

        try:
            response = await self.workflows_service.invoke_workflow_detached(
                project_id=project_id,
                user_id=user_id or resolution.agent.created_by_id,
                request=request,
                run_id=turn_id,
            )
        except Exception as e:
            if type(e).__name__ == "SessionTurnInUse":
                raise TurnRefused() from e
            raise

        return response.run_id
