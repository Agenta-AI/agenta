"""The outbox driving the real WhatsAppAdapter over the fake Graph API: the
native typing indicator instead of a "Thinking…" message, one working
message on long turns, answers as new messages, the 24-hour window (held
replies, error 131047, the re-open template) and releasing held replies."""

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
import pytest
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.whatsapp.adapter import WhatsAppAdapter
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelDeliveryState,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEvent,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelSpace,
    ChannelSpaceData,
    ChannelSpaceKind,
)
from oss.src.core.channels.render.render import WORKING_TEXT
from oss.src.core.channels.service import ChannelsService
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.tasks.asyncio.channels.outbox import ChannelsOutboxWorker

from ..test_channels_outbox_worker import (
    PROJECT_ID,
    FakeChannelsDAO,
    FakeRecordsDAO,
    FakeTurnsDAO,
    _FakeInteractionsService,
)
from . import payloads as p
from .fake_graph import FakeGraph


class WhatsAppDAO(FakeChannelsDAO):
    """Adds the reads the WhatsApp paths make: the space's inbound log (for
    the reply window and the typing indicator) and the thread's HELD rows."""

    def __init__(self):
        super().__init__()
        self.inbox = []

    def seed_whatsapp(self, *, data=None):
        connection = ChannelConnection(
            id=uuid4(),
            slug="whatsapp-bella",
            channel="whatsapp",
            external_key=uuid4(),
            data={
                "connection_locator": {"phone_number_id": p.PHONE_NUMBER_ID},
                "access_token": p.ACCESS_TOKEN,
                "app_secret": p.APP_SECRET,
                **(data or {}),
            },
        )
        self.connections[connection.id] = connection
        space = ChannelSpace(
            id=uuid4(),
            connection_id=connection.id,
            kind=ChannelSpaceKind.PRIVATE,
            external_key=uuid4(),
            data=ChannelSpaceData(external_locator={"wa_id": p.CUSTOMER}),
        )
        self.spaces[space.id] = space
        thread = self.seed_thread(
            space_id=space.id,
            session_id=str(uuid4()),
            external_locator={"wa_id": p.CUSTOMER},
        )
        return connection, space, thread

    def customer_wrote(
        self, space, *, message_id="wamid.IN", ago=timedelta(0), sent_ago=None
    ):
        now = datetime.now(timezone.utc)
        self.inbox.append(
            ChannelInboxEvent(
                id=uuid4(),
                created_at=now - ago,
                connection_id=space.connection_id,
                space_id=space.id,
                external_id=message_id,
                kind=ChannelEventKind.MESSAGE,
                origin=ChannelEventOrigin.PUSHED,
                data=ChannelInboxEventData(
                    external_locator={"wa_id": p.CUSTOMER},
                    processed=ChannelInboxEventProcessed(
                        content=[{"type": "text", "text": "hi"}], sender={}
                    ),
                    sent_at=now - (ago if sent_ago is None else sent_ago),
                ),
            )
        )

    async def query_inbox_events(self, *, project_id, event=None, windowing=None):
        rows = [
            row
            for row in self.inbox
            if (event is None or event.space_id in (None, row.space_id))
            and (event is None or event.origin in (None, row.origin))
        ]
        rows.sort(key=lambda row: row.created_at, reverse=True)
        if windowing is not None and windowing.limit:
            rows = rows[: windowing.limit]
        return rows

    async def query_outbox_events(self, *, project_id, event=None, windowing=None):
        rows = [
            row
            for row in self.outbox.values()
            if (event.thread_id is None or row.thread_id == event.thread_id)
            and (event.state is None or row.state == event.state)
        ]
        return sorted(rows, key=lambda row: row.created_at)

    def rows(self, state=None):
        return [r for r in self.outbox.values() if state is None or r.state == state]


@pytest.fixture
def graph():
    fake = FakeGraph()
    fake.add_number(phone_number_id=p.PHONE_NUMBER_ID, token=p.ACCESS_TOKEN)
    return fake


@pytest.fixture
def dao():
    return WhatsAppDAO()


@pytest.fixture
def records():
    return FakeRecordsDAO()


@pytest.fixture
def service(dao, graph):
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=graph.app),
        base_url="https://graph.facebook.com/v24.0",
    )
    adapter = WhatsAppAdapter(http_client=client, pair_limit_retry_seconds=0)
    return ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"whatsapp": adapter}),
    )


def _worker(service, records, **kwargs):
    return ChannelsOutboxWorker(
        channels_service=service,
        turns_service=SessionTurnsService(turns_dao=FakeTurnsDAO()),
        records_service=RecordsService(records),
        interactions_service=_FakeInteractionsService(),
        **kwargs,
    )


def _answer(records, thread, turn_id, text):
    records.seed(
        session_id=thread.session_id,
        turn_id=turn_id,
        record_type="message",
        attributes={"text": text},
    )


async def _start(worker, thread, turn_id):
    await worker.on_turn_started(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id=turn_id,
        session_id=thread.session_id,
    )


async def _end(worker, thread, turn_id):
    await worker.on_turn_ended(
        project_id=PROJECT_ID,
        thread=thread,
        turn_id=turn_id,
        session_id=thread.session_id,
    )


# --- turn start: typing, never a placeholder ----------------------------- #


async def test_turn_start_shows_typing_on_the_customers_message_and_posts_nothing(
    service, dao, graph, records
):
    worker = _worker(service, records)
    _, space, thread = dao.seed_whatsapp()
    dao.customer_wrote(space, message_id="wamid.Q")

    await _start(worker, thread, "t1")
    await asyncio.sleep(0.05)
    await worker.stop_progress("t1")

    assert graph.sent == []
    assert graph.typing[0]["message_id"] == "wamid.Q"
    assert graph.typing[0]["typing_indicator"] == {"type": "text"}


async def test_a_short_turn_shows_only_the_answer(service, dao, graph, records):
    worker = _worker(service, records)
    _, space, thread = dao.seed_whatsapp()
    dao.customer_wrote(space)

    await _start(worker, thread, "t1")
    _answer(records, thread, "t1", "Yes, it left **yesterday**.")
    await _end(worker, thread, "t1")

    assert graph.texts_to(p.CUSTOMER) == ["Yes, it left *yesterday*."]


async def test_a_long_turn_gets_one_working_message_then_the_answer(
    service, dao, graph, records
):
    worker = _worker(
        service,
        records,
        progress_interval_seconds=0.01,
        activity_refresh_seconds=0.02,
        working_notice_seconds=0.05,
    )
    _, space, thread = dao.seed_whatsapp()
    dao.customer_wrote(space)

    await _start(worker, thread, "t1")
    await asyncio.sleep(0.3)
    _answer(records, thread, "t1", "Here is the comparison.")
    await _end(worker, thread, "t1")

    assert graph.texts_to(p.CUSTOMER) == [WORKING_TEXT, "Here is the comparison."]
    assert len(graph.typing) >= 3  # refreshed while the turn ran


async def test_a_redelivered_turn_start_sends_the_working_message_once(
    service, dao, graph, records
):
    worker = _worker(
        service, records, progress_interval_seconds=0.01, working_notice_seconds=0.03
    )
    _, space, thread = dao.seed_whatsapp()
    dao.customer_wrote(space)

    await _start(worker, thread, "t1")
    await asyncio.sleep(0.1)
    await worker.stop_progress("t1")
    await _start(worker, thread, "t1")
    await asyncio.sleep(0.1)
    await worker.stop_progress("t1")

    assert graph.texts_to(p.CUSTOMER) == [WORKING_TEXT]


async def test_a_long_answer_goes_out_as_several_messages(service, dao, graph, records):
    worker = _worker(service, records)
    _, space, thread = dao.seed_whatsapp()
    dao.customer_wrote(space)
    paragraph = ("word " * 199).strip() + "."
    _answer(records, thread, "t1", "\n\n".join([paragraph] * 9))

    await _end(worker, thread, "t1")

    parts = graph.texts_to(p.CUSTOMER)
    assert len(parts) == 3
    assert all(len(part) <= 4096 for part in parts)


async def test_an_approval_goes_out_as_reply_buttons_bound_to_the_interaction(
    service, dao, graph, records
):
    worker = _worker(service, records)
    _, space, thread = dao.seed_whatsapp()
    dao.customer_wrote(space)
    records.seed(
        session_id=thread.session_id,
        turn_id="t1",
        record_type="interaction_request",
        attributes={
            "id": "int-1",
            "payload": {
                "toolCall": {"name": "cancel_order", "rawInput": {"order": "4411"}}
            },
        },
    )
    records.seed(
        session_id=thread.session_id,
        turn_id="t1",
        record_type="done",
        attributes={"stopReason": "paused"},
    )

    await _end(worker, thread, "t1")

    [message] = [m for m in graph.sent if m["type"] == "interactive"]
    buttons = message["interactive"]["action"]["buttons"]
    assert [b["reply"]["id"] for b in buttons] == [
        "row-int-1:approve",
        "row-int-1:deny",
    ]
    assert "4411" in message["interactive"]["body"]["text"]
    assert dao.threads[thread.id].data.pending_choice is not None


# --- the 24-hour window -------------------------------------------------- #


async def test_an_answer_after_the_window_is_held_and_nothing_is_sent(
    service, dao, graph, records
):
    worker = _worker(service, records)
    _, space, thread = dao.seed_whatsapp()
    dao.customer_wrote(space, ago=timedelta(hours=24, minutes=10))
    _answer(records, thread, "t1", "Your refund failed because ...")

    await _end(worker, thread, "t1")

    assert graph.sent == []
    [row] = dao.rows(ChannelDeliveryState.HELD)
    assert row.status.code == "window_closed"
    assert row.data.processed["content"][0]["text"] == "Your refund failed because ..."


async def test_a_turn_that_started_inside_the_window_but_ended_outside_is_held(
    service, dao, graph, records
):
    worker = _worker(service, records)
    _, space, thread = dao.seed_whatsapp()
    dao.customer_wrote(space, ago=timedelta(hours=23, minutes=50))

    await _start(worker, thread, "t1")
    await worker.stop_progress("t1")
    first = dao.inbox[0]
    dao.inbox[0] = first.model_copy(
        update={
            "data": first.data.model_copy(
                update={"sent_at": first.data.sent_at - timedelta(minutes=20)}
            )
        }
    )
    _answer(records, thread, "t1", "late")
    await _end(worker, thread, "t1")

    assert graph.texts_to(p.CUSTOMER) == []
    assert len(dao.rows(ChannelDeliveryState.HELD)) == 1


async def test_meta_reporting_the_window_closed_holds_without_retrying(
    service, dao, graph, records
):
    worker = _worker(service, records)
    _, space, thread = dao.seed_whatsapp()
    dao.customer_wrote(space)
    _answer(records, thread, "t1", "answer")
    graph.fail_next(131047)

    await _end(worker, thread, "t1")
    await _end(worker, thread, "t1")  # a redelivered turn_ended

    assert graph.sent == []
    [row] = dao.rows(ChannelDeliveryState.HELD)
    assert row.status.code == "window_closed"


async def test_a_held_reply_sends_the_reopen_template_once(
    service, dao, graph, records
):
    worker = _worker(service, records)
    _, space, thread = dao.seed_whatsapp(data={"reopen_template": "order_update"})
    dao.customer_wrote(space, ago=timedelta(days=2))
    paragraph = ("word " * 199).strip() + "."
    _answer(records, thread, "t1", "\n\n".join([paragraph] * 9))  # three parts

    await _end(worker, thread, "t1")

    templates = [m for m in graph.sent if m["type"] == "template"]
    assert len(templates) == 1
    assert templates[0]["template"]["name"] == "order_update"
    assert graph.texts_to(p.CUSTOMER) == []
    assert len(dao.rows(ChannelDeliveryState.HELD)) == 3


async def test_an_opted_out_customer_gets_no_template(service, dao, graph, records):
    worker = _worker(service, records)
    _, space, thread = dao.seed_whatsapp(data={"reopen_template": "order_update"})
    dao.spaces[space.id].flags.is_opted_out = True
    dao.customer_wrote(space, ago=timedelta(days=2))
    _answer(records, thread, "t1", "answer")

    await _end(worker, thread, "t1")

    assert graph.sent == []


async def test_held_replies_go_out_in_order_before_the_next_answer(
    service, dao, graph, records
):
    worker = _worker(service, records)
    _, space, thread = dao.seed_whatsapp()
    dao.customer_wrote(space, ago=timedelta(days=2))
    _answer(records, thread, "t1", "first answer")
    await _end(worker, thread, "t1")
    _answer(records, thread, "t2", "second answer")
    await _end(worker, thread, "t2")
    assert graph.sent == []

    # the customer writes again, which starts the next turn
    dao.customer_wrote(space, message_id="wamid.BACK")
    await _start(worker, thread, "t3")
    await worker.stop_progress("t3")
    _answer(records, thread, "t3", "third answer")
    await _end(worker, thread, "t3")

    assert graph.texts_to(p.CUSTOMER) == [
        "first answer",
        "second answer",
        "third answer",
    ]
    assert dao.rows(ChannelDeliveryState.HELD) == []


async def test_a_held_reply_whose_release_outcome_is_unknown_is_never_resent(
    service, dao, graph, records
):
    worker = _worker(service, records)
    _, space, thread = dao.seed_whatsapp()
    dao.customer_wrote(space, ago=timedelta(days=2))
    _answer(records, thread, "t1", "held answer")
    await _end(worker, thread, "t1")

    dao.customer_wrote(space, message_id="wamid.BACK")
    graph.fail_next(2)  # Meta answers 503: the outcome is unknown
    await _start(worker, thread, "t2")
    await worker.stop_progress("t2")
    await _start(worker, thread, "t2")  # a redelivered turn start
    await worker.stop_progress("t2")

    assert graph.texts_to(p.CUSTOMER) == []
    [row] = [r for r in dao.rows() if r.turn_id == "t1"]
    assert row.status.code == "delivery_uncertain"


async def test_the_window_counts_from_metas_timestamp_not_our_arrival_time(
    service, dao, graph, records
):
    """A webhook Meta retried for a day arrives now, but the customer wrote it
    25 hours ago: the window is closed."""

    worker = _worker(service, records)
    _, space, thread = dao.seed_whatsapp()
    dao.customer_wrote(space, sent_ago=timedelta(hours=25))
    _answer(records, thread, "t1", "late answer")

    await _end(worker, thread, "t1")

    assert graph.sent == []
    assert len(dao.rows(ChannelDeliveryState.HELD)) == 1


async def test_the_working_message_never_follows_an_answer_another_worker_sent(
    service, dao, graph, records
):
    starter = _worker(
        service, records, progress_interval_seconds=0.01, working_notice_seconds=0.2
    )
    ender = _worker(service, records)
    _, space, thread = dao.seed_whatsapp()
    dao.customer_wrote(space)

    await _start(starter, thread, "t1")
    _answer(records, thread, "t1", "quick answer")
    await _end(ender, thread, "t1")  # the end lands on another worker
    await asyncio.sleep(0.4)

    assert graph.texts_to(p.CUSTOMER) == ["quick answer"]
    assert "t1" not in starter._progress_tasks
