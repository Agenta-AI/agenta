from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import ChannelDeliveryState
from oss.src.core.channels.queue import ChannelQueueDecision
from oss.src.core.channels.service import ChannelsService
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher, TurnRefused
from oss.src.tasks.asyncio.channels.outbox import ChannelsOutboxWorker

from .contract.fakes import WellBehavedFakeAdapter
from .test_channels_inbox_dispatcher import (
    _make_channels_service,
    _make_connection,
    _make_event,
    _make_resolution,
    _make_trigger,
)
from .test_channels_outbox_worker import (
    FakeChannelsDAO,
    FakeRecordsDAO,
    FakeTurnsDAO,
    PROJECT_ID,
)


@pytest.mark.parametrize(
    "queue_decision", [ChannelQueueDecision.RUN_NOW, ChannelQueueDecision.QUEUED]
)
async def test_inbox_adds_eyes_before_invoke_or_queue(queue_decision):
    service = _make_channels_service(
        resolution=_make_resolution(), trigger=_make_trigger()
    )
    service.fetch_connection.return_value = _make_connection(channel="slack")
    adapter = service.adapter_registry.get.return_value

    async def admit(**kwargs):
        assert adapter.set_message_status.call_args.kwargs["status"] == "received"
        return queue_decision

    dispatcher = InboxDispatcher(channels_service=service, invoke_fn=AsyncMock())
    dispatcher._queue_behind_running_turn = admit
    event = _make_event()
    event.data.external_locator["message_ts"] = "200.002"
    await dispatcher.dispatch_event(
        project_id=PROJECT_ID, connection_id=event.connection_id, event=event
    )
    adapter.set_message_status.assert_awaited_once()
    assert (
        adapter.set_message_status.call_args.kwargs["locator"]["message_ts"]
        == "200.002"
    )


@pytest.mark.parametrize(
    "resolution,trigger", [(None, None), (_make_resolution(), None)]
)
async def test_refused_or_duplicate_message_has_no_reaction(resolution, trigger):
    service = _make_channels_service(resolution=resolution, trigger=trigger)
    service.fetch_connection.return_value = _make_connection(channel="slack")
    event = _make_event()
    await InboxDispatcher(
        channels_service=service, invoke_fn=AsyncMock()
    ).dispatch_event(
        project_id=PROJECT_ID, connection_id=event.connection_id, event=event
    )
    service.adapter_registry.get.return_value.set_message_status.assert_not_awaited()


@pytest.mark.parametrize("error", [RuntimeError("failed"), TurnRefused()])
async def test_failed_start_clears_eyes(error, monkeypatch):
    import oss.src.tasks.asyncio.channels.inbox as inbox

    monkeypatch.setattr(inbox, "_MAX_INVOKE_ATTEMPTS", 1)
    service = _make_channels_service(
        resolution=_make_resolution(), trigger=_make_trigger()
    )
    service.fetch_connection.return_value = _make_connection(channel="slack")
    dispatcher = InboxDispatcher(
        channels_service=service, invoke_fn=AsyncMock(side_effect=error)
    )
    dispatcher._notify_not_started = AsyncMock()
    event = _make_event()
    await dispatcher.dispatch_event(
        project_id=PROJECT_ID, connection_id=event.connection_id, event=event
    )
    assert [
        c.kwargs["status"]
        for c in service.adapter_registry.get.return_value.set_message_status.await_args_list
    ] == ["received", "failed"]


@pytest.fixture
def reaction_worker():
    dao = FakeChannelsDAO()
    connection = dao.seed_connection(channel="slack")
    space = dao.seed_space(connection_id=connection.id)
    thread = dao.seed_thread(space_id=space.id, session_id="session-1")
    adapter = WellBehavedFakeAdapter()
    adapter.set_message_status = AsyncMock()
    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"slack": adapter}),
    )
    executions = SimpleNamespace(
        fetch_execution=AsyncMock(
            return_value=SimpleNamespace(
                terminal_outcome="completed",
                error=None,
                parent_execution_id=None,
            )
        )
    )
    inputs = SimpleNamespace(fetch_by_execution_id=AsyncMock(return_value=None))
    event = _make_event(connection_id=connection.id)
    event.data.external_locator = {
        "channel": "C1",
        "message_ts": "200.002",
        "thread_ts": "100.001",
    }
    trigger = _make_trigger(thread_id=thread.id, event_id=event.id, turn_id="turn-1")
    dao.query_inbox_triggers = AsyncMock(return_value=[trigger])
    dao.query_inbox_events = AsyncMock(return_value=[event])
    worker = ChannelsOutboxWorker(
        channels_service=service,
        turns_service=SessionTurnsService(turns_dao=FakeTurnsDAO()),
        records_service=RecordsService(FakeRecordsDAO()),
        executions_dao=executions,
        inputs_dao=inputs,
    )
    worker._fold_turn = AsyncMock(
        return_value={
            "messages": [{"role": "assistant", "content": "Done."}],
            "stop_reason": "end_turn",
        }
    )
    return SimpleNamespace(
        worker=worker,
        dao=dao,
        connection=connection,
        thread=thread,
        adapter=adapter,
        executions=executions,
        inputs=inputs,
        event=event,
        trigger=trigger,
    )


async def finish(h):
    await h.worker.on_turn_ended(
        project_id=PROJECT_ID,
        thread=h.thread,
        session_id=h.thread.session_id,
        turn_id="turn-1",
    )


async def test_completion_reacts_after_delivery_and_duplicate_is_safe(reaction_worker):
    h = reaction_worker

    async def react(**kwargs):
        assert all(e.state == ChannelDeliveryState.SENT for e in h.dao.outbox.values())
        assert kwargs["status"] == "completed"
        assert kwargs["locator"]["message_ts"] == "200.002"

    h.adapter.set_message_status.side_effect = react
    await finish(h)
    await finish(h)
    assert h.adapter.set_message_status.await_count == 2
    assert len(h.dao.outbox) == 1
    assert h.dao.query_inbox_events.call_args.kwargs["event"].id == h.event.id


@pytest.mark.parametrize(
    "outcome,error",
    [
        ("stopped", None),
        ("lost", None),
        ("failed", {"message": "failure"}),
        ("completed", {"message": "failure"}),
    ],
)
async def test_failed_or_stopped_execution_never_gets_checkmark(
    reaction_worker, outcome, error
):
    h = reaction_worker
    h.executions.fetch_execution.return_value.terminal_outcome = outcome
    h.executions.fetch_execution.return_value.error = error
    await finish(h)
    assert h.adapter.set_message_status.call_args.kwargs["status"] == "failed"


@pytest.mark.parametrize("outcome", [None, "continued"])
async def test_unsettled_or_continued_execution_keeps_eyes(reaction_worker, outcome):
    h = reaction_worker
    h.executions.fetch_execution.return_value.terminal_outcome = outcome
    await finish(h)
    h.adapter.set_message_status.assert_not_awaited()


@pytest.mark.parametrize("reason", ["error", "cancelled"])
async def test_error_ending_without_settlement_clears_eyes(reaction_worker, reason):
    h = reaction_worker
    h.executions.fetch_execution.return_value.terminal_outcome = None
    h.worker._fold_turn.return_value["stop_reason"] = reason
    await finish(h)
    assert h.adapter.set_message_status.call_args.kwargs["status"] == "failed"


async def test_approval_keeps_eyes(reaction_worker):
    h = reaction_worker
    h.worker._fold_turn.return_value["stop_reason"] = "paused"
    await finish(h)
    h.adapter.set_message_status.assert_not_awaited()


async def test_no_answer_clears_eyes_without_checkmark(reaction_worker, monkeypatch):
    import oss.src.tasks.asyncio.channels.outbox as outbox

    monkeypatch.setattr(outbox, "_EMPTY_FOLD_ATTEMPTS", 1)
    h = reaction_worker
    h.worker._fold_turn.return_value = {}
    await finish(h)
    assert h.adapter.set_message_status.call_args.kwargs["status"] == "failed"


@pytest.mark.parametrize("result", [False, RuntimeError("delivery failed")])
async def test_failed_delivery_never_gets_checkmark(reaction_worker, result):
    h = reaction_worker
    h.worker._send = AsyncMock(
        return_value=result if result is False else None,
        side_effect=result if isinstance(result, Exception) else None,
    )
    if isinstance(result, Exception):
        with pytest.raises(RuntimeError):
            await finish(h)
    else:
        await finish(h)
    assert h.adapter.set_message_status.call_args.kwargs["status"] == "failed"


async def test_one_failed_answer_part_prevents_checkmark(reaction_worker):
    h = reaction_worker
    h.worker._fold_turn.return_value["messages"] = [
        {"role": "assistant", "content": "x" * 100000}
    ]
    h.worker._send = AsyncMock(side_effect=[False] + [True] * 100)
    await finish(h)
    assert h.worker._send.await_count > 1
    assert h.adapter.set_message_status.call_args.kwargs["status"] == "failed"


async def test_queued_execution_finds_exact_trigger(reaction_worker):
    h = reaction_worker
    h.dao.query_inbox_triggers.side_effect = [[], [h.trigger]]
    h.inputs.fetch_by_execution_id.return_value = SimpleNamespace(
        idempotency_key=f"channels:{h.trigger.id}"
    )
    await finish(h)
    query = h.dao.query_inbox_triggers.call_args.kwargs["trigger"]
    assert query.id == h.trigger.id
    assert query.thread_id == h.thread.id
    assert h.adapter.set_message_status.call_args.kwargs["status"] == "completed"


async def test_approval_child_finds_original_request(reaction_worker):
    h = reaction_worker
    h.executions.fetch_execution.return_value.parent_execution_id = "original-turn"
    h.dao.query_inbox_triggers.side_effect = [[], [h.trigger]]
    await finish(h)
    assert (
        h.dao.query_inbox_triggers.call_args.kwargs["trigger"].turn_id
        == "original-turn"
    )
    assert h.adapter.set_message_status.call_args.kwargs["status"] == "completed"


async def test_non_channel_queued_input_does_not_mark_its_parent_done(reaction_worker):
    h = reaction_worker
    h.dao.query_inbox_triggers.return_value = []
    h.inputs.fetch_by_execution_id.return_value = SimpleNamespace(
        idempotency_key="playground-input"
    )
    h.executions.fetch_execution.return_value.parent_execution_id = "older-channel-turn"
    await finish(h)
    h.adapter.set_message_status.assert_not_awaited()


async def test_lookup_failure_cannot_fail_delivered_answer(reaction_worker):
    h = reaction_worker
    h.dao.query_inbox_triggers.side_effect = RuntimeError("database unavailable")
    await finish(h)
    assert all(e.state == ChannelDeliveryState.SENT for e in h.dao.outbox.values())
    h.adapter.set_message_status.assert_not_awaited()


async def test_non_slack_answer_skips_reaction_lookups(reaction_worker):
    h = reaction_worker
    h.connection.channel = "fake"
    await h.worker._update_request_reaction(
        project_id=PROJECT_ID,
        thread=h.thread,
        connection=h.connection,
        turn_id="turn-1",
        status="completed",
    )
    h.executions.fetch_execution.assert_not_awaited()
