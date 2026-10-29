"""Unit tests for `read_agenta_conversation` -- the merge of the inbox log
and what the outbox posted back, in order. A stub `ChannelsService`, no DB.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request

from oss.src.apis.fastapi.channels.router import ChannelsRouter
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelDeliveryState,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEvent,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelOutboxEvent,
    ChannelOutboxEventData,
    ChannelSpace,
    ChannelSpaceData,
    ChannelSpaceKind,
    ChannelThread,
    ChannelThreadData,
)


def _make_request(project_id, user_id) -> Request:
    app = FastAPI()
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/channels/agenta/conversations/x",
        "headers": [],
        "app": app,
    }
    request = Request(scope)
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    return request


def _ts(offset_seconds: int) -> datetime:
    return datetime(2030, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=offset_seconds)


class StubChannelsService:
    def __init__(
        self,
        *,
        space,
        connection,
        inbox=None,
        threads=None,
        outbox_by_thread=None,
    ):
        self.space = space
        self.connection = connection
        self.inbox = inbox or []
        self.threads = threads or []
        self.outbox_by_thread = outbox_by_thread or {}

    async def fetch_space(self, *, project_id, space_id):
        return self.space if self.space and self.space.id == space_id else None

    async def fetch_connection(self, *, project_id, connection_id):
        if self.connection and self.connection.id == connection_id:
            return self.connection
        return None

    async def query_inbox_events(self, *, project_id, event=None, windowing=None):
        return self.inbox

    async def query_threads(self, *, project_id, thread=None, windowing=None):
        return self.threads

    async def query_outbox_events(self, *, project_id, event=None, windowing=None):
        return self.outbox_by_thread.get(event.thread_id, [])


def _connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(), slug="agenta", channel="agenta", external_key=uuid4()
    )


def _space(connection_id) -> ChannelSpace:
    return ChannelSpace(
        id=uuid4(),
        connection_id=connection_id,
        kind=ChannelSpaceKind.PRIVATE,
        external_key=uuid4(),
        data=ChannelSpaceData(external_locator={"user": "U1"}),
    )


def _inbox_event(space_id, connection_id, *, created_at, text) -> ChannelInboxEvent:
    return ChannelInboxEvent(
        id=uuid4(),
        connection_id=connection_id,
        external_id=str(uuid4()),
        kind=ChannelEventKind.MESSAGE,
        origin=ChannelEventOrigin.PUSHED,
        space_id=space_id,
        created_at=created_at,
        data=ChannelInboxEventData(
            external_locator={"user": "U1"},
            processed=ChannelInboxEventProcessed(
                content=[{"type": "text", "text": text}], sender={"id": "U1"}
            ),
        ),
    )


def _thread(space_id, agent_id) -> ChannelThread:
    return ChannelThread(
        id=uuid4(),
        space_id=space_id,
        agent_id=agent_id,
        session_id="s1",
        data=ChannelThreadData(),
    )


def _outbox_event(thread_id, *, created_at, text) -> ChannelOutboxEvent:
    return ChannelOutboxEvent(
        id=uuid4(),
        connection_id=uuid4(),
        thread_id=thread_id,
        turn_id="t1",
        key=uuid4(),
        state=ChannelDeliveryState.SENT,
        created_at=created_at,
        data=ChannelOutboxEventData(
            processed={"content": [{"type": "text", "text": text}]}
        ),
    )


@pytest.fixture
def patched_access():
    return patch(
        "oss.src.apis.fastapi.channels.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    )


async def test_returns_404_when_the_space_does_not_belong_to_an_agenta_connection(
    patched_access,
):
    connection = ChannelConnection(
        id=uuid4(), slug="slack", channel="slack", external_key=uuid4()
    )
    space = _space(connection.id)
    service = StubChannelsService(space=space, connection=connection)
    router = ChannelsRouter(channels_service=service, adapter_registry=AsyncMock())
    request = _make_request(uuid4(), uuid4())

    with patched_access:
        with pytest.raises(HTTPException) as exc_info:
            await router.read_agenta_conversation(request, id=space.id)

    assert exc_info.value.status_code == 404


async def test_returns_404_for_an_unknown_space(patched_access):
    service = StubChannelsService(space=None, connection=None)
    router = ChannelsRouter(channels_service=service, adapter_registry=AsyncMock())
    request = _make_request(uuid4(), uuid4())

    with patched_access:
        with pytest.raises(HTTPException) as exc_info:
            await router.read_agenta_conversation(request, id=uuid4())

    assert exc_info.value.status_code == 404


async def test_merges_inbox_and_outbox_in_chronological_order(patched_access):
    connection = _connection()
    space = _space(connection.id)
    thread = _thread(space.id, agent_id=uuid4())

    inbound = _inbox_event(space.id, connection.id, created_at=_ts(0), text="hello")
    outbound = _outbox_event(thread.id, created_at=_ts(1), text="hi there")
    second_inbound = _inbox_event(
        space.id, connection.id, created_at=_ts(2), text="thanks"
    )

    service = StubChannelsService(
        space=space,
        connection=connection,
        inbox=[inbound, second_inbound],
        threads=[thread],
        outbox_by_thread={thread.id: [outbound]},
    )
    router = ChannelsRouter(channels_service=service, adapter_registry=AsyncMock())
    request = _make_request(uuid4(), uuid4())

    with patched_access:
        response = await router.read_agenta_conversation(request, id=space.id)

    assert response.count == 3
    directions = [item.direction for item in response.items]
    contents = [item.content[0]["text"] for item in response.items]
    assert directions == ["inbound", "outbound", "inbound"]
    assert contents == ["hello", "hi there", "thanks"]
