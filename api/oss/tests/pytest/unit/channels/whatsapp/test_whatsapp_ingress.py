"""The two WhatsApp ingress routes over HTTP, with the real WhatsAppAdapter:
the GET verify handshake and the signed POST. The channels service is faked
to its ingress-facing surface; connections resolve through the real
external-key composition, as in production."""

from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from oss.src.apis.fastapi.channels.ingress import ChannelsIngressRouter
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.whatsapp.adapter import WhatsAppAdapter
from oss.src.core.channels.adapters.whatsapp.capabilities import (
    fetch_whatsapp_capabilities,
)
from oss.src.core.channels.dtos import ChannelConnection, ChannelKeyGrain
from oss.src.core.channels.utils import compose_external_key

from . import payloads as p

VERIFY_TOKEN = f"{p.PHONE_NUMBER_ID}.s3cret-verify-token"


def _key(phone_number_id: str) -> UUID:
    return compose_external_key(
        fetch_whatsapp_capabilities(),
        ChannelKeyGrain.CONNECTION,
        {"phone_number_id": phone_number_id},
    )


class FakeChannelsService:
    def __init__(self) -> None:
        self.project_id = uuid4()
        self.connections: dict[UUID, ChannelConnection] = {}
        self.recorded: list = []
        self._seen = set()

    def connect(self, phone_number_id: str, app_secret: str = p.APP_SECRET):
        connection = ChannelConnection(
            id=uuid4(),
            slug=f"whatsapp-{phone_number_id}",
            channel="whatsapp",
            external_key=_key(phone_number_id),
            data={
                "connection_locator": {"phone_number_id": phone_number_id},
                "webhook_verify_token": VERIFY_TOKEN,
                "access_token": p.ACCESS_TOKEN,
                "app_secret": app_secret,
            },
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
    registry = ChannelAdapterRegistry(adapters={"whatsapp": WhatsAppAdapter()})
    router = ChannelsIngressRouter(
        channels_service=service, adapter_registry=registry, dispatch_task=dispatch
    )
    app = FastAPI()
    app.include_router(router.router, prefix="/channels")
    return TestClient(app)


def _verify(client, **overrides):
    params = {
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "1158201444",
        **overrides,
    }
    return client.get("/channels/whatsapp/events/", params=params)


def _post(client, payload, *, secret=p.APP_SECRET, signature=None):
    raw = p.encode(payload)
    headers = {"content-type": "application/json"}
    signature = p.sign(raw, secret) if signature is None else signature
    if signature:
        headers["x-hub-signature-256"] = signature
    return client.post("/channels/whatsapp/events/", content=raw, headers=headers)


# --- GET verify handshake ------------------------------------------------ #


def test_verify_handshake_echoes_the_challenge_as_plain_text(client, service):
    service.connect(p.PHONE_NUMBER_ID)

    response = _verify(client)

    assert response.status_code == 200
    assert response.text == "1158201444"
    assert response.headers["content-type"].startswith("text/plain")


@pytest.mark.parametrize(
    "overrides",
    [
        {"hub.verify_token": f"{p.PHONE_NUMBER_ID}.wrong"},
        {"hub.verify_token": "999.s3cret-verify-token"},
        {"hub.verify_token": "garbage"},
        {"hub.mode": "unsubscribe"},
    ],
)
def test_verify_handshake_with_an_unknown_token_is_refused(client, service, overrides):
    service.connect(p.PHONE_NUMBER_ID)

    response = _verify(client, **overrides)

    assert response.status_code == 403
    assert "1158201444" not in response.text


def test_verify_handshake_with_no_connection_is_refused(client):
    assert _verify(client).status_code == 403


# --- POST events --------------------------------------------------------- #


def test_signed_message_is_stored_and_dispatched(client, service, dispatch):
    connection = service.connect(p.PHONE_NUMBER_ID)

    response = _post(client, p.text_body(message_id="wamid.A"))

    assert response.status_code == 202, response.text
    [event] = service.recorded
    assert event.external_id == "wamid.A"
    assert event.connection_id == connection.id
    assert [c["external_id"] for c in dispatch.calls] == ["wamid.A"]


@pytest.mark.parametrize("signature", ["", "sha256=00ff", "sha1=abc"])
def test_forged_or_missing_signature_is_401_and_stores_nothing(
    client, service, dispatch, signature
):
    service.connect(p.PHONE_NUMBER_ID)

    response = _post(client, p.text_body(), signature=signature)

    assert response.status_code == 401
    assert service.recorded == [] and dispatch.calls == []


def test_signature_made_with_another_app_secret_is_401(client, service):
    service.connect(p.PHONE_NUMBER_ID)

    response = _post(client, p.text_body(), secret="attacker-secret")

    assert response.status_code == 401
    assert service.recorded == []


def test_unknown_number_is_401(client, service):
    assert _post(client, p.text_body()).status_code == 401


def test_a_batched_body_stores_one_event_per_message(client, service, dispatch):
    service.connect(p.PHONE_NUMBER_ID)
    payload = p.body(
        p.value(
            messages=[
                p.text_message("one", message_id="wamid.1"),
                p.text_message("two", message_id="wamid.2"),
            ]
        ),
        p.value(messages=[p.button_reply("row:approve", message_id="wamid.3")]),
        entries=2,
    )

    response = _post(client, payload)

    assert response.status_code == 202
    assert [e.external_id for e in service.recorded] == [
        "wamid.1",
        "wamid.2",
        "wamid.3",
    ]
    assert len(dispatch.calls) == 3


def test_a_body_for_two_connected_numbers_routes_each_to_its_own(client, service):
    ours = service.connect(p.PHONE_NUMBER_ID)
    other = service.connect(p.OTHER_PHONE_NUMBER_ID)
    payload = p.body(
        p.value(messages=[p.text_message("a", message_id="wamid.a")]),
        p.value(
            phone_number_id=p.OTHER_PHONE_NUMBER_ID,
            messages=[p.text_message("b", message_id="wamid.b")],
        ),
    )

    assert _post(client, payload).status_code == 202

    routed = {e.external_id: e.connection_id for e in service.recorded}
    assert routed == {"wamid.a": ours.id, "wamid.b": other.id}


def test_messages_for_a_number_not_connected_here_are_skipped(client, service):
    service.connect(p.PHONE_NUMBER_ID)
    payload = p.body(
        p.value(messages=[p.text_message("a", message_id="wamid.a")]),
        p.value(
            phone_number_id=p.OTHER_PHONE_NUMBER_ID,
            messages=[p.text_message("b", message_id="wamid.b")],
        ),
    )

    assert _post(client, payload).status_code == 202
    assert [e.external_id for e in service.recorded] == ["wamid.a"]


def test_a_redelivered_message_is_stored_once(client, service):
    service.connect(p.PHONE_NUMBER_ID)

    _post(client, p.text_body(message_id="wamid.A"))
    _post(client, p.text_body(message_id="wamid.A"))

    assert [e.external_id for e in service.recorded] == ["wamid.A"]


def test_status_only_bodies_are_acknowledged_and_route_nothing(client, service):
    service.connect(p.PHONE_NUMBER_ID)
    payload = p.body(p.value(statuses=[p.delivered_status(), p.failed_status()]))

    assert _post(client, payload).status_code == 202
    assert service.recorded == []
