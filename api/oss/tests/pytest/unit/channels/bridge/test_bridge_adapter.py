import json
import time
from typing import Any, Dict, List
from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.bridge.adapter import BridgeAdapter
from oss.src.core.channels.adapters.bridge.receipt import BridgeDeliveryFailed
from oss.src.core.channels.adapters.bridge.signature import (
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
)
from oss.src.core.channels.dtos import ChannelConnection, ChannelRequestContext
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


def _connection(
    *, integration_key: str = "acme-wecom", capabilities: Any = None
) -> ChannelConnection:
    data = {"secret": SECRET, "delivery_url": "https://bridge.example/deliver"}
    if capabilities is not None:
        data["capabilities"] = capabilities
    return ChannelConnection(
        id=uuid4(),
        slug="bridge-connection",
        provider_key=ConnectionProviderKind.BRIDGE,
        integration_key=integration_key,
        data=data,
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


def _request(body: bytes, headers: Dict[str, str]) -> ChannelRequestContext:
    return ChannelRequestContext(headers=headers, path="/", body=body)


# --- fetch_capabilities: no fixed declaration exists ------------------------ #


@pytest.mark.asyncio
async def test_fetch_capabilities_reads_the_connections_own_declaration():
    """The fix for two bridges sharing one declaration: nothing is baked into
    the constructor, so the same adapter instance answers differently per
    connection."""

    adapter = BridgeAdapter()
    connection = _connection(capabilities=WORKED_CAPABILITIES["capabilities"])

    capabilities = await adapter.fetch_capabilities(connection=connection)

    assert capabilities.conversation.units == ["space"]
    assert capabilities.identity.scope == "tenant"


@pytest.mark.asyncio
async def test_fetch_capabilities_with_no_stored_declaration_degrades_not_raises():
    adapter = BridgeAdapter()

    capabilities = await adapter.fetch_capabilities(connection=_connection())

    assert capabilities.channel == "bridge"
    assert capabilities.rendering.buttons.supported is False


@pytest.mark.asyncio
async def test_fetch_capabilities_with_no_connection_degrades_not_raises():
    adapter = BridgeAdapter()

    capabilities = await adapter.fetch_capabilities()

    assert capabilities.channel == "bridge"


@pytest.mark.asyncio
async def test_two_connections_get_two_different_declarations():
    adapter = BridgeAdapter()

    connection_a = _connection(
        integration_key="acme-wecom",
        capabilities={"rendering": {"buttons": {"supported": True, "max": 3}}},
    )
    connection_b = _connection(
        integration_key="other-feishu",
        capabilities={"rendering": {"buttons": {"supported": False, "max": 0}}},
    )

    capabilities_a = await adapter.fetch_capabilities(connection=connection_a)
    capabilities_b = await adapter.fetch_capabilities(connection=connection_b)

    assert capabilities_a.rendering.buttons.supported is True
    assert capabilities_b.rendering.buttons.supported is False


# --- verify_signature: credential authoritative, source cross-checked ------ #


@pytest.mark.asyncio
async def test_matching_source_and_credential_verifies():
    connection = _connection(integration_key="acme-wecom")
    adapter = BridgeAdapter()
    body = json.dumps({"source": "bridge/acme-wecom"}).encode()
    headers = _sign(body)

    installation_id = await adapter.verify_signature(
        request=_request(body, headers), connection=connection
    )

    assert installation_id == "acme-wecom"


@pytest.mark.asyncio
async def test_source_credential_mismatch_is_refused_with_no_detail_leaked():
    connection = _connection(integration_key="acme-wecom")
    adapter = BridgeAdapter()
    body = json.dumps({"source": "bridge/some-other-install"}).encode()
    headers = _sign(body)

    with pytest.raises(ChannelSignatureInvalid) as caught:
        await adapter.verify_signature(
            request=_request(body, headers), connection=connection
        )

    message = str(caught.value).lower()
    assert "acme-wecom" not in message
    assert "some-other-install" not in message


@pytest.mark.asyncio
async def test_missing_source_is_refused_same_as_a_mismatch():
    connection = _connection(integration_key="acme-wecom")
    adapter = BridgeAdapter()
    body = json.dumps({}).encode()
    headers = _sign(body)

    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(
            request=_request(body, headers), connection=connection
        )


@pytest.mark.asyncio
async def test_bad_signature_and_source_mismatch_raise_identically():
    connection = _connection(integration_key="acme-wecom")
    adapter = BridgeAdapter()

    bad_sig_body = json.dumps({"source": "bridge/acme-wecom"}).encode()
    bad_sig_headers = _sign(bad_sig_body, secret="wrong-secret")

    mismatch_body = json.dumps({"source": "bridge/someone-else"}).encode()
    mismatch_headers = _sign(mismatch_body)

    bad_sig_error = None
    mismatch_error = None

    try:
        await adapter.verify_signature(
            request=_request(bad_sig_body, bad_sig_headers), connection=connection
        )
    except ChannelSignatureInvalid as e:
        bad_sig_error = e

    try:
        await adapter.verify_signature(
            request=_request(mismatch_body, mismatch_headers), connection=connection
        )
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
    adapter = BridgeAdapter()

    body = json.dumps({"source": "bridge/installation-b"}).encode()
    headers = _sign(body, secret=SECRET)

    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(
            request=_request(body, headers), connection=connection_a
        )


# --- parse_event ------------------------------------------------------------ #


@pytest.mark.asyncio
async def test_parse_event_reads_the_envelope():
    adapter = BridgeAdapter()
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
    return BridgeAdapter(http_client=client), transport


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
    adapter = BridgeAdapter()
    result = await adapter.discover_spaces(connection=_connection())
    assert result == []


@pytest.mark.asyncio
async def test_fetch_history_returns_empty_no_wire_message_exists():
    adapter = BridgeAdapter()
    result = await adapter.fetch_history(
        connection=_connection(), locator={"chat_id": "grp_456"}, limit=10
    )
    assert result == []
