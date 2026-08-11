import hashlib
import hmac
import json
import time
from typing import Any, Dict, List
from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.slack.adapter import (
    SlackAdapter,
)
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelRequestContext,
    ChannelSpaceKind,
)
from oss.src.core.channels.types import (
    ChannelConnectionIncomplete,
    ChannelConnectionVerificationFailed,
    ChannelSignatureInvalid,
)
from oss.src.core.channels.utils import compose_external_key
from oss.src.core.channels.dtos import ChannelKeyGrain

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
        channel="slack",
        external_key=uuid4(),
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


def _request(body: bytes, *, headers=None) -> ChannelRequestContext:
    return ChannelRequestContext(headers=headers or {}, path="/", body=body)


# --- connection_locator -------------------------------------------------------- #


def test_connection_locator_reads_team_id_flat_from_events_api_json():
    adapter = SlackAdapter()
    body = json.dumps({"api_app_id": "A1", "team_id": "T1", "event": {}}).encode()

    assert adapter.connection_locator(request=_request(body)) == {
        "api_app_id": "A1",
        "enterprise_id": "",
        "team_id": "T1",
    }


def test_connection_locator_reads_team_id_nested_from_an_interactivity_payload():
    """Block interactivity sends form-encoded body with the JSON under
    `payload`, `team` nested rather than flat -- the shape the plain JSON
    extractor alone cannot reach."""

    from urllib.parse import urlencode

    adapter = SlackAdapter()
    interactivity_payload = json.dumps(
        {"type": "block_actions", "api_app_id": "A1", "team": {"id": "T1"}}
    )
    body = urlencode({"payload": interactivity_payload}).encode()

    assert adapter.connection_locator(request=_request(body)) == {
        "api_app_id": "A1",
        "enterprise_id": "",
        "team_id": "T1",
    }


def test_connection_locator_reads_enterprise_id_for_an_org_wide_install():
    """An org-wide Enterprise Grid install is one connection across many
    workspaces -- the discriminator is enterprise_id, and team_id is the
    sentinel, not the specific workspace this one event happened to fire in."""

    adapter = SlackAdapter()
    body = json.dumps(
        {
            "api_app_id": "A1",
            "team_id": "T-WHICHEVER-WORKSPACE",
            "enterprise_id": "E1",
            "is_enterprise_install": True,
            "event": {},
        }
    ).encode()

    assert adapter.connection_locator(request=_request(body)) == {
        "api_app_id": "A1",
        "enterprise_id": "E1",
        "team_id": "",
    }


def test_connection_locator_returns_none_with_no_api_app_id():
    adapter = SlackAdapter()
    body = json.dumps({"team_id": "T1", "event": {}}).encode()

    assert adapter.connection_locator(request=_request(body)) is None


def test_connection_locator_returns_none_with_no_team_identity_at_all():
    adapter = SlackAdapter()
    body = json.dumps({"type": "url_verification"}).encode()

    assert adapter.connection_locator(request=_request(body)) is None


# --- verify_signature -------------------------------------------------------- #


async def test_verify_signature_returns_team_id_on_success():
    connection = _connection()
    adapter = SlackAdapter()
    body = json.dumps({"api_app_id": "A1", "team_id": "T1"}).encode()
    headers = _signed_request(body)

    installation_id = await adapter.verify_signature(
        request=_request(body, headers=headers), connection=connection
    )

    assert installation_id == "T1"


async def test_verify_signature_returns_enterprise_id_for_an_org_wide_install():
    connection = _connection()
    adapter = SlackAdapter()
    body = json.dumps(
        {
            "api_app_id": "A1",
            "team_id": "T-WHICHEVER-WORKSPACE",
            "enterprise_id": "E1",
            "is_enterprise_install": True,
        }
    ).encode()
    headers = _signed_request(body)

    identity = await adapter.verify_signature(
        request=_request(body, headers=headers), connection=connection
    )

    assert identity == "E1"


async def test_verify_signature_rejects_bad_signature():
    connection = _connection()
    adapter = SlackAdapter()
    body = json.dumps({"api_app_id": "A1", "team_id": "T1"}).encode()

    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(request=_request(body), connection=connection)


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
    adapter = SlackAdapter()
    body = _event_callback({"channel": "C1", "bot_id": "B1", "text": "echo"})

    assert await adapter.parse_event(body=body) is None


async def test_parse_event_ignores_the_connections_own_bot_user_id():
    """Bot-echo filtering needs the connection's bot_user_id, which the
    adapter no longer holds on itself -- it must be readable from a
    same-instance parse_event call that passes it in explicitly."""

    connection = _connection(bot_user_id="UBOT1")
    adapter = SlackAdapter()
    body = _event_callback({"channel": "C1", "user": "UBOT1", "text": "echo"})

    assert await adapter.parse_event(body=body, connection=connection) is None


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

    assert threaded.external_locator["thread_ts"] == "1.1"
    assert "thread_ts" not in untethered.external_locator


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
        capabilities, ChannelKeyGrain.THREAD, first.external_locator
    )
    key_b = compose_external_key(
        capabilities, ChannelKeyGrain.THREAD, second.external_locator
    )

    assert key_a != key_b


# --- CONNECTION-grain identity -------------------------------------------- #


def test_connection_grain_declares_api_app_id_enterprise_id_team_id():
    """Pinned to the exact field names channel-connections.md names for
    Slack -- a future rename of these fields must break this test rather
    than silently repointing every installation at a new key."""

    from oss.src.core.channels.adapters.slack.capabilities import (
        fetch_slack_capabilities,
    )

    capabilities = fetch_slack_capabilities()

    assert capabilities.identity.keys[ChannelKeyGrain.CONNECTION] == [
        "api_app_id",
        "enterprise_id",
        "team_id",
    ]


def test_two_apps_in_one_workspace_compose_to_distinct_connection_keys():
    """A workspace id alone is wrong: two of our apps can share one
    workspace, and only api_app_id tells them apart."""

    from oss.src.core.channels.adapters.slack.capabilities import (
        fetch_slack_capabilities,
    )

    capabilities = fetch_slack_capabilities()
    adapter = SlackAdapter()

    app_a = adapter.connection_locator(
        request=_request(json.dumps({"api_app_id": "A1", "team_id": "T1"}).encode())
    )
    app_b = adapter.connection_locator(
        request=_request(json.dumps({"api_app_id": "A2", "team_id": "T1"}).encode())
    )

    key_a = compose_external_key(capabilities, ChannelKeyGrain.CONNECTION, app_a)
    key_b = compose_external_key(capabilities, ChannelKeyGrain.CONNECTION, app_b)

    assert key_a != key_b


def test_org_wide_install_composes_the_same_key_across_different_workspaces():
    """The central Enterprise Grid claim: an org-wide install is ONE
    connection, so two events from two different member workspaces must
    compose to the SAME connection key."""

    from oss.src.core.channels.adapters.slack.capabilities import (
        fetch_slack_capabilities,
    )

    capabilities = fetch_slack_capabilities()
    adapter = SlackAdapter()

    from_workspace_one = adapter.connection_locator(
        request=_request(
            json.dumps(
                {
                    "api_app_id": "A1",
                    "team_id": "T1",
                    "enterprise_id": "E1",
                    "is_enterprise_install": True,
                }
            ).encode()
        )
    )
    from_workspace_two = adapter.connection_locator(
        request=_request(
            json.dumps(
                {
                    "api_app_id": "A1",
                    "team_id": "T2",
                    "enterprise_id": "E1",
                    "is_enterprise_install": True,
                }
            ).encode()
        )
    )

    key_one = compose_external_key(
        capabilities, ChannelKeyGrain.CONNECTION, from_workspace_one
    )
    key_two = compose_external_key(
        capabilities, ChannelKeyGrain.CONNECTION, from_workspace_two
    )

    assert key_one == key_two


def test_org_wide_install_and_a_per_workspace_install_of_the_same_app_differ():
    """An org-wide install and a per-workspace install of the same app must
    not collide even though both name the same api_app_id and team_id."""

    from oss.src.core.channels.adapters.slack.capabilities import (
        fetch_slack_capabilities,
    )

    capabilities = fetch_slack_capabilities()
    adapter = SlackAdapter()

    org_wide = adapter.connection_locator(
        request=_request(
            json.dumps(
                {
                    "api_app_id": "A1",
                    "team_id": "T1",
                    "enterprise_id": "E1",
                    "is_enterprise_install": True,
                }
            ).encode()
        )
    )
    per_workspace = adapter.connection_locator(
        request=_request(json.dumps({"api_app_id": "A1", "team_id": "T1"}).encode())
    )

    key_org_wide = compose_external_key(
        capabilities, ChannelKeyGrain.CONNECTION, org_wide
    )
    key_per_workspace = compose_external_key(
        capabilities, ChannelKeyGrain.CONNECTION, per_workspace
    )

    assert key_org_wide != key_per_workspace


# --- verify_connection / build_setup_document -------------------------------- #


def _create_stub(**overrides):
    fields = {
        "channel": "slack",
        "external_key": uuid4(),
        "slug": "acme",
    }
    fields.update(overrides)
    return ChannelConnectionCreate(**fields)


async def test_verify_connection_returns_discovered_fields_on_success():
    adapter, transport = _adapter_with_stub(
        [{"ok": True, "team_id": "T1", "user_id": "UBOT1"}]
    )

    discovered = await adapter.verify_connection(
        connection=_create_stub(),
        credentials={"bot_token": "xoxb-good", "signing_secret": "sec"},
    )

    assert discovered == {"team_id": "T1", "bot_user_id": "UBOT1"}
    sent_auth = transport.requests[0].headers["authorization"]
    assert sent_auth == "Bearer xoxb-good"


async def test_verify_connection_omits_absent_discovered_fields():
    """auth.test does not return api_app_id -- "where present" means it is
    simply absent from what is returned, not defaulted to empty."""

    adapter, _ = _adapter_with_stub([{"ok": True, "team_id": "T1", "user_id": "U1"}])

    discovered = await adapter.verify_connection(
        connection=_create_stub(),
        credentials={"bot_token": "xoxb-good", "signing_secret": "sec"},
    )

    assert "api_app_id" not in discovered


async def test_verify_connection_raises_on_a_rejected_token():
    """Nothing is written on this path -- the platform's own error surfaces
    as it gave it."""

    adapter, _ = _adapter_with_stub([{"ok": False, "error": "invalid_auth"}])

    with pytest.raises(ChannelConnectionVerificationFailed):
        await adapter.verify_connection(
            connection=_create_stub(),
            credentials={"bot_token": "xoxb-bad", "signing_secret": "sec"},
        )


async def test_verify_connection_requires_a_bot_token():
    adapter = SlackAdapter()

    with pytest.raises(ChannelConnectionIncomplete):
        await adapter.verify_connection(connection=_create_stub(), credentials={})


async def test_build_setup_document_embeds_the_manifest_for_the_given_url():
    adapter = SlackAdapter()

    doc = await adapter.build_setup_document(
        request_url="https://example.com/channels/slack/events/"
    )

    assert doc is not None
    assert "https://example.com/channels/slack/events/" in doc.content
    assert "chat:write" in doc.content
    assert doc.link is not None and doc.link.startswith("https://api.slack.com/apps")


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
# Refusal-vs-empty-page and post-then-edit are asserted against the fake
# workspace instead, which sees stored state rather than only the request log.


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
