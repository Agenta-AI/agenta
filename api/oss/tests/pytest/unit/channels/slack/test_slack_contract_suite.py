"""Runs the reusable contract suite against SlackAdapter.

`run_contract_suite`'s two signature assertions post the suite's own generic
good/bad header (`x-fake-signature`, contract/fakes.py), not a real Slack
HMAC. Rather than swapping `verify_signature` itself for the fake scheme --
which would mean the real `verify_slack_signature` check never runs inside
this suite -- `_SuiteAdaptedSlackAdapter` only translates that generic
good/bad signal into a real signature, signed with the fixture connection's
own `signing_secret` over a fixture Slack event body, and hands it to the
real, unmodified `verify_signature`. Every other method
(post/edit/buttons/backfill/identity keys) is the real SlackAdapter
implementation too. SlackAdapter's own signature behaviour is covered
separately and exhaustively in test_slack_signature.py and
test_slack_adapter.py against real Slack HMAC fixtures.
"""

import hashlib
import hmac
import time
from typing import Any, Dict
from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.core.channels.dtos import ChannelConnection, ChannelRequestContext
from oss.src.core.channels.utils import compose_external_key
from oss.src.core.channels.dtos import ChannelKeyGrain

from ..contract.fakes import (
    THREAD_LOCATOR_A,
    THREAD_LOCATOR_B,
    THREAD_LOCATOR_INCOMPLETE,
    VALID_SIGNATURE_HEADER,
    VALID_SIGNATURE_VALUE,
)
from ..contract.test_channel_adapter_contract import run_contract_suite

SECRET = "test-fixture-slack-signing-secret-not-real"
_FIXTURE_BODY = b'{"team_id": "T-CONTRACT-SUITE", "api_app_id": "A-CONTRACT-SUITE"}'


def _sign_slack_request(*, secret: str, body: bytes) -> Dict[str, str]:
    timestamp = str(int(time.time()))
    signed_bytes = f"v0:{timestamp}:".encode() + body
    signature = (
        "v0=" + hmac.new(secret.encode(), signed_bytes, hashlib.sha256).hexdigest()
    )
    return {"x-slack-signature": signature, "x-slack-request-timestamp": timestamp}


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
    """Only verify_signature's INPUT is adapted: the suite's generic good/bad
    header selects a real, correctly-signed request or an unsigned one, and
    both go through the real, unmodified verify_signature. Every other
    method is inherited, unmodified."""

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        secret = (connection.data or {}).get("signing_secret", "")
        headers = (
            _sign_slack_request(secret=secret, body=_FIXTURE_BODY)
            if request.headers.get(VALID_SIGNATURE_HEADER) == VALID_SIGNATURE_VALUE
            else {}
        )
        return await super().verify_signature(
            request=ChannelRequestContext(
                headers=headers, path=request.path, body=_FIXTURE_BODY
            ),
            connection=connection,
        )

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
        channel="slack",
        external_key=uuid4(),
        data={"signing_secret": SECRET, "bot_token": "xoxb-fake"},
    )


async def test_slack_adapter_passes_the_shared_contract_suite():
    client = httpx.AsyncClient(
        transport=_ScriptedTransport(), base_url="https://slack.com/api"
    )
    adapter = _SuiteAdaptedSlackAdapter(http_client=client)

    await run_contract_suite(adapter, connection=_connection())


async def test_slack_declared_identity_keys_thread_field_set_is_not_too_small():
    """Two Slack threads differing only in thread_ts must not collapse to the
    same external_key under this adapter's declared identity.keys['thread']."""

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
