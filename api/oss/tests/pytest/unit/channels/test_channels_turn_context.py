"""What each turn receives when messages, mentions and failures interleave.

The contract (Mahmoud, 2026-09-24): a turn carries every message posted in
the thread since the agent's last turn there, and only those. These tests
drive the real `ChannelsService` and, where the order of work matters, the
real `InboxDispatcher`, over the in-memory inbox in `turn_harness`.
"""

import asyncio
from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pytest

import oss.src.tasks.asyncio.channels.inbox as inbox_module
from oss.src.core.channels.dtos import (
    CHANNEL_TRIGGER_NEVER_SENT,
    ChannelEventKind,
    ChannelPendingChoice,
    ChannelPendingChoiceItem,
    ChannelTriggerState,
)
from oss.src.core.channels.queue import ChannelQueueDecision
from oss.src.core.workflows.types import WorkflowDetachedStartNeverSent
from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher, TurnRefused

from .turn_harness import InMemoryChannels, texts


class _Runner:
    """Stands in for the invoke: records what each turn was sent, and fails
    the turns it is told to fail."""

    def __init__(self):
        self.sent = []
        self.failures = {}

    async def invoke(self, *, project_id, resolution, turn_input, turn_id, **extra):
        # the runner received the request before anything can go wrong
        words = texts(turn_input.content)
        error = self.failures.get(words[-1])
        if isinstance(error, WorkflowDetachedStartNeverSent) or isinstance(
            error, TurnRefused
        ):
            raise error
        self.sent.append(words)
        if error is not None:
            raise error
        return turn_id


class _Queue:
    """The session queue: the first turn runs, every later one queues behind
    it, and the queued request is kept exactly as it would be replayed."""

    def __init__(self):
        self.queued = []
        self.calls = 0

    async def admit(self, *, project_id, user_id, session_id, request, idempotency_key):
        self.calls += 1
        if self.calls == 1:
            return ChannelQueueDecision.RUN_NOW
        self.queued.append(request)
        return ChannelQueueDecision.QUEUED


def _dispatcher(channels, runner, **kwargs):
    return InboxDispatcher(
        channels_service=channels.service, invoke_fn=runner.invoke, **kwargs
    )


async def _dispatch(channels, dispatcher, event):
    await dispatcher.dispatch_event(
        project_id=channels.project_id,
        connection_id=channels.connection.id,
        event=channels.fetch(event.id),
    )


async def _say(channels, dispatcher, text, *, addressed=False, kind=None):
    extra = {"kind": kind} if kind is not None else {}
    event = channels.store(text, addressed=addressed, **extra)
    await _dispatch(channels, dispatcher, event)
    return event


class TestTheRangeStopsAtTheAddressingMessage:
    async def test_a_message_stored_after_the_mention_waits_for_the_next_turn(self):
        """Codex's repro: `b` lands between M2's resolve and its compose. It
        used to go out with M2 and again with M3."""
        channels = InMemoryChannels()
        assert await channels.post("M1", addressed=True) == ["M1"]

        await channels.arrive("a")
        m2 = channels.store("M2", addressed=True)
        resolution = await channels.resolve(m2)
        await channels.arrive("b")
        turn_input = await channels.compose(resolution, m2)
        await channels.open_and_settle(
            resolution, m2, state=ChannelTriggerState.SETTLED
        )

        assert texts(turn_input.content) == ["a", "M2"]
        assert await channels.post("M3", addressed=True) == ["b", "M3"]


def _turns_by_mention(runner):
    """Which mention each turn answered: the last word of its input."""
    return [turn[-1] for turn in runner.sent]


class TestConcurrentMentions:
    """Dispatches are not serialised. The deliberate limit: when messages in
    one thread arrive within about a second and run out of order, context
    can repeat or be missing. What must hold: every mention gets exactly one
    turn, and no turn is dropped or run twice."""

    async def test_a_later_mention_composed_first_does_not_swallow_the_earlier(
        self,
    ):
        channels = InMemoryChannels()
        await channels.post("M1", addressed=True)

        await channels.arrive("a")
        m2 = channels.store("M2", addressed=True)
        await channels.arrive("b")
        m3 = channels.store("M3", addressed=True)
        r2 = await channels.resolve(m2)
        r3 = await channels.resolve(m3)

        third = await channels.compose(r3, m3)
        await channels.open_and_settle(r3, m3, state=ChannelTriggerState.SETTLED)
        second = await channels.compose(r2, m2)
        await channels.open_and_settle(r2, m2, state=ChannelTriggerState.SETTLED)

        # both mentions run; `a` reaches both (the documented repeat)
        assert texts(third.content) == ["a", "M2", "b", "M3"]
        assert texts(second.content) == ["a", "M2"]
        # the next mention starts after the latest event any turn covered
        assert await channels.post("M4", addressed=True) == ["M4"]

    async def test_two_mentions_dispatched_at_once_each_run_once(self):
        channels = InMemoryChannels()
        runner = _Runner()
        dispatcher = _dispatcher(channels, runner)
        await _say(channels, dispatcher, "M1", addressed=True)

        channels.store("a")
        m2 = channels.store("M2", addressed=True)
        channels.store("b")
        m3 = channels.store("M3", addressed=True)
        await asyncio.gather(
            _dispatch(channels, dispatcher, m2),
            _dispatch(channels, dispatcher, m3),
            _dispatch(channels, dispatcher, m2),  # a redelivery
        )

        assert sorted(_turns_by_mention(runner)) == ["M1", "M2", "M3"]


class TestQueuedTurns:
    async def test_queued_mentions_carry_their_own_messages(self):
        """M2 and M3 arrive while M1's turn runs, so both queue. The request
        the queue holds for each is what the runner will replay."""
        channels = InMemoryChannels()
        runner = _Runner()
        queue = _Queue()
        dispatcher = _dispatcher(channels, runner, session_queue=queue)

        await _say(channels, dispatcher, "M1", addressed=True)
        for index in range(1, 6):
            await _say(channels, dispatcher, f"a{index}")
        await _say(channels, dispatcher, "M2", addressed=True)
        for index in range(1, 4):
            await _say(channels, dispatcher, f"b{index}")
        await _say(channels, dispatcher, "M3", addressed=True)

        payloads = [
            texts(request["data"]["inputs"]["messages"][0]["content"])
            for request in queue.queued
        ]
        assert runner.sent == [["M1"]]
        assert payloads == [
            ["a1", "a2", "a3", "a4", "a5", "M2"],
            ["b1", "b2", "b3", "M3"],
        ]


class TestTurnsThatFail:
    async def test_a_lost_response_after_delivery_does_not_replay_the_turn(self):
        """The POST reached the runner, then the response was lost. The
        outcome is uncertain, so the offset moves: M3 must not send M2's
        messages again and repeat what the agent already did."""
        channels = InMemoryChannels()
        runner = _Runner()
        runner.failures["M2"] = httpx.ReadError("connection reset")
        dispatcher = _dispatcher(channels, runner)

        await _say(channels, dispatcher, "M1", addressed=True)
        await _say(channels, dispatcher, "a")
        await _say(channels, dispatcher, "M2", addressed=True)
        await _say(channels, dispatcher, "b")
        await _say(channels, dispatcher, "M3", addressed=True)

        assert runner.sent == [["M1"], ["a", "M2"], ["b", "M3"]]
        failed = [
            trigger
            for trigger in channels.triggers
            if trigger.state is ChannelTriggerState.FAILED
        ]
        assert len(failed) == 1
        assert failed[0].status.code != CHANNEL_TRIGGER_NEVER_SENT

    async def test_a_start_that_was_never_sent_keeps_its_context(self):
        channels = InMemoryChannels()
        runner = _Runner()
        runner.failures["M2"] = WorkflowDetachedStartNeverSent("HTTP 404")
        dispatcher = _dispatcher(channels, runner)

        await _say(channels, dispatcher, "M1", addressed=True)
        await _say(channels, dispatcher, "a")
        await _say(channels, dispatcher, "M2", addressed=True)
        await _say(channels, dispatcher, "b")
        await _say(channels, dispatcher, "M3", addressed=True)

        assert runner.sent == [["M1"], ["a", "M2", "b", "M3"]]
        failed = [
            trigger
            for trigger in channels.triggers
            if trigger.state is ChannelTriggerState.FAILED
        ]
        assert failed[0].status.code == CHANNEL_TRIGGER_NEVER_SENT

    async def test_a_refused_turn_keeps_its_context(self, monkeypatch):
        """REFUSED means the runner turned the start away every time: the
        session was busy and the message could not queue. Nothing ran."""
        monkeypatch.setattr(inbox_module, "_RETRY_BACKOFF_SECONDS", 0)
        channels = InMemoryChannels()
        runner = _Runner()
        runner.failures["M2"] = TurnRefused()
        dispatcher = _dispatcher(channels, runner)

        await _say(channels, dispatcher, "M1", addressed=True)
        await _say(channels, dispatcher, "a")
        await _say(channels, dispatcher, "M2", addressed=True)
        await _say(channels, dispatcher, "M3", addressed=True)

        assert runner.sent == [["M1"], ["a", "M2", "M3"]]

    async def test_a_start_that_fails_after_a_later_turn_began_is_not_replayed(
        self,
    ):
        """M3 composed while M2's start was still in flight, so M3 read from
        M2's offset. When M2 then fails, its messages are not replayed later:
        M3 has moved past them, and the chat got the failed-start notice for
        M2. What M3 carried is not sent twice either."""
        channels = InMemoryChannels()
        await channels.post("M1", addressed=True)

        await channels.arrive("a")
        m2 = channels.store("M2", addressed=True)
        r2 = await channels.resolve(m2)
        await channels.compose(r2, m2)
        trigger = await channels.service.open_turn(
            project_id=channels.project_id,
            resolution=r2,
            turn_id="turn-m2",
            event_id=m2.id,
        )
        third = await channels.post("M3", addressed=True)
        from oss.src.core.shared.dtos import Status

        await channels.service.settle_turn(
            project_id=channels.project_id,
            trigger_id=trigger.id,
            state=ChannelTriggerState.FAILED,
            status=Status(code=CHANNEL_TRIGGER_NEVER_SENT),
        )
        await channels.arrive("c")
        fourth = await channels.post("M4", addressed=True)

        assert third == ["M3"]
        assert fourth == ["c", "M4"]


def _pending(interaction_id):
    return ChannelPendingChoice(
        choices=[
            ChannelPendingChoiceItem(
                label="Approve", token=f"{interaction_id}:approve"
            ),
            ChannelPendingChoiceItem(label="Deny", token=f"{interaction_id}:deny"),
        ],
        posted_at=datetime.now(timezone.utc),
        interaction_id=interaction_id,
    )


class TestForwardfillAfterApprovals:
    async def _park(self, channels, dispatcher):
        await _say(channels, dispatcher, "M1", addressed=True)
        interaction_id = str(uuid4())
        await channels.service.set_pending_choice(
            project_id=channels.project_id,
            thread_id=channels.threads[0].id,
            pending_choice=_pending(interaction_id),
        )
        return interaction_id

    @pytest.mark.parametrize(
        "answer,kind",
        [
            ("Approve", ChannelEventKind.MESSAGE),
            ("2", ChannelEventKind.MESSAGE),
            (None, ChannelEventKind.ACTION),
        ],
    )
    async def test_an_answered_choice_is_not_sent_again_as_conversation(
        self, answer, kind
    ):
        channels = InMemoryChannels()
        runner = _Runner()
        answers = []

        async def respond(**kwargs):
            answers.append(kwargs["answer"])

        dispatcher = _dispatcher(channels, runner, respond_interaction_fn=respond)
        interaction_id = await self._park(channels, dispatcher)

        await _say(channels, dispatcher, "side note")
        text = answer if answer is not None else f"{interaction_id}:approve"
        await _say(channels, dispatcher, text, kind=kind)
        await _say(channels, dispatcher, "after")
        await _say(channels, dispatcher, "M2", addressed=True)

        assert len(answers) == 1
        assert runner.sent == [["M1"], ["side note", "after", "M2"]]

    async def test_a_stale_click_is_not_sent_as_conversation(self):
        channels = InMemoryChannels()
        runner = _Runner()
        dispatcher = _dispatcher(channels, runner)
        await _say(channels, dispatcher, "M1", addressed=True)

        await _say(
            channels,
            dispatcher,
            "old-interaction:approve",
            kind=ChannelEventKind.ACTION,
        )
        await _say(channels, dispatcher, "M2", addressed=True)

        assert runner.sent == [["M1"], ["M2"]]


class TestDispatchOrder:
    """Codex's second and third reviews found mentions dropped when a later
    event was dispatched first. Nothing skips a mention now, so each of
    those orders still runs every mention once."""

    async def test_an_earlier_mention_dispatched_late_still_runs(self):
        channels = InMemoryChannels()
        runner = _Runner()
        dispatcher = _dispatcher(channels, runner)
        await _say(channels, dispatcher, "M1", addressed=True)

        a = channels.store("a")
        m2 = channels.store("M2", addressed=True)
        b = channels.store("b")
        m3 = channels.store("M3", addressed=True)
        for event in (m3, m2, a, b):
            await _dispatch(channels, dispatcher, event)
        await _say(channels, dispatcher, "M4", addressed=True)

        assert _turns_by_mention(runner) == ["M1", "M3", "M2", "M4"]

    async def test_a_dm_message_dispatched_after_a_later_one_still_runs(self):
        from oss.src.core.channels.dtos import ChannelSpaceKind

        channels = InMemoryChannels(space_kind=ChannelSpaceKind.PRIVATE)
        runner = _Runner()
        dispatcher = _dispatcher(channels, runner)

        m1 = channels.store("M1")
        m2 = channels.store("M2")
        await _dispatch(channels, dispatcher, m2)
        await _dispatch(channels, dispatcher, m1)

        assert sorted(_turns_by_mention(runner)) == ["M1", "M2"]

    async def test_a_mention_delayed_for_hours_still_runs(self):
        from datetime import timedelta

        channels = InMemoryChannels()
        runner = _Runner()
        dispatcher = _dispatcher(channels, runner)
        await _say(channels, dispatcher, "M1", addressed=True)

        m2 = channels.store(
            "M2",
            addressed=True,
            created_at=datetime.now(timezone.utc) - timedelta(hours=3),
        )
        m3 = channels.store("M3", addressed=True)
        await _dispatch(channels, dispatcher, m3)
        await _dispatch(channels, dispatcher, m2)

        assert _turns_by_mention(runner) == ["M1", "M3", "M2"]

    async def test_an_answer_dispatched_after_a_mention_is_still_only_an_answer(
        self,
    ):
        channels = InMemoryChannels()
        runner = _Runner()
        answers = []

        async def respond(**kwargs):
            answers.append(kwargs["answer"])

        dispatcher = _dispatcher(channels, runner, respond_interaction_fn=respond)
        await _say(channels, dispatcher, "M1", addressed=True)
        await channels.service.set_pending_choice(
            project_id=channels.project_id,
            thread_id=channels.threads[0].id,
            pending_choice=_pending(str(uuid4())),
        )

        answer = channels.store("Approve")
        m2 = channels.store("M2", addressed=True)
        await _dispatch(channels, dispatcher, m2)
        await _dispatch(channels, dispatcher, answer)

        assert runner.sent == [["M1"], ["M2"]]
        assert answers == [{"approved": True}]


class TestAFailureBeforeTheInvoke:
    async def test_a_failed_identity_lookup_does_not_drop_the_mention(
        self, monkeypatch
    ):
        """Codex's fourth review: the trigger was recorded before the sender's
        identity lookup. When the lookup raised, the task retry found the
        trigger already claimed and returned: M1 never ran."""
        channels = InMemoryChannels()
        runner = _Runner()
        dispatcher = _dispatcher(channels, runner)
        original = dispatcher._invoking_user_id
        calls = []

        async def flaky_identity(**kwargs):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("identity lookup failed")
            return await original(**kwargs)

        monkeypatch.setattr(dispatcher, "_invoking_user_id", flaky_identity)

        m1 = channels.store("M1", addressed=True)
        with pytest.raises(RuntimeError):
            await _dispatch(channels, dispatcher, m1)
        await _dispatch(channels, dispatcher, m1)  # the task retry
        await _say(channels, dispatcher, "M2", addressed=True)

        assert _turns_by_mention(runner) == ["M1", "M2"]
