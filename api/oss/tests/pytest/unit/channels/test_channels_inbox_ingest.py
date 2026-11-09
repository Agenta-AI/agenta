"""The shared store-and-enqueue step, `ChannelsService.record_and_enqueue_inbox_event`,
and the cross-project read the Discord socket loop opens sockets from,
`query_active_connections`. The HTTP side of the same step is covered by the
ingress tests, which run this method over their fake services."""

import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from oss.src.core.channels import service as service_module
from oss.src.core.channels.dtos import (
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboundEvent,
    ChannelInboxEventProcessed,
    ChannelSpaceKind,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelInboxEnqueueFailed
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.channels.dbes import ChannelConnectionDBE

pytestmark = pytest.mark.asyncio


class _FakeDAO:
    def __init__(self):
        self.recorded = []
        self.seen = set()

    async def record_inbox_event(self, *, project_id, event):
        key = (project_id, event.connection_id, event.external_id)
        if key in self.seen:
            return None
        self.seen.add(key)
        self.recorded.append(event)
        return event


class _Dispatch:
    def __init__(self, *, fail=False, delay=0.0):
        self.calls = []
        self.fail = fail
        self.delay = delay

    async def kiq(self, **kwargs):
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise ConnectionError("redis down")
        self.calls.append(kwargs)


def _service(dispatch=None):
    service = ChannelsService(channels_dao=_FakeDAO(), adapter_registry=None)
    service.inbox_dispatch_task = dispatch
    return service


def _inbound(external_id="m1", origin=ChannelEventOrigin.PUSHED):
    return ChannelInboundEvent(
        external_id=external_id,
        kind=ChannelEventKind.MESSAGE,
        origin=origin,
        space_kind=ChannelSpaceKind.TOPIC,
        external_locator={"channel_id": "C1"},
        processed=ChannelInboxEventProcessed(
            content=[{"type": "text", "text": "hi"}], sender={"id": "U1"}
        ),
        addressed=True,
    )


async def _store(service, inbound, *, project_id, connection_id):
    await service.record_and_enqueue_inbox_event(
        project_id=project_id,
        connection_id=connection_id,
        channel="discord",
        inbound=inbound,
    )


async def test_new_event_stores_one_row_and_enqueues_one_dispatch():
    dispatch = _Dispatch()
    service = _service(dispatch)
    project_id, connection_id = uuid4(), uuid4()

    await _store(
        service, _inbound(), project_id=project_id, connection_id=connection_id
    )

    [row] = service.channels_dao.recorded
    assert row.external_id == "m1"
    assert row.origin == ChannelEventOrigin.PUSHED
    assert row.data.addressed is True
    assert row.data.external_locator == {"channel_id": "C1"}
    assert dispatch.calls == [
        {
            "project_id": str(project_id),
            "connection_id": str(connection_id),
            "channel": "discord",
            "external_id": "m1",
        }
    ]


async def test_existing_row_still_enqueues():
    dispatch = _Dispatch()
    service = _service(dispatch)
    project_id, connection_id = uuid4(), uuid4()

    for _ in range(2):
        await _store(
            service, _inbound(), project_id=project_id, connection_id=connection_id
        )

    assert len(service.channels_dao.recorded) == 1
    assert len(dispatch.calls) == 2


async def test_failed_enqueue_raises_the_domain_exception_and_keeps_the_row():
    service = _service(_Dispatch(fail=True))

    with pytest.raises(ChannelInboxEnqueueFailed) as raised:
        await _store(service, _inbound(), project_id=uuid4(), connection_id=uuid4())

    assert raised.value.channel == "discord"
    assert raised.value.external_id == "m1"
    assert len(service.channels_dao.recorded) == 1


async def test_enqueue_timeout_raises_the_domain_exception(monkeypatch):
    monkeypatch.setattr(service_module, "_ENQUEUE_TIMEOUT_SECONDS", 0.01)
    service = _service(_Dispatch(delay=1.0))

    with pytest.raises(ChannelInboxEnqueueFailed):
        await _store(service, _inbound(), project_id=uuid4(), connection_id=uuid4())


async def test_no_dispatch_task_stores_only():
    service = _service(None)

    await _store(service, _inbound(), project_id=uuid4(), connection_id=uuid4())

    assert len(service.channels_dao.recorded) == 1


# --- query_active_connections ------------------------------------------------ #


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows


class _Session:
    def __init__(self, rows):
        self.rows = rows
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _Result(self.rows)


class _Engine:
    def __init__(self, rows):
        self.captured = _Session(rows)

    @asynccontextmanager
    async def session(self):
        yield self.captured


async def test_query_active_connections_filters_active_verified_not_archived():
    engine = _Engine([])
    dao = ChannelsDAO(engine=engine)

    await dao.query_active_connections(channel="discord")

    statement = engine.captured.statements[0]
    sql = str(statement.compile(dialect=postgresql.dialect()))
    params = statement.compile(dialect=postgresql.dialect()).params
    assert "channel_connections.channel =" in sql
    assert "channel_connections.flags @>" in sql
    assert "channel_connections.deleted_at IS NULL" in sql
    # Cross-project: no project filter.
    assert "channel_connections.project_id =" not in sql
    assert "discord" in params.values()
    assert {"is_active": True, "is_verified": True} in params.values()


async def test_query_active_connections_returns_project_id_first():
    project_id = uuid4()
    dbe = ChannelConnectionDBE(
        id=uuid4(),
        project_id=project_id,
        channel="discord",
        external_key=uuid4(),
        slug="discord-bot",
        flags={"is_active": True, "is_verified": True, "is_hosted": False},
        data={},
    )
    dao = ChannelsDAO(engine=_Engine([dbe]))
    service = ChannelsService(channels_dao=dao, adapter_registry=None)

    [(found_project_id, connection)] = await service.query_active_connections(
        channel="discord"
    )

    assert found_project_id == project_id
    assert connection.id == dbe.id
    assert connection.channel == "discord"
