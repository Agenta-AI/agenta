"""Outbound: the real `BridgeAdapter.post_message`/`edit_message`, against
two real bridge subprocesses. Proves a delivery signed for one bridge's
secret and posted to its `delivery_url` arrives at that bridge and no other,
and that a retried command is not recorded twice by the receiving side.

`enqueue_output`/`deliver` are still stubs on `ChannelsService` (nothing
routes an outbox row through them yet), so this drives the adapter directly
-- the same seam the outbox worker itself uses today.
"""

from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.bridge.adapter import BridgeAdapter
from oss.src.core.channels.dtos import ChannelConnection
from oss.src.core.channels.utils import compose_idempotency_key

from oss.tests.pytest.acceptance.channels.bridge_process.harness import run_bridge

pytestmark = pytest.mark.asyncio

HELLO_A = {
    "type": "bridge.hello",
    "protocol": {"versions": ["0.1.0"]},
    "bridge": {"name": "acme-wecom", "version": "1.0.0"},
    "capabilities": {
        "rendering": {
            "controls": {"update": True},
            "buttons": {"supported": True, "max": 3},
        },
        "identity": {"scope": "tenant", "stable": True, "keys": {"space": ["chat_id"]}},
    },
}

HELLO_B = {
    "type": "bridge.hello",
    "protocol": {"versions": ["0.1.0"]},
    "bridge": {"name": "other-feishu", "version": "1.0.0"},
    "capabilities": {
        "rendering": {
            "controls": {"update": False},
            "buttons": {"supported": False, "max": 0},
        },
        "identity": {"scope": "tenant", "stable": True, "keys": {"space": ["room_id"]}},
    },
}


def _connection(
    *, integration_key: str, secret: str, delivery_url: str
) -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug=f"{integration_key}-outbound",
        channel="bridge",
        external_key=uuid4(),
        data={
            "secret": secret,
            "delivery_url": delivery_url,
            "installation_id": integration_key,
        },
    )


async def test_delivery_arrives_at_the_right_bridge_and_no_other():
    with run_bridge(name="acme-wecom", secret="acme-secret", hello=HELLO_A) as bridge_a:
        with run_bridge(
            name="other-feishu", secret="feishu-secret", hello=HELLO_B
        ) as bridge_b:
            adapter_a = BridgeAdapter(http_client=httpx.AsyncClient())
            adapter_b = BridgeAdapter(http_client=httpx.AsyncClient())

            connection_a = _connection(
                integration_key="acme-wecom",
                secret=bridge_a.secret,
                delivery_url=bridge_a.deliver_url,
            )
            connection_b = _connection(
                integration_key="other-feishu",
                secret=bridge_b.secret,
                delivery_url=bridge_b.deliver_url,
            )

            receipt_a = await adapter_a.post_message(
                connection=connection_a,
                locator={"chat_id": "grp_1"},
                content=[{"type": "text", "text": "for A"}],
                idempotency_key=uuid4(),
            )
            receipt_b = await adapter_b.post_message(
                connection=connection_b,
                locator={"room_id": "room_1"},
                content=[{"type": "text", "text": "for B"}],
                idempotency_key=uuid4(),
            )

            deliveries_a = await bridge_a.deliveries()
            deliveries_b = await bridge_b.deliveries()

            assert len(deliveries_a) == 1
            assert len(deliveries_b) == 1
            assert deliveries_a[0]["data"]["content"] == [
                {"type": "text", "text": "for A"}
            ]
            assert deliveries_b[0]["data"]["content"] == [
                {"type": "text", "text": "for B"}
            ]
            # each receipt's message id is minted by the bridge that actually
            # received the call -- the cross-check that nothing crossed over.
            assert receipt_a["message_id"].startswith("acme-wecom-")
            assert receipt_b["message_id"].startswith("other-feishu-")


async def test_a_retried_delivery_command_is_not_recorded_twice_by_the_bridge():
    with run_bridge(name="acme-wecom", secret="acme-secret", hello=HELLO_A) as bridge:
        adapter = BridgeAdapter(http_client=httpx.AsyncClient())
        connection = _connection(
            integration_key="acme-wecom",
            secret=bridge.secret,
            delivery_url=bridge.deliver_url,
        )

        row_key = uuid4()
        idempotency_key = compose_idempotency_key(key=row_key, updated_at=None)

        first = await adapter.post_message(
            connection=connection,
            locator={"chat_id": "grp_1"},
            content=[{"type": "text", "text": "working..."}],
            idempotency_key=idempotency_key,
        )
        retried = await adapter.post_message(
            connection=connection,
            locator={"chat_id": "grp_1"},
            content=[{"type": "text", "text": "working..."}],
            idempotency_key=idempotency_key,
        )

        assert first == retried
        deliveries = await bridge.deliveries()
        assert len(deliveries) == 1


async def test_post_then_edit_of_the_same_row_send_two_distinct_idempotency_keys_on_the_wire():
    with run_bridge(name="acme-wecom", secret="acme-secret", hello=HELLO_A) as bridge:
        adapter = BridgeAdapter(http_client=httpx.AsyncClient())
        connection = _connection(
            integration_key="acme-wecom",
            secret=bridge.secret,
            delivery_url=bridge.deliver_url,
        )

        row_key = uuid4()
        post_key = compose_idempotency_key(key=row_key, updated_at=None)
        edit_key = compose_idempotency_key(
            key=row_key, updated_at=datetime(2026, 7, 20, tzinfo=timezone.utc)
        )
        assert post_key != edit_key

        receipt = await adapter.post_message(
            connection=connection,
            locator={"chat_id": "grp_1"},
            content=[{"type": "text", "text": "working..."}],
            idempotency_key=post_key,
        )
        await adapter.edit_message(
            connection=connection,
            external_locator=receipt,
            content=[{"type": "text", "text": "done"}],
            idempotency_key=edit_key,
        )

        deliveries = await bridge.deliveries()
        assert len(deliveries) == 2
        assert deliveries[0]["idempotency_key"] != deliveries[1]["idempotency_key"]
        assert deliveries[0]["type"] != deliveries[1]["type"]
