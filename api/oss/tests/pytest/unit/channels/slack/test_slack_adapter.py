import hashlib
import hmac
import json
import time
from typing import Any, Dict, List
from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.slack.adapter import (
    ChannelBackfillRefused,
    SlackAdapter,
)
from oss.src.core.channels.dtos import ChannelConnection, ChannelSpaceKind
from oss.src.core.channels.types import ChannelSignatureInvalid
from oss.src.core.channels.utils import compose_external_key
from oss.src.core.channels.dtos import ChannelKeyGrain
from oss.src.core.gateway.connections.dtos import ConnectionProviderKind

SIGNING_SECRET = "test-signing-secret"


def _connection(**data_overrides) -> ChannelConnection:
    data = {
        "signing_secret": SIGNING_SECRET,
        "bot_token": "xoxb-fake",
        "bot_user_id": "UBOT1",
        "team_id": "T1",
    }
    data.update(data_overrides)
    return ChannelConnection(
        id=uuid4(),
        slug="slack-connection",
        provider_key=ConnectionProviderKind.AGENTA,
        integration_key="slack",
        data=data,
    )


def _signed_request(body: bytes, *, secret: str = SIGNING_SECRET):
    timestamp = str(int(time.time()))
    signed_bytes = f"v0:{timestamp}:".encode() + body
    signature = (
        "v0=" + hmac.new(secret.encode(), signed_bytes, hashlib.sha256).hexdigest()
    )
    return {
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp,
    }


# --- verify_signature -------------------------------------------------------- #


async def test_verify_signature_returns_team_id_on_success():
    connection = _connection()
    adapter = SlackAdapter(connection=connection)
    body = json.dumps({"team_id": "T1"}).encode()
    headers = _signed_request(body)

    installation_id = await adapter.verify_signature(headers=headers, body=body)

    assert installation_id == "T1"


async def test_verify_signature_rejects_bad_signature():
    connection = _connection()
    adapter = SlackAdapter(connection=connection)
    body = json.dumps({"team_id": "T1"}).encode()

    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(headers={}, body=body)


async def test_verify_signature_no_connection_configured_raises_same_exception():
    adapter = SlackAdapter(connection=None)
    body = json.dumps({"team_id": "T1"}).encode()
    headers = _signed_request(body)

    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(headers=headers, body=body)


# --- parse_event -------------------------------------------------------------- #


def _event_callback(event: Dict[str, Any], *, team_id: str = "T1") -> bytes:
    return json.dumps(
        {"type": "event_callback", "team_id": team_id, "event": event}
    ).encode()


async def test_parse_event_ignores_non_event_callback_payloads():
    adapter = SlackAdapter()
    body = json.dumps({"type": "url_verification", "challenge": "abc"}).encode()

    assert await adapter.parse_event(body=body) is None


async def test_parse_event_ignores_bot_authored_messages():
    connection = _connection()
    adapter = SlackAdapter(connection=connection)
    body = _event_callback({"channel": "C1", "bot_id": "B1", "text": "echo"})

    assert await adapter.parse_event(body=body) is None


async def test_parse_event_extracts_sigils_and_marks_addressed():
    adapter = SlackAdapter()
    body = _event_callback(
        {"channel": "C1", "user": "U1", "text": "<@UBOT1> ~support !new", "ts": "1.1"}
    )

    event = await adapter.parse_event(body=body)

    assert event is not None
    assert event.addressed is True


async def test_parse_event_unaddressed_message_marks_addressed_false():
    adapter = SlackAdapter()
    body = _event_callback(
        {"channel": "C1", "user": "U1", "text": "just chatting", "ts": "1.1"}
    )

    event = await adapter.parse_event(body=body)

    assert event is not None
    assert event.addressed is False


@pytest.mark.parametrize(
    "event_extra,expected",
    [
        ({"channel_type": "im"}, ChannelSpaceKind.PRIVATE),
        ({"channel_type": "mpim"}, ChannelSpaceKind.GROUP),
        ({"channel_type": "group"}, ChannelSpaceKind.TOPIC),
        ({"channel_type": "channel"}, ChannelSpaceKind.TOPIC),
    ],
)
async def test_parse_event_classifies_each_container_kind(event_extra, expected):
    adapter = SlackAdapter()
    event = {"channel": "C1", "user": "U1", "text": "hi", "ts": "1.1"}
    event.update(event_extra)
    body = _event_callback(event)

    parsed = await adapter.parse_event(body=body)

    assert parsed.space_kind == expected


async def test_threaded_message_and_channel_message_resolve_different_units():
    adapter = SlackAdapter()

    threaded = await adapter.parse_event(
        body=_event_callback(
            {
                "channel": "C1",
                "user": "U1",
                "text": "hi",
                "ts": "2.2",
                "thread_ts": "1.1",
            }
        )
    )
    untethered = await adapter.parse_event(
        body=_event_callback({"channel": "C1", "user": "U1", "text": "hi", "ts": "1.1"})
    )

    assert threaded.thread_locator is not None
    assert untethered.thread_locator is None


async def test_two_distinct_threads_compose_to_distinct_external_keys():
    from oss.src.core.channels.adapters.slack.capabilities import (
        fetch_slack_capabilities,
    )

    adapter = SlackAdapter()
    capabilities = fetch_slack_capabilities()

    first = await adapter.parse_event(
        body=_event_callback(
            {
                "channel": "C1",
                "user": "U1",
                "text": "hi",
                "ts": "1.1",
                "thread_ts": "1000.1",
            }
        )
    )
    second = await adapter.parse_event(
        body=_event_callback(
            {
                "channel": "C1",
                "user": "U1",
                "text": "hi",
                "ts": "2.2",
                "thread_ts": "2000.2",
            }
        )
    )

    key_a = compose_external_key(
        capabilities, ChannelKeyGrain.THREAD, first.thread_locator
    )
    key_b = compose_external_key(
        capabilities, ChannelKeyGrain.THREAD, second.thread_locator
    )

    assert key_a != key_b


# --- egress (stubbed HTTP transport) ---------------------------------------- #


class _StubTransport(httpx.AsyncBaseTransport):
    """Records requests, answers a scripted body per call."""

    def __init__(self, responses: List[Dict[str, Any]]):
        self._responses = list(responses)
        self.requests: List[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        body = self._responses.pop(0)
        return httpx.Response(200, json=body)


def _adapter_with_stub(responses: List[Dict[str, Any]]):
    transport = _StubTransport(responses)
    client = httpx.AsyncClient(transport=transport, base_url="https://slack.com/api")
    return SlackAdapter(http_client=client), transport


async def test_post_then_edit_produces_one_message_edited_in_place():
    adapter, transport = _adapter_with_stub(
        [
            {"ok": True, "channel": "C1", "ts": "1000.1"},
            {"ok": True, "channel": "C1", "ts": "1000.1"},
        ]
    )
    connection = _connection()

    receipt = await adapter.post_message(
        connection=connection,
        locator={"channel": "C1"},
        content=[{"type": "text", "text": "working..."}],
        idempotency_key=uuid4(),
    )
    edited = await adapter.edit_message(
        connection=connection,
        external_locator=receipt,
        content=[{"type": "text", "text": "done"}],
        idempotency_key=uuid4(),
    )

    assert receipt == {"channel": "C1", "ts": "1000.1"}
    assert edited == receipt
    methods = [r.url.path for r in transport.requests]
    assert methods == ["/api/chat.postMessage", "/api/chat.update"]


async def test_content_over_max_chars_splits_into_multiple_posts():
    long_text = "x" * 4001
    adapter, transport = _adapter_with_stub(
        [
            {"ok": True, "channel": "C1", "ts": "1"},
            {"ok": True, "channel": "C1", "ts": "2"},
        ]
    )
    connection = _connection()

    await adapter.post_message(
        connection=connection,
        locator={"channel": "C1"},
        content=[{"type": "text", "text": long_text}],
        idempotency_key=uuid4(),
    )

    assert len(transport.requests) == 2


# --- fetch_history / backfill refusal ---------------------------------------- #


async def test_backfill_refusal_is_distinguishable_from_empty_page():
    adapter, _ = _adapter_with_stub([{"ok": False, "error": "missing_scope"}])
    connection = _connection()

    with pytest.raises(ChannelBackfillRefused):
        await adapter.fetch_history(
            connection=connection, locator={"team": "T1", "channel": "C1"}, limit=50
        )


async def test_backfill_empty_page_returns_empty_list_not_a_refusal():
    adapter, _ = _adapter_with_stub([{"ok": True, "messages": []}])
    connection = _connection()

    result = await adapter.fetch_history(
        connection=connection, locator={"team": "T1", "channel": "C1"}, limit=50
    )

    assert result == []


async def test_backfill_page_size_clamps_to_configured_default(monkeypatch):
    import oss.src.core.channels.adapters.slack.adapter as adapter_module

    monkeypatch.setattr(adapter_module, "_DEFAULT_BACKFILL_LIMIT", 10)
    adapter, transport = _adapter_with_stub([{"ok": True, "messages": []}])
    connection = _connection()

    await adapter.fetch_history(
        connection=connection,
        locator={"team": "T1", "channel": "C1"},
        limit=1000,  # requested more than the tight tier allows
    )

    sent = json.loads(transport.requests[0].content)
    assert sent["limit"] == 10
