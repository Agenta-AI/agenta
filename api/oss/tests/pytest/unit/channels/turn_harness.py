"""An in-memory channels inbox for one Slack-shaped thread, for tests that
drive the real `ChannelsService` (and, when they want, the real
`InboxDispatcher`) message by message.

The DAO is a `MagicMock` whose inbox, trigger and thread methods are backed
by lists. The offset rules mirror `ChannelsDAO` (the Postgres side is pinned
in `integration/channels/test_channels_service_routing_dao.py` and
`test_channels_dao_triggers.py`). Every async DAO method yields to the event
loop once, so two dispatches run with `asyncio.gather` really interleave.
Events join their space only when attached, as in the real inbox.
"""

import asyncio
from datetime import datetime, timezone
from typing import List, Optional
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    CHANNEL_TRIGGER_NEVER_SENT,
    ChannelAgent,
    ChannelAgentData,
    ChannelAgentFlags,
    ChannelConnection,
    ChannelConnectionFlags,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEvent,
    ChannelInboxEventData,
    ChannelInboxEventFlags,
    ChannelInboxEventProcessed,
    ChannelInboxTrigger,
    ChannelSpace,
    ChannelSpaceFlags,
    ChannelSpaceKind,
    ChannelThread,
    ChannelThreadFlags,
    ChannelTriggerState,
)
from oss.src.core.channels.service import ChannelsService

from .contract.fakes import WellBehavedFakeAdapter

LOCATOR = {"team": "T1", "channel": "C1", "thread_ts": "1000.1"}


def texts(content) -> List[str]:
    """The words of a turn's content, without the "From <who>" parts."""
    return [
        part["text"]
        for part in content
        if part.get("type") == "text" and not str(part["text"]).startswith("From ")
    ]


def never_admitted(trigger: ChannelInboxTrigger) -> bool:
    if trigger.state is ChannelTriggerState.REFUSED:
        return True
    return (
        trigger.state is ChannelTriggerState.FAILED
        and trigger.status is not None
        and trigger.status.code == CHANNEL_TRIGGER_NEVER_SENT
    )


class InMemoryChannels:
    def __init__(self, *, space_kind: ChannelSpaceKind = ChannelSpaceKind.TOPIC):
        self.adapter = WellBehavedFakeAdapter()
        self.space_kind = space_kind
        self.events: List[ChannelInboxEvent] = []
        self.triggers: List[ChannelInboxTrigger] = []
        self.threads: List[ChannelThread] = []
        self.space: Optional[ChannelSpace] = None
        self.project_id = uuid4()
        self.connection = ChannelConnection(
            id=uuid4(),
            slug="conn-1",
            channel="agenta",
            external_key=uuid4(),
            flags=ChannelConnectionFlags(is_verified=True),
        )
        self.agent = ChannelAgent(
            id=uuid4(),
            slug="triage",
            connection_id=self.connection.id,
            created_by_id=uuid4(),
            data=ChannelAgentData(
                references={"workflow_revision": {"id": str(uuid4())}}
            ),
            flags=ChannelAgentFlags(is_default=True),
        )

        dao = MagicMock()
        dao.fetch_connection = self._async(lambda **kw: self.connection)
        dao.fetch_space_by_key = self._async(lambda **kw: self.space)
        dao.get_or_create_space = self._async(self._create_space)
        dao.attach_event_to_space = self._async(self._attach)
        dao.query_inbox_events = self._async(self._query_inbox_events)
        dao.fetch_default_agent = self._async(lambda **kw: self.agent)
        dao.fetch_default_grant = self._async(lambda **kw: None)
        dao.fetch_agent = self._async(lambda **kw: self.agent)
        dao.fetch_agent_by_slug = self._async(lambda **kw: self.agent)
        dao.query_matching_grants = self._async(lambda **kw: [])
        dao.count_grants = self._async(lambda **kw: 0)
        dao.fetch_current_thread = self._async(self._current_thread)
        dao.fetch_active_thread = self._async(self._current_thread)
        dao.fetch_thread_awaiting_choice = self._async(self._awaiting_choice)
        dao.create_thread = self._async(self._create_thread)
        dao.query_threads = self._async(lambda **kw: list(self.threads))
        dao.set_pending_choice = self._async(self._set_pending_choice)
        dao.fetch_outbox_event = self._async(lambda **kw: None)
        dao.fetch_outbox_event_by_key = self._async(lambda **kw: None)
        dao.fetch_latest_trigger = self._async(self._latest_trigger)
        dao.query_events_since = self._async(self._events_since)
        dao.record_inbox_trigger = self._async(self._record_trigger)
        dao.transition_inbox_trigger = self._async(self._transition)
        dao.mark_inbox_event_consumed = self._async(self._mark_consumed)
        self.dao = dao
        self.service = ChannelsService(
            channels_dao=dao,
            adapter_registry=ChannelAdapterRegistry(adapters={"agenta": self.adapter}),
        )

    @staticmethod
    def _async(fn):
        async def call(*args, **kwargs):
            await asyncio.sleep(0)
            return fn(*args, **kwargs)

        return AsyncMock(side_effect=call)

    # --- the fakes ------------------------------------------------------- #

    def _create_space(self, *, project_id, user_id, space):
        self.space = ChannelSpace(
            id=uuid4(),
            connection_id=space.connection_id,
            kind=space.kind,
            external_key=space.external_key,
            data=space.data,
            # no backfill: these tests are about the pushed messages
            flags=ChannelSpaceFlags(is_backfilled=True),
        )
        return self.space

    def _current_thread(self, **kw):
        active = [thread for thread in self.threads if thread.flags.is_active]
        return active[-1] if active else None

    def _awaiting_choice(self, **kw):
        for thread in self.threads:
            if thread.flags.is_active and thread.data.pending_choice is not None:
                return thread
        return None

    def _create_thread(self, *, project_id, user_id, thread):
        row = ChannelThread(
            id=uuid4(),
            space_id=thread.space_id,
            agent_id=thread.agent_id,
            external_key=thread.external_key,
            session_id=thread.session_id,
            data=thread.data,
            flags=ChannelThreadFlags(is_active=True),
            created_at=datetime.now(timezone.utc),
        )
        self.threads.append(row)
        return row

    def _set_pending_choice(
        self, *, project_id, thread_id, pending_choice, expected_interaction_id=None
    ):
        for index, thread in enumerate(self.threads):
            if thread.id == thread_id:
                data = thread.data.model_copy(update={"pending_choice": pending_choice})
                self.threads[index] = thread.model_copy(update={"data": data})
                return self.threads[index]
        return None

    def _latest_trigger(self, *, project_id, thread_id, before_event_id=None):
        candidates = [
            trigger
            for trigger in self.triggers
            if trigger.thread_id == thread_id
            and not never_admitted(trigger)
            and (before_event_id is None or trigger.event_id < before_event_id)
        ]
        return max(candidates, key=lambda trigger: trigger.event_id, default=None)

    def _attach(self, *, project_id, event_id, space_id):
        for index, event in enumerate(self.events):
            if event.id == event_id:
                self.events[index] = event.model_copy(update={"space_id": space_id})
                return self.events[index]
        return None

    def _events_since(
        self, *, project_id, space_id, after_event_id, through_event_id=None
    ):
        # like the real read, keyed on space_id: an event its own dispatch
        # has not attached yet is invisible
        return [
            event
            for event in sorted(self.events, key=lambda event: event.id)
            if event.space_id == space_id
            and (after_event_id is None or event.id > after_event_id)
            and (through_event_id is None or event.id <= through_event_id)
        ]

    def _query_inbox_events(self, *, project_id, event=None, windowing=None):
        return [
            stored
            for stored in self.events
            if event is None
            or (
                (event.external_id is None or stored.external_id == event.external_id)
                and (
                    event.connection_id is None
                    or stored.connection_id == event.connection_id
                )
            )
        ]

    def _record_trigger(self, *, project_id, trigger):
        if any(
            row.thread_id == trigger.thread_id and row.event_id == trigger.event_id
            for row in self.triggers
        ):
            return None
        row = ChannelInboxTrigger(
            id=uuid4(),
            thread_id=trigger.thread_id,
            event_id=trigger.event_id,
            turn_id=trigger.turn_id,
            state=trigger.state,
        )
        self.triggers.append(row)
        return row

    def _transition(self, *, project_id, trigger_id, state, status=None):
        for index, trigger in enumerate(self.triggers):
            if trigger.id == trigger_id:
                update = {"state": state}
                if status is not None:
                    update["status"] = status
                self.triggers[index] = trigger.model_copy(update=update)
                return self.triggers[index]
        return None

    def _mark_consumed(self, *, project_id, event_id):
        for index, event in enumerate(self.events):
            if event.id == event_id:
                self.events[index] = event.model_copy(
                    update={"flags": ChannelInboxEventFlags(is_consumed=True)}
                )
                return self.events[index]
        return None

    # --- driving --------------------------------------------------------- #

    def store(
        self, text, *, addressed=False, kind=ChannelEventKind.MESSAGE, created_at=None
    ):
        """What the ingress does: log the arrival, in arrival order."""
        event = ChannelInboxEvent(
            created_at=created_at or datetime.now(timezone.utc),
            # arrival order, as uuid7 ids give the real inbox
            id=UUID(int=len(self.events) + 1),
            connection_id=self.connection.id,
            external_id=f"evt-{len(self.events) + 1}",
            kind=kind,
            origin=ChannelEventOrigin.PUSHED,
            space_id=None,
            data=ChannelInboxEventData(
                external_locator=LOCATOR,
                processed=ChannelInboxEventProcessed(
                    content=[{"type": "text", "text": text}],
                    sender={"id": "U1"},
                ),
                space_kind=self.space_kind,
                addressed=addressed or None,
            ),
        )
        self.events.append(event)
        return event

    async def arrive(self, text, *, addressed=False):
        """Store a message and let its own dispatch attach it to the space
        (`resolve`), without opening a turn: an unaddressed arrival."""
        event = self.store(text, addressed=addressed)
        await self.resolve(event)
        return event

    def fetch(self, event_id):
        """The stored row as the worker would read it back."""
        return next(event for event in self.events if event.id == event_id)

    async def resolve(self, event):
        return await self.service.resolve(
            project_id=self.project_id,
            connection_id=self.connection.id,
            event=event,
        )

    async def compose(self, resolution, event):
        turn_input = await self.service.compose_input(
            project_id=self.project_id,
            resolution=resolution,
            event_id=event.id,
            capabilities=await self.adapter.fetch_capabilities(),
        )
        return turn_input

    async def open_and_settle(self, resolution, event, *, state, status=None):
        trigger = await self.service.open_turn(
            project_id=self.project_id,
            resolution=resolution,
            turn_id=str(uuid4()),
            event_id=event.id,
        )
        await self.service.settle_turn(
            project_id=self.project_id,
            trigger_id=trigger.id,
            state=state,
            status=status,
        )
        return trigger

    async def post(self, text, *, addressed=False, state=ChannelTriggerState.SETTLED):
        """One message, fully processed before the next: store, resolve,
        compose, open, settle. The texts the agent received, or None when the
        message opened no turn."""
        event = self.store(text, addressed=addressed)
        resolution = await self.resolve(event)
        if resolution is None:
            return None
        turn_input = await self.compose(resolution, event)
        await self.open_and_settle(resolution, event, state=state)
        return texts(turn_input.content)
