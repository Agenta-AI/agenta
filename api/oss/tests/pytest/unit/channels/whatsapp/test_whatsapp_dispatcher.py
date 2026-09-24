"""The inbox dispatcher's WhatsApp paths: STOP and START, the one fixed reply
to a voice note, and passing images
and documents to the agent as session attachments. The channels service is
stubbed like the rest of the dispatcher suite; the adapter is the real one
over the fake Graph API, so replies are asserted on what Meta received."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import uuid_utils.compat as uuid_utils
import pytest
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.whatsapp.adapter import WhatsAppAdapter
from oss.src.core.channels.adapters.whatsapp.capabilities import (
    fetch_whatsapp_capabilities,
)
from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentData,
    ChannelEffectivePolicy,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEvent,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelInboxTrigger,
    ChannelResolution,
    ChannelSessionScope,
    ChannelTriggerState,
    ChannelTurnInput,
)
from oss.src.core.channels.render.render import (
    OPTED_IN_TEXT,
    OPTED_OUT_TEXT,
    UNSUPPORTED_TEXT,
)
from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher

from . import payloads as p
from .fake_graph import FakeGraph
from .test_whatsapp_outbox import WhatsAppDAO

PROJECT_ID = uuid4()


@pytest.fixture
def graph():
    fake = FakeGraph()
    fake.add_number(phone_number_id=p.PHONE_NUMBER_ID, token=p.ACCESS_TOKEN)
    return fake


@pytest.fixture
def dao():
    return WhatsAppDAO()


@pytest.fixture
def world(dao, graph):
    connection, space, thread = dao.seed_whatsapp()
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=graph.app),
        base_url="https://graph.facebook.com/v24.0",
    )
    registry = ChannelAdapterRegistry(
        adapters={"whatsapp": WhatsAppAdapter(http_client=client)}
    )
    agent = ChannelAgent(
        id=thread.agent_id,
        slug="support",
        connection_id=connection.id,
        created_by_id=uuid4(),
        data=ChannelAgentData(references={"workflow_revision": {"id": str(uuid4())}}),
    )
    resolution = ChannelResolution(
        space=space,
        agent=agent,
        thread=thread,
        policy=ChannelEffectivePolicy(
            triggers=set(),
            session_scope=ChannelSessionScope.THREAD,
            backfill=False,
            forwardfill=True,
            decided_by={},
        ),
    )
    service = MagicMock()
    service.channels_dao = dao
    service.adapter_registry = registry
    service.resolve = AsyncMock(return_value=resolution)
    service.fetch_connection = AsyncMock(return_value=connection)
    service.fetch_capabilities = AsyncMock(return_value=fetch_whatsapp_capabilities())
    service.open_turn = AsyncMock(
        return_value=ChannelInboxTrigger(
            id=uuid4(),
            thread_id=thread.id,
            event_id=uuid4(),
            turn_id="t",
            state=ChannelTriggerState.STARTED,
        )
    )
    service.settle_turn = AsyncMock()
    return SimpleNamespace(
        service=service, connection=connection, space=space, thread=thread
    )


def _event(content, kind=ChannelEventKind.MESSAGE, sent_at=None):
    return ChannelInboxEvent(
        # time-ordered, like the inbox's own ids and arrival times
        id=uuid_utils.uuid7(),
        created_at=datetime.now(timezone.utc),
        connection_id=uuid4(),
        external_id=f"wamid.{uuid4().hex[:6]}",
        kind=kind,
        origin=ChannelEventOrigin.PUSHED,
        data=ChannelInboxEventData(
            external_locator={"wa_id": p.CUSTOMER},
            processed=ChannelInboxEventProcessed(content=content, sender={}),
            sent_at=sent_at,
        ),
    )


def _text(text, sent_at=None):
    return _event([{"type": "text", "text": text}], sent_at=sent_at)


async def _dispatch(world, event, *, attachments=None):
    world.service.compose_input = AsyncMock(
        return_value=ChannelTurnInput(content=list(event.data.processed.content))
    )
    invoke = AsyncMock()
    dispatcher = InboxDispatcher(
        channels_service=world.service,
        invoke_fn=invoke,
        attachments_service=attachments,
    )
    await dispatcher.dispatch_event(
        project_id=PROJECT_ID, connection_id=world.connection.id, event=event
    )
    return invoke


# --- STOP and START ------------------------------------------------------ #


@pytest.mark.parametrize("word", ["STOP", "stop ", "Unsubscribe"])
async def test_stop_opts_out_and_confirms_once(world, graph, word):
    invoke = await _dispatch(world, _text(word))

    assert world.space.flags.is_opted_out is True
    assert graph.texts_to(p.CUSTOMER) == [OPTED_OUT_TEXT]
    invoke.assert_not_called()


async def test_an_opted_out_customer_is_not_answered(world, graph):
    world.space.flags.is_opted_out = True

    invoke = await _dispatch(world, _text("Hello? Where is my order?"))

    invoke.assert_not_called()
    assert graph.sent == []


async def test_stop_again_while_opted_out_sends_nothing(world, graph):
    world.space.flags.is_opted_out = True

    await _dispatch(world, _text("STOP"))

    assert graph.sent == []


async def test_start_opts_back_in(world, graph):
    world.space.flags.is_opted_out = True

    invoke = await _dispatch(world, _text("START"))

    assert world.space.flags.is_opted_out is False
    assert graph.texts_to(p.CUSTOMER) == [OPTED_IN_TEXT]
    invoke.assert_not_called()

    invoke = await _dispatch(world, _text("Where is my order?"))
    invoke.assert_called_once()


async def test_start_from_a_customer_who_never_opted_out_is_a_normal_message(world):
    invoke = await _dispatch(world, _text("START"))
    invoke.assert_called_once()


async def test_a_replayed_start_cannot_undo_a_later_stop(world, graph):
    stop, start, stop_again = _text("STOP"), _text("START"), _text("STOP")

    for event in (stop, start, stop_again):
        await _dispatch(world, event)
    invoke = await _dispatch(world, start)  # Meta redelivers the old START

    assert world.space.flags.is_opted_out is True
    invoke.assert_not_called()


async def test_stop_and_start_apply_in_the_order_the_customer_sent_them(world, graph):
    """Sent STOP, START, STOP; dispatched STOP, STOP, START. The customer's
    last word was STOP."""

    stop, start, stop_again = _text("STOP"), _text("START"), _text("STOP")

    for event in (stop, stop_again, start):
        await _dispatch(world, event)

    assert world.space.flags.is_opted_out is True
    assert graph.texts_to(p.CUSTOMER) == [OPTED_OUT_TEXT]


async def test_a_start_sent_before_a_stop_but_stored_after_it_does_not_win(
    world, graph
):
    """Meta retried the START and it reached us after the STOP: the
    customer's own clock decides."""

    from datetime import timedelta

    now = datetime.now(timezone.utc)
    stop = _text("STOP", sent_at=now)
    late_start = _text("START", sent_at=now - timedelta(minutes=1))

    await _dispatch(world, stop)
    invoke = await _dispatch(world, late_start)

    assert world.space.flags.is_opted_out is True
    invoke.assert_not_called()


async def test_stop_inside_a_sentence_is_a_normal_message(world, graph):
    invoke = await _dispatch(world, _text("please stop the order"))

    invoke.assert_called_once()
    assert world.space.flags.is_opted_out is False


# --- unsupported messages ------------------------------------------------ #


async def test_a_voice_note_gets_one_fixed_reply_and_no_turn(world, graph):
    event = _event([{"type": "text", "text": "[voice note]", "unsupported": True}])

    invoke = await _dispatch(world, event)
    await _dispatch(world, event)  # a redelivered task

    invoke.assert_not_called()
    assert graph.texts_to(p.CUSTOMER) == [UNSUPPORTED_TEXT]


# --- images and documents ------------------------------------------------ #


class FakeAttachments:
    def __init__(self):
        self.created = []
        self.referenced = []

    async def create_attachment(self, **kwargs):
        self.created.append(kwargs)
        return SimpleNamespace(
            id=uuid4(),
            filename=kwargs["filename"],
            media_type=kwargs["declared_media_type"],
            size=len(kwargs["data"]),
        )

    async def reference_attachments(self, *, project_id, session_id, attachment_ids):
        self.referenced.extend(attachment_ids)
        return []


def _media_event(**part):
    return _event(
        [
            {"type": "text", "text": "Here is my invoice"},
            {"type": "media", "kind": "document", "media_id": "DOC1", **part},
        ]
    )


async def test_a_document_reaches_the_agent_as_a_session_attachment(world, graph):
    graph.add_media(
        media_id="DOC1",
        data=b"%PDF-1.4",
        mime_type="application/pdf",
        token=p.ACCESS_TOKEN,
    )
    attachments = FakeAttachments()

    invoke = await _dispatch(
        world,
        _media_event(mime_type="application/pdf", filename="invoice.pdf"),
        attachments=attachments,
    )

    [created] = attachments.created
    assert created["session_id"] == world.thread.session_id
    assert created["data"] == b"%PDF-1.4"
    assert created["filename"] == "invoice.pdf"
    content = invoke.call_args.kwargs["turn_input"].content
    assert content[0] == {"type": "text", "text": "Here is my invoice"}
    assert content[1]["type"] == "attachment"
    assert content[1]["attachmentId"] in {str(i) for i in attachments.referenced}
    assert content[1]["mimeType"] == "application/pdf"


async def test_media_that_cannot_be_fetched_becomes_a_short_note(world, graph):
    invoke = await _dispatch(world, _media_event(), attachments=FakeAttachments())

    content = invoke.call_args.kwargs["turn_input"].content
    assert content[1]["type"] == "text"
    assert "could not be read" in content[1]["text"]


async def test_media_without_an_attachment_store_becomes_a_short_note(world, graph):
    invoke = await _dispatch(world, _media_event())

    content = invoke.call_args.kwargs["turn_input"].content
    assert content[1]["type"] == "text"
    assert "[document]" in content[1]["text"]
