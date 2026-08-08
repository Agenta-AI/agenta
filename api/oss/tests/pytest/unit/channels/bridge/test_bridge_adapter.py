import json
import time
from typing import Any, Dict, List
from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.bridge.adapter import BridgeAdapter
from oss.src.core.channels.adapters.bridge.hello import parse_hello
from oss.src.core.channels.adapters.bridge.receipt import BridgeDeliveryFailed
from oss.src.core.channels.adapters.bridge.signature import (
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
)
from oss.src.core.channels.dtos import ChannelConnection
from oss.src.core.channels.types import ChannelSignatureInvalid
from oss.src.core.gateway.connections.dtos import ConnectionProviderKind

SECRET = "test-fixture-bridge-secret-not-real"

WORKED_CAPABILITIES = {
    "type": "bridge.hello",
    "protocol": {"versions": ["0.1.0"]},
    "bridge": {"name": "acme-wecom", "version": "1.2.0"},
    "capabilities": {
        "conversation": {"units": ["space"], "default": "space"},
        "identity": {
            "scope": "tenant",
            "stable": True,
            "keys": {"space": ["chat_id"], "thread": []},
        },
    },
}


def _connection(*, integration_key: str = "acme-wecom") -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="bridge-connection",
        provider_key=ConnectionProviderKind.BRIDGE,
        integration_key=integration_key,
        data={"secret": SECRET, "delivery_url": "https://bridge.example/deliver"},
    )


def _sign(body: bytes, *, secret: str = SECRET) -> Dict[str, str]:
    import hashlib
    import hmac

    timestamp = str(int(time.time()))
    signed_bytes = f"v0:{timestamp}:".encode() + body
    signature = (
        "v0=" + hmac.new(secret.encode(), signed_bytes, hashlib.sha256).hexdigest()
    )
    return {SIGNATURE_HEADER: signature, TIMESTAMP_HEADER: timestamp}


def _adapter(connection: ChannelConnection) -> BridgeAdapter:
    capabilities = parse_hello(WORKED_CAPABILITIES)
    return BridgeAdapter(capabilities=capabilities, connection=connection)


# --- verify_signature: credential authoritative, source cross-checked ------ #


@pytest.mark.asyncio
async def test_matching_source_and_credential_verifies():
    connection = _connection(integration_key="acme-wecom")
    adapter = _adapter(connection)
    body = json.dumps({"source": "bridge/acme-wecom"}).encode()
    headers = _sign(body)

    installation_id = await adapter.verify_signature(headers=headers, body=body)

    assert installation_id == "acme-wecom"


@pytest.mark.asyncio
async def test_source_credential_mismatch_is_refused_with_no_detail_leaked():
    connection = _connection(integration_key="acme-wecom")
    adapter = _adapter(connection)
    body = json.dumps({"source": "bridge/some-other-install"}).encode()
    headers = _sign(body)

    with pytest.raises(ChannelSignatureInvalid) as caught:
        await adapter.verify_signature(headers=headers, body=body)

    message = str(caught.value).lower()
    assert "acme-wecom" not in message
    assert "some-other-install" not in message


@pytest.mark.asyncio
async def test_missing_source_is_refused_same_as_a_mismatch():
    connection = _connection(integration_key="acme-wecom")
    adapter = _adapter(connection)
    body = json.dumps({}).encode()
    headers = _sign(body)

    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(headers=headers, body=body)


@pytest.mark.asyncio
async def test_bad_signature_and_source_mismatch_raise_identically():
    connection = _connection(integration_key="acme-wecom")
    adapter = _adapter(connection)

    bad_sig_body = json.dumps({"source": "bridge/acme-wecom"}).encode()
    bad_sig_headers = _sign(bad_sig_body, secret="wrong-secret")

    mismatch_body = json.dumps({"source": "bridge/someone-else"}).encode()
    mismatch_headers = _sign(mismatch_body)

    bad_sig_error = None
    mismatch_error = None

    try:
        await adapter.verify_signature(headers=bad_sig_headers, body=bad_sig_body)
    except ChannelSignatureInvalid as e:
        bad_sig_error = e

    try:
        await adapter.verify_signature(headers=mismatch_headers, body=mismatch_body)
    except ChannelSignatureInvalid as e:
        mismatch_error = e

    assert type(bad_sig_error) is type(mismatch_error) is ChannelSignatureInvalid
    assert str(bad_sig_error) == str(mismatch_error)


@pytest.mark.asyncio
async def test_credential_for_installation_a_cannot_speak_for_installation_b():
    """A credential that verifies fine on its own connection must not resolve
    an event addressed, via `source`, at a different installation's
    connection -- one bridge credential authorises transport for its own
    registration only."""

    connection_a = _connection(integration_key="installation-a")
    adapter_a = _adapter(connection_a)

    body = json.dumps({"source": "bridge/installation-b"}).encode()
    headers = _sign(body, secret=SECRET)

    with pytest.raises(ChannelSignatureInvalid):
        await adapter_a.verify_signature(headers=headers, body=body)


# --- parse_event ------------------------------------------------------------ #


@pytest.mark.asyncio
async def test_parse_event_reads_the_envelope():
    connection = _connection()
    adapter = _adapter(connection)
    body = json.dumps(
        {
            "type": "io.agenta.channel.message.received.v1",
            "id": "wecom-msg-1",
            "data": {
                "space": {"locator": {"chat_id": "grp_456"}, "type": "group"},
                "sender": {"id": "u1"},
                "content": [{"type": "text", "text": "hi"}],
                "addressed": True,
            },
        }
    ).encode()

    event = await adapter.parse_event(body=body)

    assert event is not None
    assert event.external_id == "wecom-msg-1"
    assert event.addressed is True


# --- egress: delivery command + receipt ------------------------------------- #


class _StubTransport(httpx.AsyncBaseTransport):
    def __init__(self, responses: List[Dict[str, Any]]):
        self._responses = list(responses)
        self.requests: List[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        body = self._responses.pop(0)
        return httpx.Response(200, json=body)


def _adapter_with_stub(responses: List[Dict[str, Any]]):
    transport = _StubTransport(responses)
    client = httpx.AsyncClient(transport=transport)
    capabilities = parse_hello(WORKED_CAPABILITIES)
    return BridgeAdapter(capabilities=capabilities, http_client=client), transport


@pytest.mark.asyncio
async def test_post_message_signs_the_command_and_returns_the_receipt():
    adapter, transport = _adapter_with_stub(
        [
            {
                "type": "bridge.receipt",
                "idempotency_key": "k1",
                "external_locator": {"chat_id": "grp_456", "message_id": "98241"},
            }
        ]
    )
    connection = _connection()

    receipt = await adapter.post_message(
        connection=connection,
        locator={"chat_id": "grp_456"},
        content=[{"type": "text", "text": "hi"}],
        idempotency_key=uuid4(),
    )

    assert receipt == {"chat_id": "grp_456", "message_id": "98241"}
    sent = transport.requests[0]
    assert SIGNATURE_HEADER in {k.decode().lower(): v for k, v in sent.headers.raw}


@pytest.mark.asyncio
async def test_a_bridge_reported_failure_surfaces_as_a_failure_not_a_success():
    adapter, _ = _adapter_with_stub(
        [{"type": "bridge.receipt", "error": "chat_id_not_found"}]
    )
    connection = _connection()

    with pytest.raises(BridgeDeliveryFailed):
        await adapter.post_message(
            connection=connection,
            locator={"chat_id": "grp_456"},
            content=[{"type": "text", "text": "hi"}],
            idempotency_key=uuid4(),
        )


@pytest.mark.asyncio
async def test_edit_message_sends_a_different_command_type_than_post():
    adapter, transport = _adapter_with_stub(
        [
            {
                "type": "bridge.receipt",
                "idempotency_key": "k1",
                "external_locator": {"chat_id": "grp_456", "message_id": "98241"},
            },
            {
                "type": "bridge.receipt",
                "idempotency_key": "k2",
                "external_locator": {"chat_id": "grp_456", "message_id": "98241"},
            },
        ]
    )
    connection = _connection()

    await adapter.post_message(
        connection=connection,
        locator={"chat_id": "grp_456"},
        content=[{"type": "text", "text": "working..."}],
        idempotency_key=uuid4(),
    )
    await adapter.edit_message(
        connection=connection,
        external_locator={"chat_id": "grp_456", "message_id": "98241"},
        content=[{"type": "text", "text": "done"}],
        idempotency_key=uuid4(),
    )

    posted = json.loads(transport.requests[0].content)
    edited = json.loads(transport.requests[1].content)
    assert posted["type"] != edited["type"]


# --- discovery / history: no wire message exists for either ---------------- #


@pytest.mark.asyncio
async def test_discover_spaces_returns_empty_no_wire_message_exists():
    adapter = _adapter(_connection())
    result = await adapter.discover_spaces(connection=_connection())
    assert result == []


@pytest.mark.asyncio
async def test_fetch_history_returns_empty_no_wire_message_exists():
    adapter = _adapter(_connection())
    result = await adapter.fetch_history(
        connection=_connection(), locator={"chat_id": "grp_456"}, limit=10
    )
    assert result == []
