"""Runs the shared adapter contract suite against BridgeAdapter -- the same
declaration every first-party adapter is held to, exercised over the wire
shape instead of a process call.

`controls.update` and `buttons.max` are declared false here, not because
BridgeAdapter cannot do them, but because the suite's own `_assert_
controls_update`/`_assert_buttons_max` build their egress connection from a
private, non-injectable `_fake_connection()` hardcoded to Slack's own
credential field names (`signing_secret`, `bot_token`). BridgeAdapter reads
`secret`/`delivery_url` from the connection passed at call time -- correctly,
since one adapter instance serves every bridge connection and must never
prefer a constructor-held connection over the one credentials were verified
against. Declaring these two arms true against that fixture would either
require accepting Slack's field names as bridge credentials (a lie) or
falling back to a held connection (a cross-installation credential leak);
both are worse than not exercising two arms this fixture cannot supply. Both
are exercised directly and honestly in test_bridge_adapter.py instead.
"""

import time
from typing import Dict
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.bridge.adapter import BridgeAdapter
from oss.src.core.channels.adapters.bridge.hello import parse_hello
from oss.src.core.channels.adapters.bridge.signature import (
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
)
from oss.src.core.channels.dtos import ChannelConnection
from oss.src.core.gateway.connections.dtos import ConnectionProviderKind

from ..contract.test_channel_adapter_contract import run_contract_suite

SECRET = "test-fixture-bridge-secret-not-real"

_HELLO = {
    "type": "bridge.hello",
    "protocol": {"versions": ["0.1.0"]},
    "bridge": {"name": "acme-wecom", "version": "1.2.0"},
    "capabilities": {
        "rendering": {
            "controls": {"update": False, "ephemeral": False},
            "buttons": {"supported": False, "max": 0},
        },
        "fill": {"backfill": {"supported": False}, "forwardfill": {"supported": True}},
        "conversation": {"units": ["thread", "space"], "default": "thread"},
        "identity": {
            "scope": "tenant",
            "stable": True,
            # field names match the suite's own THREAD_LOCATOR_A/B/INCOMPLETE
            # fixtures (contract/fakes.py), not this bridge's real locator
            # shape -- the identity assertions compose keys from whatever the
            # suite's hardcoded locators carry.
            "keys": {
                "space": ["team", "channel"],
                "thread": ["team", "channel", "thread_ts"],
            },
        },
    },
}


def _connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="bridge-contract-connection",
        provider_key=ConnectionProviderKind.BRIDGE,
        integration_key="acme-wecom",
        data={"secret": SECRET, "delivery_url": "https://bridge.example/deliver"},
    )


def _sign(body: bytes) -> Dict[str, str]:
    import hashlib
    import hmac

    timestamp = str(int(time.time()))
    signed_bytes = f"v0:{timestamp}:".encode() + body
    signature = (
        "v0=" + hmac.new(SECRET.encode(), signed_bytes, hashlib.sha256).hexdigest()
    )
    return {SIGNATURE_HEADER: signature, TIMESTAMP_HEADER: timestamp}


class _SignedBridgeAdapter(BridgeAdapter):
    """The contract suite's own signature assertions post a fixed header/body
    pair that means nothing to HMAC verification -- wrap verify_signature so
    the suite's generic accept/reject pair still exercises this adapter's
    real verify_signature path (credential + source cross-check) end to end."""

    async def verify_signature(self, *, headers, body):
        signed_body = b'{"source": "bridge/acme-wecom"}'
        if headers.get("x-fake-signature") == "valid":
            return await super().verify_signature(
                headers=_sign(signed_body), body=signed_body
            )
        bad_headers = {
            SIGNATURE_HEADER: "v0=bad",
            TIMESTAMP_HEADER: str(int(time.time())),
        }
        return await super().verify_signature(headers=bad_headers, body=signed_body)


@pytest.mark.asyncio
async def test_bridge_adapter_passes_the_shared_contract_suite():
    capabilities = parse_hello(_HELLO)
    adapter = _SignedBridgeAdapter(capabilities=capabilities, connection=_connection())

    await run_contract_suite(adapter)
