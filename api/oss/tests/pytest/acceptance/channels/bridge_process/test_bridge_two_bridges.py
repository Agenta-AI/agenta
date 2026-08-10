"""Two bridge processes, two credentials, two capability declarations, two
`source` values -- behind the one route. This is the reason this suite
exists: everything in test_bridge_ingress_seam.py can pass one bridge at a
time and still hide a design gap that only shows up with two.

Per the settled contract, the credential resolves identity and `source` is a
required cross-check; the channel key for every bridge is the single fixed
`bridge`, with `integration_key` distinguishing installations. This suite
asserts exactly that, using the real, unmodified `ChannelAdapterRegistry` and
`BridgeAdapter` classes -- no test-local stand-in for either.
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
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelAgentFlags,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelGrantCreate,
    ChannelGrantData,
    ChannelGrantEffect,
    ChannelGrantFlags,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.gateway.connections.dao import ConnectionsDAO

from oss.tests.pytest.acceptance.channels.bridge_process.harness import run_bridge

pytestmark = pytest.mark.integration

HELLO_A = {
    "type": "bridge.hello",
    "protocol": {"versions": ["0.1.0"]},
    "bridge": {"name": "acme-wecom", "version": "1.0.0"},
    "capabilities": {
        "conversation": {"units": ["space"], "default": "space"},
        "rendering": {"buttons": {"supported": True, "max": 3}},
        "identity": {
            "scope": "tenant",
            "stable": True,
            "keys": {"space": ["chat_id"], "thread": []},
        },
    },
}

HELLO_B = {
    "type": "bridge.hello",
    "protocol": {"versions": ["0.1.0"]},
    "bridge": {"name": "other-feishu", "version": "2.0.0"},
    "capabilities": {
        "conversation": {"units": ["space"], "default": "space"},
        "rendering": {"buttons": {"supported": False, "max": 0}},
        "identity": {
            "scope": "tenant",
            "stable": True,
            "keys": {"space": ["room_id"], "thread": []},
        },
    },
}


def _envelope(
    *, event_id, source, locator_key, locator_value, text_body
) -> Dict[str, Any]:
    return {
        "specversion": "1.0",
        "id": event_id,
        "type": "io.agenta.channel.message.received.v1",
        "source": source,
        "time": "2026-07-20T10:00:00Z",
        "data": {
            "space": {"locator": {locator_key: locator_value}, "type": "group"},
            "sender": {"id": "u1", "display_name": "someone"},
            "content": [{"type": "text", "text": text_body}],
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


async def _connection_id_for_row(engine, project_id, external_id: str):
    async with engine.session() as session:
        result = await session.execute(
            text(
                "SELECT connection_id FROM channel_inbox_events "
                "WHERE project_id = :project_id AND external_id = :external_id"
            ),
            {"project_id": project_id, "external_id": external_id},
        )
        return result.scalar_one_or_none()


@pytest.fixture
async def two_bridges(bridge_scope):
    """The exact production shape: ONE `BridgeAdapter` instance, registered
    once under the ONE `bridge` key in the real `ChannelAdapterRegistry` --
    mirroring `routers.py`'s `"slack": SlackAdapter()` line, stateless,
    constructed with no connection held. Two real bridge subprocesses, two
    real credentials, both behind that one registration."""

    engine = bridge_scope["engine"]

    # The ingress resolves a connection by (provider_key, integration_key)
    # with no project scope, so integration_key must be unique across every
    # concurrently-running test -- exactly as a real bridge installation id
    # is globally unique, not merely unique within one tenant.
    installation_a = f"acme-wecom-{uuid.uuid4().hex[:8]}"
    installation_b = f"other-feishu-{uuid.uuid4().hex[:8]}"

    with run_bridge(
        name=installation_a, secret="acme-secret", hello=HELLO_A
    ) as bridge_a:
        with run_bridge(
            name=installation_b, secret="feishu-secret", hello=HELLO_B
        ) as bridge_b:
            connection_a_id = await bridge_scope["make_connection"](
                integration_key=installation_a,
                secret=bridge_a.secret,
                delivery_url=bridge_a.deliver_url,
                capabilities=parse_hello(HELLO_A).model_dump(mode="json"),
            )
            connection_b_id = await bridge_scope["make_connection"](
                integration_key=installation_b,
                secret=bridge_b.secret,
                delivery_url=bridge_b.deliver_url,
                capabilities=parse_hello(HELLO_B).model_dump(mode="json"),
            )

            # The one shared adapter instance every bridge is routed through in
            # production; each connection carries its own declaration, read at
            # call time, so nothing is baked into the adapter itself.
            shared_adapter = BridgeAdapter()
            registry = ChannelAdapterRegistry(adapters={"bridge": shared_adapter})

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
                    "engine": engine,
                    "project_id": bridge_scope["project_id"],
                    "user_id": bridge_scope["user_id"],
                    "bridge_a": bridge_a,
                    "bridge_b": bridge_b,
                    "connection_a_id": connection_a_id,
                    "connection_b_id": connection_b_id,
                    "installation_a": installation_a,
                    "installation_b": installation_b,
                }


async def test_two_bridges_interleaved_each_resolve_to_their_own_connection(
    two_bridges,
):
    """The central claim: an event from bridge A and an event from bridge B,
    interleaved, both accepted through the one route, each landing against
    its own connection row -- not the same one, not neither."""

    bridge_a = two_bridges["bridge_a"]
    bridge_b = two_bridges["bridge_b"]
    client = two_bridges["client"]

    envelope_a = _envelope(
        event_id="wecom-1",
        source=f"bridge/{two_bridges['installation_a']}",
        locator_key="chat_id",
        locator_value="grp_1",
        text_body="from A",
    )
    envelope_b = _envelope(
        event_id="feishu-1",
        source=f"bridge/{two_bridges['installation_b']}",
        locator_key="room_id",
        locator_value="room_1",
        text_body="from B",
    )

    body_a = json.dumps(envelope_a).encode()
    body_b = json.dumps(envelope_b).encode()

    ts = str(int(time.time()))
    headers_a = bridge_a.sign(timestamp=ts, body=body_a)
    headers_b = bridge_b.sign(timestamp=ts, body=body_b)

    # Interleaved: A, then B, then A again -- not two back-to-back batches.
    response_a1 = await client.post(
        "/channels/bridge/events/", headers=headers_a, content=body_a
    )
    response_b1 = await client.post(
        "/channels/bridge/events/", headers=headers_b, content=body_b
    )

    assert response_a1.status_code == 202, response_a1.text
    assert response_b1.status_code == 202, response_b1.text

    connection_for_a = await _connection_id_for_row(
        two_bridges["engine"], two_bridges["project_id"], "wecom-1"
    )
    connection_for_b = await _connection_id_for_row(
        two_bridges["engine"], two_bridges["project_id"], "feishu-1"
    )

    assert connection_for_a == two_bridges["connection_a_id"]
    assert connection_for_b == two_bridges["connection_b_id"]
    assert connection_for_a != connection_for_b


async def test_a_bridge_whose_source_disagrees_with_its_credential_is_refused(
    two_bridges,
):
    """Bridge A signs honestly (its own secret) but claims to be bridge B in
    `source`. Settled contract: credential is authoritative, source is a
    required cross-check, mismatch is a hard refusal."""

    bridge_a = two_bridges["bridge_a"]
    client = two_bridges["client"]

    envelope = _envelope(
        event_id="wecom-mismatch-1",
        source="bridge/other-feishu",
        locator_key="chat_id",
        locator_value="grp_1",
        text_body="claims to be B",
    )
    body = json.dumps(envelope).encode()
    headers = bridge_a.sign(timestamp=str(int(time.time())), body=body)

    response = await client.post(
        "/channels/bridge/events/", headers=headers, content=body
    )

    assert response.status_code == 401
    assert (
        await _row_count(
            two_bridges["engine"], two_bridges["project_id"], "wecom-mismatch-1"
        )
        == 0
    )


async def _configure_agent_for_connection(
    service: ChannelsService,
    *,
    project_id,
    user_id,
    connection_id,
    locator_key: str,
    locator_value: str,
    space_kind: ChannelSpaceKind = ChannelSpaceKind.GROUP,
):
    """Seed exactly what `resolve()` needs to answer without a sigil: a
    configured space at the event's own locator, a connection-default agent,
    and a default grant tying them together."""

    from uuid import uuid4

    from oss.src.core.shared.dtos import Reference

    space = await service.create_space(
        project_id=project_id,
        user_id=user_id,
        space=ChannelSpaceCreate(
            connection_id=connection_id,
            kind=space_kind,
            # overwritten by create_space -- compose_external_key() derives
            # the real value from the locator below, never trusting a caller.
            external_key=uuid4(),
            data=ChannelSpaceData(external_locator={locator_key: locator_value}),
        ),
    )
    agent = await service.create_agent(
        project_id=project_id,
        user_id=user_id,
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug=f"agent-{connection_id}",
            data=ChannelAgentData(
                references={"workflow": Reference(slug="stub-workflow")}
            ),
            flags=ChannelAgentFlags(is_default=True),
        ),
    )
    await service.create_grant(
        project_id=project_id,
        user_id=user_id,
        grant=ChannelGrantCreate(
            agent_id=agent.id,
            effect=ChannelGrantEffect.ALLOW,
            space_id=space.id,
            data=ChannelGrantData(),
            flags=ChannelGrantFlags(is_default=True),
        ),
    )
    return space, agent


async def test_two_bridges_interleaved_each_resolve_to_their_own_agent_and_thread(
    two_bridges,
):
    """Beyond "own connection" (the test above): each bridge's event also
    resolves to its own configured space, its own agent, and its own
    freshly-created thread -- never the other bridge's. Each connection
    carries its own capability declaration (chat_id vs room_id identity
    keys), so this also proves fetch_capabilities resolves per-connection
    rather than returning one shared adapter's baked-in declaration."""

    engine = two_bridges["engine"]
    project_id = two_bridges["project_id"]
    user_id = two_bridges["user_id"]

    connections_service = ConnectionsService(
        connections_dao=ConnectionsDAO(engine=engine), adapter_registry=None
    )
    shared_adapter = BridgeAdapter()
    registry = ChannelAdapterRegistry(adapters={"bridge": shared_adapter})
    service = ChannelsService(
        channels_dao=ChannelsDAO(engine=engine),
        adapter_registry=registry,
        connections_service=connections_service,
    )

    await _configure_agent_for_connection(
        service,
        project_id=project_id,
        user_id=user_id,
        connection_id=two_bridges["connection_a_id"],
        locator_key="chat_id",
        locator_value="grp_1",
    )
    await _configure_agent_for_connection(
        service,
        project_id=project_id,
        user_id=user_id,
        connection_id=two_bridges["connection_b_id"],
        locator_key="room_id",
        locator_value="room_1",
    )

    event_a = await service.record_inbox_event(
        project_id=project_id,
        event=ChannelInboxEventCreate(
            connection_id=two_bridges["connection_a_id"],
            external_id="wecom-resolve-1",
            kind=ChannelEventKind.MESSAGE,
            origin=ChannelEventOrigin.PUSHED,
            data=ChannelInboxEventData(
                external_locator={"chat_id": "grp_1"},
                processed=ChannelInboxEventProcessed(
                    content=[{"type": "text", "text": "hi from A"}],
                    sender={"id": "u1"},
                ),
            ),
        ),
    )
    event_b = await service.record_inbox_event(
        project_id=project_id,
        event=ChannelInboxEventCreate(
            connection_id=two_bridges["connection_b_id"],
            external_id="feishu-resolve-1",
            kind=ChannelEventKind.MESSAGE,
            origin=ChannelEventOrigin.PUSHED,
            data=ChannelInboxEventData(
                external_locator={"room_id": "room_1"},
                processed=ChannelInboxEventProcessed(
                    content=[{"type": "text", "text": "hi from B"}],
                    sender={"id": "u2"},
                ),
            ),
        ),
    )

    resolution_a = await service.resolve(
        project_id=project_id,
        connection_id=two_bridges["connection_a_id"],
        event=event_a,
    )
    resolution_b = await service.resolve(
        project_id=project_id,
        connection_id=two_bridges["connection_b_id"],
        event=event_b,
    )

    assert resolution_a is not None and resolution_b is not None
    assert resolution_a.space.id != resolution_b.space.id
    assert resolution_a.agent.id != resolution_b.agent.id
    assert resolution_a.thread.id != resolution_b.thread.id
    assert resolution_a.thread.agent_id == resolution_a.agent.id
    assert resolution_b.thread.agent_id == resolution_b.agent.id
