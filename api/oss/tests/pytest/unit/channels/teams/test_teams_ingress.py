"""The Teams messaging route over HTTP, with the real TeamsAdapter and a
fake Microsoft key endpoint. The channels service is faked to its
ingress-facing surface; connections resolve through the real external-key
composition, as in production."""

from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.channels.ingress import ChannelsIngressRouter
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.teams.capabilities import (
    fetch_teams_capabilities,
)
from oss.src.core.channels.dtos import ChannelConnection, ChannelKeyGrain
from oss.src.core.channels.utils import compose_external_key

from . import fake_teams as f
from . import payloads as p


class FakeChannelsService:
    def __init__(self) -> None:
        self.project_id = uuid4()
        self.connections: dict[UUID, ChannelConnection] = {}
        self.recorded: list = []
        self._seen = set()

    def connect(self) -> ChannelConnection:
        connection = p.connection()
        connection.external_key = compose_external_key(
            fetch_teams_capabilities(),
            ChannelKeyGrain.CONNECTION,
            {"app_id": p.APP_ID},
        )
        self.connections[connection.id] = connection
        return connection

    async def get_project_and_connection_by_external_key(
        self, *, channel, external_key
    ):
        for connection in self.connections.values():
            if (
                connection.channel == channel
                and connection.external_key == external_key
            ):
                return self.project_id, connection.id
        return None

    async def fetch_connection(self, *, project_id, connection_id):
        return self.connections.get(connection_id)

    async def record_inbox_event(self, *, project_id, event):
        key = (event.connection_id, event.external_id)
        if key in self._seen:
            return None
        self._seen.add(key)
        self.recorded.append(event)
        return event


class FakeDispatch:
    def __init__(self) -> None:
        self.calls = []

    async def kiq(self, **kwargs):
        self.calls.append(kwargs)


@pytest.fixture
def service():
    return FakeChannelsService()


@pytest.fixture
def dispatch():
    return FakeDispatch()


@pytest.fixture
def client(service, dispatch):
    adapter = f.adapter_for(f.FakeMicrosoft())
    registry = ChannelAdapterRegistry(adapters={"teams": adapter})
    router = ChannelsIngressRouter(
        channels_service=service, adapter_registry=registry, dispatch_task=dispatch
    )
    app = FastAPI()
    app.include_router(router.router, prefix="/channels")
    app.include_router(router.router, prefix="/preview/channels")
    return TestClient(app)


def _post(client, activity, *, headers=None, path="/channels/teams/events/"):
    return client.post(
        path,
        content=p.encode(activity),
        headers={"content-type": "application/json", **(headers or {})},
    )


@pytest.mark.parametrize(
    "path", ["/channels/teams/events/", "/preview/channels/teams/events/"]
)
def test_a_signed_message_is_stored_and_answered_202(client, service, dispatch, path):
    service.connect()

    response = _post(client, p.message(text="hi"), headers=f.auth_headers(), path=path)

    assert response.status_code == 202
    assert response.json()["status"] == "accepted"
    assert len(service.recorded) == 1
    assert len(dispatch.calls) == 1


def test_a_second_delivery_of_one_activity_writes_one_row(client, service):
    service.connect()

    for _ in range(2):
        assert _post(client, p.message(), headers=f.auth_headers()).status_code == 202

    assert len(service.recorded) == 1


def test_an_unknown_bot_is_refused_as_a_bad_signature(client, service):
    response = _post(client, p.message(), headers=f.auth_headers())

    assert response.status_code == 401
    assert service.recorded == []


def test_a_request_without_a_token_is_refused(client, service):
    service.connect()

    response = _post(client, p.message())

    assert response.status_code == 401
    assert service.recorded == []


def test_a_foreign_tenant_is_accepted_and_not_stored(client, service):
    service.connect()

    response = _post(
        client, p.message(tenant_id=p.OTHER_TENANT_ID), headers=f.auth_headers()
    )

    assert response.status_code == 202
    assert service.recorded == []


def test_an_uninstall_is_accepted_and_not_stored(client, service):
    service.connect()

    response = _post(
        client,
        p.message(type="installationUpdate", action="remove"),
        headers=f.auth_headers(),
    )

    assert response.status_code == 202
    assert service.recorded == []
