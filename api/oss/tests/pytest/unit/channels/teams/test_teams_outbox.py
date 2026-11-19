"""The outbox driving the real TeamsAdapter over the fake Bot Framework
connector: typing instead of a "Thinking…" message, one working message on a
long turn, long answers as several messages in the thread, an approval card
whose buttons carry the choice token and lose them once it is answered, and
the error rules."""

import asyncio
from uuid import uuid4

import pytest
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelDeliveryState,
    ChannelSpace,
    ChannelSpaceData,
    ChannelSpaceKind,
)
from oss.src.core.channels.render.render import WORKING_TEXT
from oss.src.core.channels.service import ChannelsService

from ..test_channels_outbox_worker import PROJECT_ID, FakeRecordsDAO
from ..whatsapp.test_whatsapp_outbox import WhatsAppDAO, _answer, _end, _start, _worker
from . import fake_teams as f
from . import payloads as p

LOCATOR = {
    "tenant_id": p.TENANT_ID,
    "conversation_id": p.CHANNEL_CONVERSATION,
    "thread_id": "111",
    "service_url": p.SERVICE_URL,
    "message_id": "111",
    "title": "General",
}
THREAD_CONVERSATION = f"{p.CHANNEL_CONVERSATION};messageid=111"


class TeamsDAO(WhatsAppDAO):
    def seed_teams(self):
        connection = p.connection()
        self.connections[connection.id] = connection
        space = ChannelSpace(
            id=uuid4(),
            connection_id=connection.id,
            kind=ChannelSpaceKind.TOPIC,
            external_key=uuid4(),
            data=ChannelSpaceData(external_locator=LOCATOR),
        )
        self.spaces[space.id] = space
        thread = self.seed_thread(
            space_id=space.id, session_id=str(uuid4()), external_locator=LOCATOR
        )
        return connection, space, thread


@pytest.fixture
def fake():
    return f.FakeMicrosoft()


@pytest.fixture
def dao():
    return TeamsDAO()


@pytest.fixture
def records():
    return FakeRecordsDAO()


@pytest.fixture
def service(dao, fake):
    return ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(
            adapters={"teams": f.adapter_for(fake)}
        ),
    )


async def test_turn_start_shows_typing_and_posts_nothing(service, dao, fake, records):
    worker = _worker(service, records)
    _, _, thread = dao.seed_teams()

    await _start(worker, thread, "t1")
    await asyncio.sleep(0.05)
    await worker.stop_progress("t1")

    assert fake.sent() == []
    [typing, *_] = fake.sent("typing")
    assert typing["conversation"] == THREAD_CONVERSATION
    assert typing["body"]["channelData"] == {"tenant": {"id": p.TENANT_ID}}


async def test_a_short_turn_shows_only_the_answer_in_the_thread(
    service, dao, fake, records
):
    worker = _worker(service, records)
    _, _, thread = dao.seed_teams()

    await _start(worker, thread, "t1")
    _answer(records, thread, "t1", "It left **yesterday**.")
    await _end(worker, thread, "t1")

    assert fake.texts() == ["It left **yesterday**."]
    assert {c["conversation"] for c in fake.sent()} == {THREAD_CONVERSATION}


async def test_a_long_turn_gets_one_working_message_then_the_answer(
    service, dao, fake, records
):
    worker = _worker(
        service,
        records,
        progress_interval_seconds=0.01,
        activity_refresh_seconds=0.02,
        working_notice_seconds=0.05,
    )
    _, _, thread = dao.seed_teams()

    await _start(worker, thread, "t1")
    await asyncio.sleep(0.3)
    _answer(records, thread, "t1", "Here is the comparison.")
    await _end(worker, thread, "t1")

    assert fake.texts() == [WORKING_TEXT, "Here is the comparison."]
    assert len(fake.sent("typing")) >= 3  # refreshed while the turn ran
    assert len(fake.token_requests) == 1


async def test_a_failing_typing_signal_never_blocks_the_answer(
    service, dao, fake, records
):
    worker = _worker(service, records)
    _, _, thread = dao.seed_teams()
    fake.fail_next(500, code="ServiceError")

    await _start(worker, thread, "t1")
    await asyncio.sleep(0.05)
    _answer(records, thread, "t1", "answer")
    await _end(worker, thread, "t1")

    assert fake.texts() == ["answer"]


async def test_a_long_answer_goes_out_as_several_messages_in_order(
    service, dao, fake, records
):
    worker = _worker(service, records)
    _, _, thread = dao.seed_teams()
    paragraphs = [f"Part {i}. " + ("word " * 1000).strip() for i in range(9)]
    _answer(records, thread, "t1", "\n\n".join(paragraphs))

    await _end(worker, thread, "t1")

    parts = fake.texts()
    assert len(parts) >= 3
    assert all(len(part) <= 20000 for part in parts)
    assert parts[0].startswith("Part 0.")
    assert "Part 8." in parts[-1]
    assert {c["conversation"] for c in fake.sent()} == {THREAD_CONVERSATION}


async def test_an_approval_card_carries_the_choice_token_and_is_dismissed(
    service, dao, fake, records
):
    worker = _worker(service, records)
    connection, _, thread = dao.seed_teams()
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

    [posted] = [c for c in fake.sent() if c["body"].get("attachments")]
    card = posted["body"]["attachments"][0]["content"]
    pending = dao.threads[thread.id].data.pending_choice
    assert [a["data"] for a in card["actions"]] == [
        {"choice_token": f"{pending.interaction_id}:approve", "thread_id": "111"},
        {"choice_token": f"{pending.interaction_id}:deny", "thread_id": "111"},
    ]
    assert "4411" in card["body"][-1]["text"]

    await service.dismiss_approval_choices(
        project_id=PROJECT_ID,
        connection_id=connection.id,
        thread=dao.threads[thread.id],
        interaction_id=pending.interaction_id,
    )

    [update] = fake.updates()
    assert update["activity_id"] == posted["response"]["id"]
    assert "actions" not in update["body"]["attachments"][0]["content"]
    assert update["body"]["channelData"] == {"tenant": {"id": p.TENANT_ID}}


async def test_a_removed_app_fails_the_reply_without_retry_or_deactivation(
    service, dao, fake, records
):
    worker = _worker(service, records)
    connection, _, thread = dao.seed_teams()
    _answer(records, thread, "t1", "answer")
    fake.fail_next(403, code="Forbidden", sub_code="MessageWritesBlocked")

    await _end(worker, thread, "t1")  # acknowledged, not raised
    await _end(worker, thread, "t1")  # the duplicate turn_ended: not resent

    assert fake.texts() == []
    [row] = dao.rows()
    assert row.state is ChannelDeliveryState.FAILED
    assert row.status.code == "delivery_refused"
    assert dao.connections[connection.id].flags.is_active is not False


async def test_a_rate_limit_is_retried_by_the_stream(service, dao, fake, records):
    worker = _worker(service, records)
    _, _, thread = dao.seed_teams()
    _answer(records, thread, "t1", "answer")
    fake.fail_next(429, code="TooManyRequests")

    with pytest.raises(Exception):
        await _end(worker, thread, "t1")
    await _end(worker, thread, "t1")  # the stream redelivers it

    assert fake.texts() == ["answer"]


async def test_a_server_error_on_a_post_is_not_retried(service, dao, fake, records):
    worker = _worker(service, records)
    _, _, thread = dao.seed_teams()
    _answer(records, thread, "t1", "answer")
    fake.fail_next(502, code="BadGateway")

    await _end(worker, thread, "t1")
    await _end(worker, thread, "t1")

    [row] = dao.rows()
    assert row.state is ChannelDeliveryState.FAILED
    assert row.status.code == "delivery_uncertain"
    assert len([c for c in fake.calls if c["body"].get("type") == "message"]) == 1


async def test_an_expired_token_is_refreshed_and_the_answer_lands_once(
    service, dao, fake, records
):
    worker = _worker(service, records)
    _, _, thread = dao.seed_teams()
    _answer(records, thread, "t1", "answer")
    fake.fail_next(401, code="Unauthorized")

    await _end(worker, thread, "t1")

    assert fake.texts() == ["answer"]
    assert len(fake.token_requests) == 2


async def test_a_rejected_secret_switches_the_connection_off(
    service, dao, fake, records
):
    worker = _worker(service, records)
    connection, _, thread = dao.seed_teams()
    _answer(records, thread, "t1", "answer")
    fake.refuse_token(status=401, error="invalid_client", code=7000222)

    await _end(worker, thread, "t1")

    [row] = dao.rows()
    assert row.status.code == "credential_revoked"
    assert dao.connections[connection.id].flags.is_active is False
