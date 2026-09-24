"""A follow-up sent while the thread's turn is still running.

The dispatcher admits the message to the session's pending-input queue (the
same `SessionInputsService.admit` the playground uses) instead of retrying a
start the runner will refuse. These tests drive the real admission service
over an in-memory inputs DAO, so "queued once" is the queue's own row count.
"""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

from oss.src.core.channels.dtos import ChannelTriggerState, ChannelTurnInput
from oss.src.core.channels.queue import ChannelSessionQueue
from oss.src.core.channels.render.render import BUSY_TEXT
from oss.src.core.sessions.inputs.dtos import PendingInput, PendingInputState
from oss.src.core.sessions.inputs.service import SessionInputsService
from oss.src.core.workflows.dtos import WorkflowServiceRequest
from oss.src.core.workflows.types import WorkflowDetachedStartFailed
import oss.src.tasks.asyncio.channels.inbox as inbox_module
from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher, TurnRefused

from oss.tests.pytest.unit.channels.test_channels_inbox_dispatcher import (
    _make_channels_service,
    _make_event,
    _make_outbox_event,
    _make_resolution,
    _make_trigger,
)

_TURN_IN_USE = WorkflowDetachedStartFailed(
    "Workflow service rejected detached start: This session is already running "
    "a turn. (session_turn_in_use)"
)


class _InputsDAO:
    """The pending-input rows, keyed like the real table's unique index."""

    def __init__(self):
        self.rows = {}

    @asynccontextmanager
    async def transaction(self):
        yield object()

    async def fetch_by_idempotency_key(
        self, *, project_id, session_id, idempotency_key, transaction=None
    ):
        return self.rows.get((project_id, session_id, idempotency_key))

    async def create_input(
        self, *, user_id, pending_input, prioritize=False, transaction=None
    ):
        key = (
            pending_input.project_id,
            pending_input.session_id,
            pending_input.idempotency_key,
        )
        if key not in self.rows:
            self.rows[key] = PendingInput(
                id=uuid4(),
                project_id=pending_input.project_id,
                session_id=pending_input.session_id,
                content=pending_input.content,
                position=len(self.rows),
                state=PendingInputState.pending,
                policy=pending_input.policy,
                idempotency_key=pending_input.idempotency_key,
                request_fingerprint=pending_input.request_fingerprint,
            )
        return self.rows[key]


class _Stream:
    """The thread session's header; `running` is the runner's heartbeat."""

    def __init__(self, *, running):
        self.running = running

    async def fetch_header(self, *, project_id, session_id):
        return SimpleNamespace(
            flags=SimpleNamespace(is_running=self.running),
            turn_id="turn-running" if self.running else None,
        )


def _queue(*, running):
    dao = _InputsDAO()
    stream = _Stream(running=running)
    queue = ChannelSessionQueue(
        inputs_service=SessionInputsService(inputs_dao=dao, streams_service=stream)
    )
    return queue, dao, stream


def _setup(*, content="follow-up"):
    event = _make_event()
    resolution = _make_resolution()
    trigger = _make_trigger(thread_id=resolution.thread.id, event_id=event.id)
    channels_service = _make_channels_service(
        resolution=resolution,
        trigger=trigger,
        turn_input=ChannelTurnInput(content=[{"type": "text", "text": content}]),
    )
    return event, resolution, trigger, channels_service


class TestFollowUpDuringARunningTurn:
    async def test_the_follow_up_is_queued_once_and_not_started(self):
        event, resolution, trigger, channels_service = _setup()
        queue, dao, _ = _queue(running=True)
        invoke = AsyncMock(return_value="run-1")

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=invoke,
            session_queue=queue,
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        invoke.assert_not_called()
        assert len(dao.rows) == 1
        (row,) = dao.rows.values()
        assert row.state is PendingInputState.pending
        assert row.policy == "queue"
        assert row.session_id == resolution.thread.session_id
        assert row.idempotency_key == f"channels:{trigger.id}"
        # the trigger's offset stands: the message is the session's next turn
        channels_service.settle_turn.assert_awaited_once()
        _, settle_kwargs = channels_service.settle_turn.call_args
        assert settle_kwargs["state"] == ChannelTriggerState.SETTLED

    async def test_the_queued_row_replays_the_exact_turn_request(self):
        """When the running turn settles, the sessions queue promotes the row
        and invokes `WorkflowServiceRequest(**row.content)`. That must be the
        request the dispatcher would have sent itself."""

        event, resolution, _, channels_service = _setup(content="and also this")
        queue, dao, _ = _queue(running=True)

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=AsyncMock(),
            session_queue=queue,
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        (row,) = dao.rows.values()
        replayed = WorkflowServiceRequest.model_validate(row.content)
        expected = InboxDispatcher._build_request(
            resolution=resolution,
            turn_input=ChannelTurnInput(
                content=[{"type": "text", "text": "and also this"}]
            ),
        )
        assert replayed.model_dump(mode="json", exclude_none=True) == (
            expected.model_dump(mode="json", exclude_none=True)
        )
        assert replayed.session_id == resolution.thread.session_id
        assert replayed.data.inputs["messages"] == [
            {"role": "user", "content": [{"type": "text", "text": "and also this"}]}
        ]

    async def test_a_free_session_runs_now_and_queues_nothing(self):
        event, _, _, channels_service = _setup()
        queue, dao, _ = _queue(running=False)
        invoke = AsyncMock(return_value="run-1")

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=invoke,
            session_queue=queue,
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        invoke.assert_awaited_once()
        assert dao.rows == {}

    async def test_a_refusal_after_a_free_read_queues_behind_the_winner(
        self, monkeypatch
    ):
        """The session was free when admitted, then another turn won the race
        and the runner refused the start. The retry re-admits, now sees the
        running turn, and queues, without a second start attempt."""

        monkeypatch.setattr(inbox_module, "_RETRY_BACKOFF_SECONDS", 0)
        event, _, _, channels_service = _setup()
        queue, dao, stream = _queue(running=False)

        async def refused(**kwargs):
            stream.running = True
            raise TurnRefused()

        invoke = AsyncMock(side_effect=refused)
        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=invoke,
            session_queue=queue,
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        invoke.assert_awaited_once()
        assert len(dao.rows) == 1
        _, settle_kwargs = channels_service.settle_turn.call_args
        assert settle_kwargs["state"] == ChannelTriggerState.SETTLED


class TestRedelivery:
    async def test_a_retried_inbox_task_does_not_queue_twice(self):
        """The same addressing admitted twice (a redelivered task that got
        past the trigger claim, or two workers) holds one row."""

        event, _, trigger, channels_service = _setup()
        queue, dao, _ = _queue(running=True)
        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=AsyncMock(),
            session_queue=queue,
        )

        project_id = uuid4()
        for _ in range(2):
            await dispatcher.dispatch_event(
                project_id=project_id, connection_id=event.connection_id, event=event
            )

        assert len(dao.rows) == 1
        (row,) = dao.rows.values()
        assert row.idempotency_key == f"channels:{trigger.id}"

    async def test_a_redelivered_task_that_lost_the_trigger_claim_queues_nothing(
        self,
    ):
        event, resolution, _, channels_service = _setup()
        channels_service.open_turn = AsyncMock(return_value=None)
        queue, dao, _ = _queue(running=True)
        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=AsyncMock(),
            session_queue=queue,
        )

        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        assert dao.rows == {}


class TestNeverDropped:
    def _with_delivery(self, channels_service, resolution):
        channels_service.channels_dao.fetch_outbox_event_by_key = AsyncMock(
            return_value=None
        )
        channels_service.channels_dao.record_outbox_event = AsyncMock(
            return_value=_make_outbox_event(
                thread_id=resolution.thread.id,
                connection_id=resolution.space.connection_id,
            )
        )
        channels_service.channels_dao.transition_outbox_event = AsyncMock()
        adapter = MagicMock()
        adapter.post_message = AsyncMock(return_value={"chat": "1", "ts": "9.9"})
        channels_service.adapter_registry.get = MagicMock(return_value=adapter)
        return adapter

    async def test_the_runner_refusal_frame_is_a_refusal_not_a_failed_start(self):
        """Live, the busy signal arrives as a detached-start failure carrying
        `session_turn_in_use`. It must route to the queue, never to the
        "could not be started" notice."""

        event, resolution, _, channels_service = _setup()
        adapter = self._with_delivery(channels_service, resolution)
        queue, dao, stream = _queue(running=False)
        workflows_service = MagicMock()

        async def refused(**kwargs):
            stream.running = True
            raise _TURN_IN_USE

        workflows_service.invoke_workflow_detached = AsyncMock(side_effect=refused)

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            workflows_service=workflows_service,
            session_queue=queue,
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        assert len(dao.rows) == 1
        adapter.post_message.assert_not_called()
        _, settle_kwargs = channels_service.settle_turn.call_args
        assert settle_kwargs["state"] == ChannelTriggerState.SETTLED

    async def test_without_a_queue_a_lasting_refusal_is_answered_once(
        self, monkeypatch
    ):
        monkeypatch.setattr(inbox_module, "_RETRY_BACKOFF_SECONDS", 0)
        event, resolution, _, channels_service = _setup()
        adapter = self._with_delivery(channels_service, resolution)

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=AsyncMock(side_effect=TurnRefused()),
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        adapter.post_message.assert_awaited_once()
        _, post_kwargs = adapter.post_message.call_args
        assert [part["text"] for part in post_kwargs["content"]] == [BUSY_TEXT]
        _, settle_kwargs = channels_service.settle_turn.call_args
        assert settle_kwargs["state"] == ChannelTriggerState.REFUSED

    async def test_a_failing_admission_still_runs_the_message(self):
        event, _, _, channels_service = _setup()
        queue = MagicMock()
        queue.admit = AsyncMock(side_effect=RuntimeError("db down"))
        invoke = AsyncMock(return_value="run-1")

        dispatcher = InboxDispatcher(
            channels_service=channels_service,
            invoke_fn=invoke,
            session_queue=queue,
        )
        await dispatcher.dispatch_event(
            project_id=uuid4(), connection_id=event.connection_id, event=event
        )

        invoke.assert_awaited_once()
        _, settle_kwargs = channels_service.settle_turn.call_args
        assert settle_kwargs["state"] == ChannelTriggerState.SETTLED
