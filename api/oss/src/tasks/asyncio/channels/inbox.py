"""Inbox dispatcher — asyncio side of the channels inbound pipeline.

Entity-agnostic and self-contained (`specs-wp4.md`): routes one already-recorded
`channel_inbox_events` row through resolution, backlog composition, and a
detached invoke, driven directly by tests without a broker. The taskiq entry
point (`tasks/taskiq/channels/inbox_worker.py`) is the thin wrapper around this.

Calls only the four `ChannelsService` routing methods (`resolve`,
`compose_input`, `open_turn`, `settle_turn`) — routing detail (grants, policy,
thread get-or-create) stays inside the service, per `specs-wp4.md`'s
"Interfaces". See this package's final report for the collaborator
assumptions made where the frozen interfaces stop short of what this chain
needs (the addressing event's id; the invoking user's credential; the
runner-level `turnId` wire field).
"""

import asyncio
from typing import Awaitable, Callable, Optional
from uuid import UUID, uuid4

from oss.src.core.channels.dtos import (
    ChannelInboxEvent,
    ChannelInboxEventQuery,
    ChannelKeyGrain,
    ChannelResolution,
    ChannelTriggerState,
    ChannelTurnInput,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.shared.dtos import Status
from oss.src.core.channels.identity import (
    ChannelIdentityService,
    compose_external_user_key,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# Bounds the retry-on-refusal loop (tasks-wp4.md "Retry on refusal"): a
# refused overlapping turn is retried with backoff, never dropped, but a
# worker process must not spin forever if the runner never accepts.
_MAX_INVOKE_ATTEMPTS = 5
_RETRY_BACKOFF_SECONDS = 0.5

InvokeFn = Callable[..., Awaitable[str]]


class TurnRefused(Exception):
    """Raised by an `invoke_fn` when the runner refuses an overlapping turn.

    The real signal is `SessionTurnInUse` (a 409), owned by
    `core/sessions/streams`, not a channels type — `core/channels/types.py`
    is WP1's, so this package cannot add a channels exception for it. The
    default invoke function recognises `SessionTurnInUse` structurally (by
    class name, see `_default_invoke_fn`) and re-raises it as this marker,
    so the retry loop below never has to import `core/sessions/*` directly.
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
        invoke_fn: Optional[InvokeFn] = None,
    ):
        self.channels_service = channels_service
        self.workflows_service = workflows_service
        # None means the turn runs as the agent's creator, not the sender.
        self.identity_service = identity_service
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
        """Entry point from the taskiq task: look up the row WP3 already
        wrote by `(connection_id, external_id)`, then run the chain."""

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
        """The platform sender's linked account (architecture.md §5). None
        means unlinked or unconfigured — the caller falls back to the agent's
        creator, which is attribution's stand-in, not its mechanism."""

        if self.identity_service is None:
            return None

        platform_user_id = (event.data.processed.sender or {}).get("id")
        if not platform_user_id:
            return None

        capabilities = await self.channels_service.fetch_capabilities(
            channel=await self.channels_service.resolve_channel(
                project_id=project_id,
                connection_id=connection_id,
            ),
        )

        # scope_id comes from the first `identity.keys[space]` field, which is
        # the one that bounds the scope (Slack: "team"), not from `scope`'s own
        # name ("workspace") — that names the boundary, not a locator key.
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

    async def dispatch_event(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        event: ChannelInboxEvent,
    ) -> None:
        """The chain itself (`architecture.md` §5 steps 2-6). Takes an
        already-fetched row so tests can drive it directly, without a DB."""

        resolution = await self.channels_service.resolve(
            project_id=project_id,
            connection_id=connection_id,
            event=event,
        )
        if resolution is None:
            # default-deny, no addressed agent, or a silent grant refusal
            # (D17) — the log row WP3 wrote is all there is (D9).
            log.info(
                "[INBOX DISPATCHER] no resolution for event=%s — nothing beyond the log",
                event.id,
            )
            return

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
            # racing the same addressing (D9) — the other one invokes.
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
        """Invoke once, retrying only on a refused overlapping turn
        (tasks-wp4.md "Retry on refusal") — never the `force` path, never
        coalescing. Any other failure settles the trigger FAILED and stops."""

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
        """The real invoke: `WorkflowsService.invoke_workflow_detached` over
        the agent's bound references, on the thread's session.

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
