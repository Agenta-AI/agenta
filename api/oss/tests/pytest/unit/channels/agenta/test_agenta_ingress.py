"""AgentaAdapter through the real, shared `_ingest` -- no DB. Only
`ChannelsService` is faked here, to an in-memory list, exactly like
`unit/channels/test_channels_ingress.py` does for slack/bridge.

This is the seam that proves seam 1 of the design (`verify_signature` must
return a value the connection's own recorded locator carries, not the
composed `external_key`): a real project mismatch is refused here through
`_connection_owns_identity`, not through anything AgentaAdapter checks
itself.
"""

import json
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.channels.ingress import ChannelsIngressRouter
from oss.src.core.channels.adapters.agenta.adapter import AgentaAdapter
from oss.src.core.channels.adapters.agenta.capabilities import (
    fetch_agenta_capabilities,
)
from oss.src.core.channels.dtos import ChannelConnection, ChannelKeyGrain
from oss.src.core.channels.types import ChannelNotSupported
from oss.src.core.channels.utils import compose_external_key

GOOD_KEY = "prefix.goodkey"
FOREIGN_KEY = "prefix.foreignkey"

GOOD_PROJECT_ID = uuid4()
FOREIGN_PROJECT_ID = uuid4()


class FakeChannelsDAO:
    async def query_spaces(self, *, project_id, space=None, windowing=None):
        return []


class FakeAdapterRegistry:
    def __init__(self, adapters):
        self._adapters = adapters

    def get(self, channel):
        if channel not in self._adapters:
            raise ChannelNotSupported(channel=channel)
        return self._adapters[channel]


class FakeChannelsService:
    """The connection's own project ("bot" "support") vs. a foreign one --
    same shape as test_channels_ingress.py's fake, scoped to agenta's own
    locator fields."""

    def __init__(self, *, project_id: UUID, connection_id: UUID):
        self.project_id = project_id
        self.connection_id = connection_id
        self.recorded = []
        self.seen = set()

        self._external_key = compose_external_key(
            fetch_agenta_capabilities(),
            ChannelKeyGrain.CONNECTION,
            {"project": str(project_id), "bot": "support"},
        )
        self.connection = ChannelConnection(
            id=connection_id,
            slug="agenta-connection",
            channel="agenta",
            external_key=self._external_key,
            data={"connection_locator": {"project": str(project_id), "bot": "support"}},
        )

    async def get_project_and_connection_by_external_key(
        self, *, channel, external_key
    ):
        if external_key != self._external_key:
            return None
        return (self.project_id, self.connection_id)

    async def fetch_connection(self, *, project_id, connection_id):
        if connection_id != self.connection_id:
            return None
        return self.connection

    async def record_inbox_event(self, *, project_id, event):
        key = (project_id, event.connection_id, event.external_id)
        if key in self.seen:
            return None
        self.seen.add(key)
        self.recorded.append(event)
        return event


async def _resolve_project(raw_key: str):
    return {
        GOOD_KEY: str(GOOD_PROJECT_ID),
        FOREIGN_KEY: str(FOREIGN_PROJECT_ID),
    }.get(raw_key)


@pytest.fixture
def service() -> FakeChannelsService:
    return FakeChannelsService(project_id=GOOD_PROJECT_ID, connection_id=uuid4())


@pytest.fixture
def client(service) -> TestClient:
    adapter = AgentaAdapter(
        channels_dao=FakeChannelsDAO(), resolve_project=_resolve_project
    )
    registry = FakeAdapterRegistry({"agenta": adapter})
    router = ChannelsIngressRouter(channels_service=service, adapter_registry=registry)
    app = FastAPI()
    app.include_router(router.router, prefix="/channels")
    return TestClient(app)


def _body(**overrides):
    payload = {
        "project": str(GOOD_PROJECT_ID),
        "bot": "support",
        "user": "U1",
        "text": "hi",
    }
    payload.update(overrides)
    return json.dumps(payload).encode()


def test_signed_post_writes_one_row_and_acks_202(client, service):
    response = client.post(
        "/channels/agenta/events/",
        headers={"Authorization": f"ApiKey {GOOD_KEY}"},
        content=_body(),
    )

    assert response.status_code == 202, response.text
    assert len(service.recorded) == 1


def test_redelivery_writes_no_second_row(client, service):
    for _ in range(3):
        response = client.post(
            "/channels/agenta/events/",
            headers={"Authorization": f"ApiKey {GOOD_KEY}"},
            content=_body(id="fixed-id"),
        )
        assert response.status_code == 202, response.text

    assert len(service.recorded) == 1


# --------------------------------------------------------------------------- #
# The three refusal causes -- same status, same body, no distinguishing
# detail between them.
# --------------------------------------------------------------------------- #


def test_missing_key_is_refused(client, service):
    response = client.post("/channels/agenta/events/", content=_body())

    assert response.status_code == 401, response.text
    assert service.recorded == []


def test_bad_key_is_refused(client, service):
    response = client.post(
        "/channels/agenta/events/",
        headers={"Authorization": "ApiKey nope.nope"},
        content=_body(),
    )

    assert response.status_code == 401, response.text
    assert service.recorded == []


def test_a_key_from_another_project_is_refused(client, service):
    """A structurally valid, resolvable API key -- just not this
    connection's project. Refused by `_connection_owns_identity`, not by
    AgentaAdapter itself."""

    response = client.post(
        "/channels/agenta/events/",
        headers={"Authorization": f"ApiKey {FOREIGN_KEY}"},
        content=_body(),
    )

    assert response.status_code == 401, response.text
    assert service.recorded == []


def test_the_three_refusals_are_identical_bodies():
    bodies = set()
    statuses = set()

    for headers in (
        {},
        {"Authorization": "ApiKey nope.nope"},
        {"Authorization": f"ApiKey {FOREIGN_KEY}"},
    ):
        service = FakeChannelsService(project_id=GOOD_PROJECT_ID, connection_id=uuid4())
        adapter = AgentaAdapter(
            channels_dao=FakeChannelsDAO(), resolve_project=_resolve_project
        )
        registry = FakeAdapterRegistry({"agenta": adapter})
        app = FastAPI()
        app.include_router(
            ChannelsIngressRouter(
                channels_service=service, adapter_registry=registry
            ).router,
            prefix="/channels",
        )
        client = TestClient(app)

        response = client.post(
            "/channels/agenta/events/", headers=headers, content=_body()
        )
        statuses.add(response.status_code)
        bodies.add(response.text)

    assert statuses == {401}
    assert len(bodies) == 1


def test_a_wrong_bot_claim_finds_no_connection_and_is_refused(client, service):
    """The locator claim only selects a candidate; a bot name this project
    never registered resolves to nothing, refused before verify_signature
    even runs."""

    response = client.post(
        "/channels/agenta/events/",
        headers={"Authorization": f"ApiKey {GOOD_KEY}"},
        content=_body(bot="no-such-bot"),
    )

    assert response.status_code == 401, response.text
    assert service.recorded == []
