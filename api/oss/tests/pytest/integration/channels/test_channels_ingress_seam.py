"""The full seam: an HTTP request through the real router, service and DAO, into
a real table.

`unit/channels/test_channels_ingress.py` proves the same three behaviours against
a `FakeChannelsService` holding an in-memory list, which is right for the ingress
route in isolation. But a signed request must write *exactly one
`channel_inbox_events` row* — a claim about a table, not a list. Only the adapter
is faked here (it stands for the platform, which we cannot call), and it is the
one seam this file is not testing.

Writing it found a real defect the fakes hid: the ingress route called
`get_project_and_connection_by_external_id` and `record_inbox_event`, while the
service declared `verify_signature` and `record_event` — two mismatched
vocabularies, both green in isolation.
"""

from typing import Dict, Optional
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import text

from oss.src.apis.fastapi.channels.ingress import ChannelsIngressRouter
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelEventKind,
    ChannelIdentity,
    ChannelInboundEvent,
    ChannelInboxEventProcessed,
    ChannelKeyGrain,
    ChannelRequestContext,
    ChannelSpaceKind,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelNotSupported, ChannelSignatureInvalid
from oss.src.core.channels.utils import compose_external_key
from oss.src.dbs.postgres.channels.dao import ChannelsDAO

pytestmark = pytest.mark.integration

_LOCATOR = {"team": "T1", "channel": "C1"}


def _fake_capabilities() -> ChannelCapabilities:
    return ChannelCapabilities(
        channel="slack",
        identity=ChannelIdentity(
            keys={ChannelKeyGrain.CONNECTION: ["installation_id"]}
        ),
    )


class _FakeSlackAdapter:
    """The platform boundary, and the only fake here. Verifies a fixed header
    and parses a fixed event; everything downstream is real."""

    channel = "slack"

    def __init__(self, *, installation_id: str, external_id: str = "Ev1"):
        self.installation_id = installation_id
        self.external_id = external_id

    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        return _fake_capabilities()

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, str]]:
        return {"installation_id": self.installation_id}

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        if request.headers.get("x-fake-signature") != "valid":
            raise ChannelSignatureInvalid(channel=self.channel)
        return self.installation_id

    async def parse_event(
        self, *, body: bytes, connection: Optional[ChannelConnection] = None
    ) -> Optional[ChannelInboundEvent]:
        return ChannelInboundEvent(
            external_id=self.external_id,
            kind=ChannelEventKind.MESSAGE,
            space_kind=ChannelSpaceKind.TOPIC,
            external_locator=_LOCATOR,
            processed=ChannelInboxEventProcessed(
                content=[{"type": "text", "text": "hi"}],
                sender={"id": "U1"},
            ),
        )


class _Registry:
    def __init__(self, adapters):
        self._adapters = adapters

    def get(self, channel: str):
        if channel not in self._adapters:
            raise ChannelNotSupported(channel=channel)
        return self._adapters[channel]


async def _row_count(engine, project_id: UUID, external_id: str) -> int:
    async with engine.session() as session:
        result = await session.execute(
            text(
                "SELECT count(*) FROM channel_inbox_events "
                "WHERE project_id = :project_id AND external_id = :external_id"
            ),
            {"project_id": project_id, "external_id": external_id},
        )
        return result.scalar_one()


@pytest.fixture
async def seam(channels_scope):
    """The real stack, wired the way entrypoints/routers.py wires it."""

    engine = channels_scope["engine"]
    project_id = channels_scope["project_id"]

    # installation id = the team the connection was created for; event id is the
    # message's own, which is what the ledger dedups on
    adapter = _FakeSlackAdapter(
        installation_id=channels_scope["external_id"],
        external_id="Ev1",
    )
    registry = _Registry({"slack": adapter})

    dao = ChannelsDAO(engine=engine)
    external_key = compose_external_key(
        _fake_capabilities(),
        ChannelKeyGrain.CONNECTION,
        {"installation_id": channels_scope["external_id"]},
    )
    await dao.create_connection(
        project_id=project_id,
        user_id=channels_scope["user_id"],
        connection=ChannelConnectionCreate(
            channel="slack",
            external_key=external_key,
            slug="seam-connection",
            data={
                "connection_locator": {
                    "installation_id": channels_scope["external_id"],
                },
            },
        ),
    )

    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=registry,
    )

    app = FastAPI()
    app.include_router(
        ChannelsIngressRouter(
            channels_service=service,
            adapter_registry=registry,
            dispatch_task=None,
        ).router,
        prefix="/channels",
    )

    # httpx + ASGITransport, not TestClient: TestClient drives the app on its own
    # event loop, and the fixture's async engine belongs to this one ("attached
    # to a different loop").
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        yield {
            "client": client,
            "engine": engine,
            "project_id": project_id,
            "event_id": adapter.external_id,
        }


async def test_signed_request_writes_exactly_one_row_and_acks_202(seam):
    response = await seam["client"].post(
        "/channels/slack/events/",
        headers={"x-fake-signature": "valid"},
        content=b"{}",
    )

    assert response.status_code == 202, response.text
    assert response.json()["status"] == "accepted"
    assert await _row_count(seam["engine"], seam["project_id"], seam["event_id"]) == 1


async def test_unsigned_request_is_rejected_and_writes_nothing(seam):
    response = await seam["client"].post("/channels/slack/events/", content=b"{}")

    assert response.status_code == 401
    assert await _row_count(seam["engine"], seam["project_id"], seam["event_id"]) == 0


async def test_redelivery_writes_no_second_row(seam):
    for _ in range(3):
        response = await seam["client"].post(
            "/channels/slack/events/",
            headers={"x-fake-signature": "valid"},
            content=b"{}",
        )
        assert response.status_code == 202, response.text

    # the platform retries; the ledger's unique constraint is what absorbs it
    assert await _row_count(seam["engine"], seam["project_id"], seam["event_id"]) == 1
