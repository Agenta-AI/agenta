"""One bridge process, real HTTP, real signing, driven at the ingress route
this package shares with every other bridge. Proves the single-bridge path
before the two-bridge test asks harder questions of it.
"""

import json
import time
import uuid
from typing import Any, Dict

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import text

from oss.src.apis.fastapi.channels.ingress import ChannelsIngressRouter
from oss.src.core.channels.adapters.bridge.adapter import BridgeAdapter
from oss.src.core.channels.adapters.bridge.hello import parse_hello
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelNotSupported
from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.gateway.connections.dao import ConnectionsDAO

from oss.tests.pytest.acceptance.channels.bridge_process.harness import run_bridge

pytestmark = pytest.mark.integration

HELLO_A = {
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


class _SingleBridgeRegistry:
    """The registry contract exactly as `ChannelAdapterRegistry` implements
    it -- one adapter per channel key, raise-on-miss. A real registry object
    is not importable here without also importing the composition root, so
    this reproduces its two methods rather than constructing the real class
    with a private import path."""

    def __init__(self, adapters: Dict[str, Any]):
        self._adapters = adapters

    def get(self, channel: str):
        adapter = self._adapters.get(channel)
        if adapter is None:
            raise ChannelNotSupported(channel=channel)
        return adapter

    def keys(self):
        return list(self._adapters.keys())


def _sign(bridge, *, body: bytes, timestamp: str) -> Dict[str, str]:
    return bridge.sign(timestamp=timestamp, body=body)


def _envelope(
    *, event_id: str, chat_id: str, text: str, source: str = "bridge/acme-wecom"
) -> Dict[str, Any]:
    return {
        "specversion": "1.0",
        "id": event_id,
        "type": "io.agenta.channel.message.received.v1",
        "source": source,
        "time": "2026-07-20T10:00:00Z",
        "data": {
            "space": {"locator": {"chat_id": chat_id}, "type": "group"},
            "sender": {"id": "wecom-user-1", "display_name": "Wei"},
            "content": [{"type": "text", "text": text}],
            "addressed": True,
        },
    }


async def _row_count(engine, project_id, external_id: str) -> int:
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
async def single_bridge_seam(bridge_scope):
    engine = bridge_scope["engine"]
    project_id = bridge_scope["project_id"]

    # The ingress resolves a connection by (provider_key, integration_key)
    # with no project scope (an inbound platform event carries no tenant) --
    # so integration_key must be unique across every concurrently-running
    # test, exactly as a real bridge installation id is globally unique.
    installation_id = f"acme-wecom-{uuid.uuid4().hex[:8]}"

    with run_bridge(
        name=installation_id, secret="acme-secret", hello=HELLO_A
    ) as bridge:
        connection_id = await bridge_scope["make_connection"](
            integration_key=installation_id,
            secret=bridge.secret,
            delivery_url=bridge.deliver_url,
            capabilities=parse_hello(HELLO_A).model_dump(mode="json"),
        )

        adapter = BridgeAdapter()
        registry = _SingleBridgeRegistry({"bridge": adapter})

        connections_service = ConnectionsService(
            connections_dao=ConnectionsDAO(engine=engine),
            adapter_registry=None,
        )
        service = ChannelsService(
            channels_dao=ChannelsDAO(engine=engine),
            adapter_registry=registry,
            connections_service=connections_service,
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

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client:
            yield {
                "client": client,
                "bridge": bridge,
                "engine": engine,
                "project_id": project_id,
                "connection_id": connection_id,
                "installation_id": installation_id,
            }


async def test_signed_bridge_event_writes_exactly_one_row_and_acks_202(
    single_bridge_seam,
):
    bridge = single_bridge_seam["bridge"]
    source = f"bridge/{single_bridge_seam['installation_id']}"
    envelope = _envelope(
        event_id="wecom-msg-1", chat_id="grp_456", text="hello", source=source
    )
    body = json.dumps(envelope).encode()
    headers = _sign(bridge, body=body, timestamp=str(int(time.time())))

    response = await single_bridge_seam["client"].post(
        "/channels/bridge/events/", headers=headers, content=body
    )

    assert response.status_code == 202, response.text
    assert (
        await _row_count(
            single_bridge_seam["engine"],
            single_bridge_seam["project_id"],
            "wecom-msg-1",
        )
        == 1
    )


async def test_unsigned_bridge_event_is_rejected(single_bridge_seam):
    source = f"bridge/{single_bridge_seam['installation_id']}"
    envelope = _envelope(
        event_id="wecom-msg-2", chat_id="grp_456", text="hello", source=source
    )
    body = json.dumps(envelope).encode()

    response = await single_bridge_seam["client"].post(
        "/channels/bridge/events/", content=body
    )

    assert response.status_code == 401
    assert (
        await _row_count(
            single_bridge_seam["engine"],
            single_bridge_seam["project_id"],
            "wecom-msg-2",
        )
        == 0
    )


async def test_stale_timestamp_is_rejected_the_same_way_as_a_bad_signature(
    single_bridge_seam,
):
    bridge = single_bridge_seam["bridge"]
    source = f"bridge/{single_bridge_seam['installation_id']}"
    envelope = _envelope(
        event_id="wecom-msg-3", chat_id="grp_456", text="hello", source=source
    )
    body = json.dumps(envelope).encode()
    stale_timestamp = str(int(time.time()) - 600)
    headers = _sign(bridge, body=body, timestamp=stale_timestamp)

    response = await single_bridge_seam["client"].post(
        "/channels/bridge/events/", headers=headers, content=body
    )

    assert response.status_code == 401
    assert (
        await _row_count(
            single_bridge_seam["engine"],
            single_bridge_seam["project_id"],
            "wecom-msg-3",
        )
        == 0
    )


async def test_bad_signature_and_stale_timestamp_are_refused_identically(
    single_bridge_seam,
):
    bridge = single_bridge_seam["bridge"]
    source = f"bridge/{single_bridge_seam['installation_id']}"

    fresh_ts = str(int(time.time()))
    stale_ts = str(int(time.time()) - 600)

    body_a = json.dumps(
        _envelope(
            event_id="wecom-msg-4a", chat_id="grp_456", text="hello", source=source
        )
    ).encode()
    bad_sig_headers = {
        **_sign(bridge, body=body_a, timestamp=fresh_ts),
        "x-agenta-bridge-signature": "v0=deadbeef",
    }

    body_b = json.dumps(
        _envelope(
            event_id="wecom-msg-4b", chat_id="grp_456", text="hello", source=source
        )
    ).encode()
    stale_headers = _sign(bridge, body=body_b, timestamp=stale_ts)

    resp_bad_sig = await single_bridge_seam["client"].post(
        "/channels/bridge/events/", headers=bad_sig_headers, content=body_a
    )
    resp_stale = await single_bridge_seam["client"].post(
        "/channels/bridge/events/", headers=stale_headers, content=body_b
    )

    assert resp_bad_sig.status_code == resp_stale.status_code == 401
    assert resp_bad_sig.json() == resp_stale.json()


async def test_redelivery_of_the_same_bridge_event_writes_no_second_row(
    single_bridge_seam,
):
    bridge = single_bridge_seam["bridge"]
    source = f"bridge/{single_bridge_seam['installation_id']}"
    envelope = _envelope(
        event_id="wecom-msg-5", chat_id="grp_456", text="hello", source=source
    )
    body = json.dumps(envelope).encode()
    headers = _sign(bridge, body=body, timestamp=str(int(time.time())))

    for _ in range(3):
        response = await single_bridge_seam["client"].post(
            "/channels/bridge/events/", headers=headers, content=body
        )
        assert response.status_code == 202, response.text

    assert (
        await _row_count(
            single_bridge_seam["engine"],
            single_bridge_seam["project_id"],
            "wecom-msg-5",
        )
        == 1
    )


async def test_source_credential_mismatch_is_refused_with_no_detail_leaked(
    single_bridge_seam,
):
    """The bridge signs a body honestly (its own secret, timestamp fresh) but
    claims a different installation's `source` -- settled by the contract as
    a hard refusal, credential authoritative, no differentiating detail."""

    bridge = single_bridge_seam["bridge"]
    envelope = _envelope(event_id="wecom-msg-6", chat_id="grp_456", text="hello")
    envelope["source"] = "bridge/some-other-installation"
    body = json.dumps(envelope).encode()
    headers = _sign(bridge, body=body, timestamp=str(int(time.time())))

    response = await single_bridge_seam["client"].post(
        "/channels/bridge/events/", headers=headers, content=body
    )

    assert response.status_code == 401
    assert response.json() == {"status": "error"}
    assert (
        await _row_count(
            single_bridge_seam["engine"],
            single_bridge_seam["project_id"],
            "wecom-msg-6",
        )
        == 0
    )
