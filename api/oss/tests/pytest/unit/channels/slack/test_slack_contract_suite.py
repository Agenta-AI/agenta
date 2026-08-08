"""Runs the reusable contract suite against SlackAdapter.

`run_contract_suite`'s two signature assertions are coupled to the suite's own
fake header scheme (`x-fake-signature: valid`, contract/fakes.py) rather than
being adapter-agnostic — a real adapter's `verify_signature` correctly REJECTS
that header, since it is not a valid Slack HMAC. Rather than editing the
shared suite or weakening SlackAdapter to accept a fake scheme, this file
runs the suite against a test-local subclass that swaps in the suite's fake
header acceptance for verify_signature only — every other method
(post/edit/buttons/backfill/identity keys) is the real SlackAdapter
implementation, unmodified. SlackAdapter's own signature behaviour is
covered separately and exhaustively in test_slack_signature.py and
test_slack_adapter.py against real Slack HMAC fixtures.
"""

from typing import Any, Dict
from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.core.channels.dtos import ChannelConnection
from oss.src.core.channels.types import ChannelSignatureInvalid
from oss.src.core.gateway.connections.dtos import ConnectionProviderKind
from oss.src.core.channels.utils import compose_external_key
from oss.src.core.channels.dtos import ChannelKeyGrain

from ..contract.fakes import (
    INSTALLATION_ID,
    THREAD_LOCATOR_A,
    THREAD_LOCATOR_B,
    THREAD_LOCATOR_INCOMPLETE,
    VALID_SIGNATURE_HEADER,
    VALID_SIGNATURE_VALUE,
)
from ..contract.test_channel_adapter_contract import run_contract_suite


class _ScriptedTransport(httpx.AsyncBaseTransport):
    """Answers chat.postMessage with a fresh ts, and chat.update by echoing
    back the ts it was asked to edit — real Slack's own chat.update contract
    (edits in place, keyed by the given channel+ts, returns that same ts)."""

    def __init__(self):
        self._next_id = 0

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("chat.update"):
            payload = _json_body(request.content)
            return httpx.Response(
                200,
                json={
                    "ok": True,
                    "channel": payload.get("channel", "C1"),
                    "ts": payload.get("ts"),
                },
            )

        self._next_id += 1
        return httpx.Response(
            200, json={"ok": True, "channel": "C1", "ts": f"{self._next_id}.0"}
        )


def _json_body(content: bytes) -> Dict[str, Any]:
    import json

    return json.loads(content) if content else {}


class _SuiteAdaptedSlackAdapter(SlackAdapter):
    """SlackAdapter with only verify_signature swapped for the suite's fake
    header scheme, so the suite's own hardcoded good/bad headers apply. Every
    other method is inherited, unmodified."""

    async def verify_signature(self, *, headers: Dict[str, str], body: bytes) -> str:
        if headers.get(VALID_SIGNATURE_HEADER) != VALID_SIGNATURE_VALUE:
            raise ChannelSignatureInvalid(channel=self.channel)
        return INSTALLATION_ID

    def inspect_posted(self, locator):
        # What was actually rendered onto the wire (post-degradation), not the
        # caller's original request — the suite's assertion is about the
        # posted result, and inspecting the request would hide a real
        # truncation bug behind an unchanged input.
        return self._posted.get((locator["channel"], locator["ts"]), [])

    async def post_message(self, *, connection, locator, content, idempotency_key):
        from oss.src.core.channels.adapters.slack.adapter import _render_content

        _, blocks = _render_content(content)
        rendered_buttons = [
            {"type": "button", "id": el.get("value")}
            for block in blocks
            if block.get("type") == "actions"
            for el in block.get("elements", [])
        ]

        receipt = await super().post_message(
            connection=connection,
            locator=locator,
            content=content,
            idempotency_key=idempotency_key,
        )
        if not hasattr(self, "_posted"):
            self._posted = {}
        self._posted[(receipt["channel"], receipt["ts"])] = rendered_buttons
        return receipt


def _connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="slack-contract-suite",
        provider_key=ConnectionProviderKind.AGENTA,
        integration_key="slack",
        data={"signing_secret": "unused", "bot_token": "xoxb-fake"},
    )


async def test_slack_adapter_passes_wp2_contract_suite():
    client = httpx.AsyncClient(
        transport=_ScriptedTransport(), base_url="https://slack.com/api"
    )
    adapter = _SuiteAdaptedSlackAdapter(connection=_connection(), http_client=client)

    await run_contract_suite(adapter)


async def test_slack_declared_identity_keys_thread_field_set_is_not_too_small():
    """specs-wp6.md's own worked assertion: two Slack threads differing only
    in thread_ts must not collapse to the same external_key under this
    adapter's declared identity.keys['thread']."""

    from oss.src.core.channels.adapters.slack.capabilities import (
        fetch_slack_capabilities,
    )

    capabilities = fetch_slack_capabilities()

    key_a = compose_external_key(capabilities, ChannelKeyGrain.THREAD, THREAD_LOCATOR_A)
    key_b = compose_external_key(capabilities, ChannelKeyGrain.THREAD, THREAD_LOCATOR_B)

    assert key_a != key_b

    with pytest.raises(Exception):
        compose_external_key(
            capabilities, ChannelKeyGrain.THREAD, THREAD_LOCATOR_INCOMPLETE
        )
