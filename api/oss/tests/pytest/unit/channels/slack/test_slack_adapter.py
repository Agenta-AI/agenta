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
    _render_content,
    _SlackApiError,
)
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelConnectionFlags,
    ChannelEventKind,
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
from oss.src.utils.env import env

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


# --- the two-source verification secret --------------------------------------- #
#
# D35: the signing secret is per APP, not per connection. A customer-owned
# connection carries its own in `data`; a hosted one carries none at all --
# that field belongs to the deployment's configuration. Both directions are
# exercised here, deliberately, because a branch taken one way only is a
# branch nobody tested.


def _hosted_connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="slack-hosted-connection",
        channel="slack",
        external_key=uuid4(),
        data={"bot_token": "xoxb-fake", "bot_user_id": "UBOT1", "team_id": "T1"},
        flags=ChannelConnectionFlags(is_hosted=True, is_verified=True),
    )


async def test_customer_owned_connection_verifies_against_its_own_stored_secret(
    monkeypatch,
):
    monkeypatch.setattr(env.channels.slack, "signing_secret", None)

    connection = _connection(signing_secret="row-secret")
    adapter = SlackAdapter()
    body = json.dumps({"api_app_id": "A1", "team_id": "T1"}).encode()
    headers = _signed_request(body, secret="row-secret")

    identity = await adapter.verify_signature(
        request=_request(body, headers=headers), connection=connection
    )

    assert identity == "T1"


async def test_hosted_connection_verifies_against_the_deployment_secret_not_the_row(
    monkeypatch,
):
    monkeypatch.setattr(env.channels.slack, "signing_secret", "hosted-secret")

    connection = _hosted_connection()
    adapter = SlackAdapter()
    body = json.dumps({"api_app_id": "A1", "team_id": "T1"}).encode()
    headers = _signed_request(body, secret="hosted-secret")

    identity = await adapter.verify_signature(
        request=_request(body, headers=headers), connection=connection
    )

    assert identity == "T1"

    # The row itself carries no signing_secret at all -- completeness, not a
    # connection waiting to be finished.
    assert "signing_secret" not in (connection.data or {})


async def test_hosted_connection_with_no_signing_secret_is_never_treated_as_unconfigured(
    monkeypatch,
):
    """A missing `signing_secret` field on a hosted row must never read as
    "not set up yet" -- that would refuse every hosted connection, silently,
    which this project keeps rediscovering as its most common defect shape."""

    monkeypatch.setattr(env.channels.slack, "signing_secret", "hosted-secret")

    connection = _hosted_connection()
    assert connection.data is not None
    assert "signing_secret" not in connection.data

    adapter = SlackAdapter()
    body = json.dumps({"api_app_id": "A1", "team_id": "T1"}).encode()
    headers = _signed_request(body, secret="hosted-secret")

    # Does not raise ChannelSignatureInvalid despite the field being absent.
    identity = await adapter.verify_signature(
        request=_request(body, headers=headers), connection=connection
    )
    assert identity == "T1"


async def test_hosted_connection_refuses_when_the_deployment_also_has_no_secret(
    monkeypatch,
):
    """The one case that IS unconfigured: no row secret (by design) and no
    deployment secret either. Refuses like any other bad signature -- it
    must not silently accept an unverifiable request."""

    monkeypatch.setattr(env.channels.slack, "signing_secret", None)

    connection = _hosted_connection()
    adapter = SlackAdapter()
    body = json.dumps({"api_app_id": "A1", "team_id": "T1"}).encode()
    headers = _signed_request(body, secret="anything")

    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(
            request=_request(body, headers=headers), connection=connection
        )


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


async def test_parse_event_ignores_our_own_indicator_edit():
    """The bot-echo cascade. Editing "Working…" into the answer comes back as
    a `message_changed` whose author sits in the NESTED message, so the outer
    event read as authorless human input: the adapter rooted a phantom thread
    off the edit's synthetic ts, ran a real turn, posted, edited that post,
    and went round again (observed four deep, one paid run every ~14s)."""

    connection = _connection(bot_user_id="UBOT1")
    adapter = SlackAdapter()
    body = _event_callback(
        {
            "channel": "C1",
            "subtype": "message_changed",
            "ts": "2.2",
            "message": {"user": "UBOT1", "text": "the answer", "ts": "1.1"},
        }
    )

    assert await adapter.parse_event(body=body, connection=connection) is None


@pytest.mark.parametrize("subtype", ["message_changed", "message_deleted"])
async def test_parse_event_drops_edit_and_delete_subtypes(subtype):
    """No path processes an edit or a deletion, so even a human's edit must
    not enter as fresh input — it would re-run a turn already answered."""

    adapter = SlackAdapter()
    body = _event_callback(
        {
            "channel": "C1",
            "subtype": subtype,
            "ts": "2.2",
            "message": {
                "user": "U1",
                "text": "<@UBOT1> rethought question",
                "ts": "1.1",
            },
        }
    )

    assert await adapter.parse_event(body=body) is None


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


# --- parse_event: block_actions ------------------------------------------- #


def _block_actions_body(**overrides) -> bytes:
    from urllib.parse import urlencode

    payload = {
        "type": "block_actions",
        "team": {"id": "T1"},
        "user": {"id": "U1"},
        "container": {"channel_id": "C1", "message_ts": "1000.1"},
        "message": {"thread_ts": "1000.1"},
        "actions": [
            {
                "action_id": "approve_button",
                "value": "approve",
                "type": "button",
                "action_ts": "1700000000.000100",
            }
        ],
    }
    payload.update(overrides)
    return urlencode({"payload": json.dumps(payload)}).encode()


async def test_parse_event_handles_block_actions_and_extracts_the_token():
    adapter = SlackAdapter()

    event = await adapter.parse_event(body=_block_actions_body())

    assert event is not None
    assert event.kind == ChannelEventKind.ACTION
    assert event.processed.content == [{"type": "text", "text": "approve"}]
    assert event.addressed is True


async def test_parse_event_block_actions_locator_comes_from_container_not_event():
    """A `block_actions` payload has no `event` key at all -- the locator
    must come from `container`/`team`."""

    adapter = SlackAdapter()

    event = await adapter.parse_event(body=_block_actions_body())

    assert event.external_locator == {
        "team": "T1",
        "channel": "C1",
        "thread_ts": "1000.1",
    }


async def test_parse_event_block_actions_external_id_is_the_actions_own_id():
    """Redelivery of the SAME click reuses the same external_id -- a
    dedup-by-insert against it writes no second row."""

    adapter = SlackAdapter()

    first = await adapter.parse_event(body=_block_actions_body())
    second = await adapter.parse_event(body=_block_actions_body())

    assert first.external_id == second.external_id


async def test_parse_event_block_actions_external_id_is_not_the_message_ts():
    adapter = SlackAdapter()

    event = await adapter.parse_event(body=_block_actions_body())

    assert "1000.1" not in event.external_id


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

    # enterprise_id rides along even for a per-workspace install -- "" not
    # absent, so compose_external_key's three declared connection fields
    # (api_app_id, enterprise_id, team_id) are all present in the locator.
    assert discovered == {"enterprise_id": "", "team_id": "T1", "bot_user_id": "UBOT1"}
    sent_auth = transport.requests[0].headers["authorization"]
    assert sent_auth == "Bearer xoxb-good"


async def test_verify_connection_discriminator_mirrors_ingress_exactly():
    """The bug this fixes: creating a Slack connection with exactly the
    three fields the declaration asks a human for (api_app_id, enterprise_id,
    team_id) used to fail before a row was written, because enterprise_id
    was filtered out for being falsy. `verify_connection`'s discriminator
    must match `_connection_discriminator`'s own contract: exactly one of
    enterprise_id/team_id populated, the other empty -- not merely present."""

    adapter, _ = _adapter_with_stub([{"ok": True, "team_id": "T1", "user_id": "U1"}])

    discovered = await adapter.verify_connection(
        connection=_create_stub(),
        credentials={"bot_token": "xoxb-good"},
    )

    assert discovered["team_id"] == "T1"
    assert discovered["enterprise_id"] == ""


async def test_verify_connection_discriminator_for_an_org_wide_install():
    """auth.test on an org-installed token reports is_enterprise_install
    and enterprise_id; team_id must be the empty half, not T1 -- storing a
    team id there while the ingress composes "" for an org-wide event would
    be a key mismatch, which surfaces as a bare 401 indistinguishable from a
    bad secret."""

    adapter, _ = _adapter_with_stub(
        [
            {
                "ok": True,
                "is_enterprise_install": True,
                "enterprise_id": "E1",
                "user_id": "U1",
            }
        ]
    )

    discovered = await adapter.verify_connection(
        connection=_create_stub(),
        credentials={"bot_token": "xoxb-good"},
    )

    assert discovered["enterprise_id"] == "E1"
    assert discovered["team_id"] == ""


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


async def test_button_value_reaches_slack_as_the_blocks_own_value():
    """F13: the renderer used to send the button's `id` as Slack's `value`,
    so whatever token a caller put on the button never reached Slack, and a
    click could never carry it back."""

    adapter, transport = _adapter_with_stub([{"ok": True, "channel": "C1", "ts": "1"}])
    connection = _connection()

    await adapter.post_message(
        connection=connection,
        locator={"channel": "C1"},
        content=[
            {"type": "button", "id": "0", "label": "Approve", "value": "approve"},
            {"type": "button", "id": "1", "label": "Deny", "value": "deny"},
        ],
        idempotency_key=uuid4(),
    )

    sent = json.loads(transport.requests[0].content)
    elements = sent["blocks"][0]["elements"]
    assert {e["value"] for e in elements} == {"approve", "deny"}


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


def test_empty_text_emits_no_section_block():
    """Slack rejects a section whose mrkdwn text is empty, and rejects the
    whole payload with it. The guard used to be `if texts:` — a list holding
    one empty string is truthy, so an empty fold rendered exactly the block
    Slack refuses. The fallback text keeps its `" "`; the blocks go away."""

    text, blocks = _render_content([{"type": "text", "text": ""}])

    assert blocks == []
    assert text == " "


async def test_post_message_with_no_answer_text_sends_no_blocks():
    adapter, transport = _adapter_with_stub([{"ok": True, "channel": "C1", "ts": "1"}])

    await adapter.post_message(
        connection=_connection(),
        locator={"channel": "C1"},
        content=[{"type": "text", "text": ""}],
        idempotency_key=uuid4(),
    )

    assert not json.loads(transport.requests[0].content).get("blocks")


async def test_a_blocks_rejection_retries_the_same_message_text_only():
    """Last-resort guard: an answer is worth more than its formatting. The
    rejected payload is logged verbatim, because a rejection we cannot see the
    shape of is a rejection we cannot fix."""

    adapter, transport = _adapter_with_stub(
        [
            {"ok": False, "error": "invalid_blocks"},
            {"ok": True, "channel": "C1", "ts": "1"},
        ]
    )

    receipt = await adapter.post_message(
        connection=_connection(),
        locator={"channel": "C1"},
        content=[{"type": "text", "text": "the answer"}],
        idempotency_key=uuid4(),
    )

    assert receipt == {"channel": "C1", "ts": "1"}
    assert len(transport.requests) == 2
    retried = json.loads(transport.requests[1].content)
    assert "blocks" not in retried  # _call drops None params
    assert retried["text"] == "the answer"


async def test_a_rejection_that_is_not_about_blocks_is_not_retried():
    """The fallback must not turn every Slack error into a second call —
    `channel_not_found` fails the same way twice and hides the real cause."""

    adapter, transport = _adapter_with_stub(
        [{"ok": False, "error": "channel_not_found"}]
    )

    with pytest.raises(_SlackApiError):
        await adapter.post_message(
            connection=_connection(),
            locator={"channel": "C1"},
            content=[{"type": "text", "text": "the answer"}],
            idempotency_key=uuid4(),
        )

    assert len(transport.requests) == 1


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


# --- hosted-connection declaration narrowing ---------------------------------- #


async def test_customer_owned_connection_declares_native_commands():
    adapter = SlackAdapter()

    capabilities = await adapter.fetch_capabilities(connection=_connection())

    assert capabilities.addressing.commands.native is True


async def test_hosted_connection_declares_no_native_commands():
    """One app, shared by every workspace that installed it -- it cannot
    offer a per-customer command surface. There is no toggle to hide yet, so
    this is the declaration a later surface must respect."""

    adapter = SlackAdapter()

    capabilities = await adapter.fetch_capabilities(connection=_hosted_connection())

    assert capabilities.addressing.commands.native is False


async def test_hosted_connection_with_full_scopes_still_declares_backfill():
    adapter = SlackAdapter()
    connection = _hosted_connection()
    connection.data["scopes"] = ["channels:history", "chat:write"]

    capabilities = await adapter.fetch_capabilities(connection=connection)

    assert capabilities.fill.backfill.supported is True
    assert capabilities.fill.forwardfill.supported is True


async def test_hosted_connection_missing_the_history_scope_declares_no_backfill():
    """A workspace can decline a scope at install; what it declined, this
    connection never actually has, so the declaration must say so rather
    than promise a fetch that will 403."""

    adapter = SlackAdapter()
    connection = _hosted_connection()
    connection.data["scopes"] = ["chat:write"]  # channels:history declined

    capabilities = await adapter.fetch_capabilities(connection=connection)

    assert capabilities.fill.backfill.supported is False
    assert capabilities.fill.forwardfill.supported is False


# --- hosted_setup_available ---------------------------------------------------- #


async def test_hosted_setup_available_follows_the_deployment_configuration(
    monkeypatch,
):
    adapter = SlackAdapter()

    monkeypatch.setattr(env.channels.slack, "client_id", None)
    monkeypatch.setattr(env.channels.slack, "client_secret", None)
    monkeypatch.setattr(env.channels.slack, "signing_secret", None)
    assert adapter.hosted_setup_available() is False

    monkeypatch.setattr(env.channels.slack, "client_id", "id")
    monkeypatch.setattr(env.channels.slack, "client_secret", "secret")
    monkeypatch.setattr(env.channels.slack, "signing_secret", "sig")
    assert adapter.hosted_setup_available() is True


# --- detect_deactivation ------------------------------------------------------- #


async def test_detect_deactivation_true_for_app_uninstalled():
    adapter = SlackAdapter()
    body = _event_callback({"type": "app_uninstalled"})

    assert await adapter.detect_deactivation(body=body) is True


async def test_detect_deactivation_true_for_tokens_revoked():
    adapter = SlackAdapter()
    body = _event_callback({"type": "tokens_revoked"})

    assert await adapter.detect_deactivation(body=body) is True


async def test_detect_deactivation_false_for_an_ordinary_message():
    adapter = SlackAdapter()
    body = _event_callback({"type": "message", "channel": "C1", "text": "hi"})

    assert await adapter.detect_deactivation(body=body) is False


async def test_detect_deactivation_false_for_non_event_callback_payloads():
    adapter = SlackAdapter()
    body = json.dumps({"type": "url_verification", "challenge": "x"}).encode()

    assert await adapter.detect_deactivation(body=body) is False


# --- revoke_installation -------------------------------------------------------- #


async def test_revoke_installation_is_a_no_op_for_a_customer_owned_connection():
    adapter, transport = _adapter_with_stub([])

    notice = await adapter.revoke_installation(connection=_connection())

    assert notice is None
    assert transport.requests == []


async def test_revoke_installation_calls_auth_revoke_for_a_hosted_connection():
    adapter, transport = _adapter_with_stub([{"ok": True}])

    notice = await adapter.revoke_installation(connection=_hosted_connection())

    assert notice is not None and "revoked" in notice.lower()
    assert transport.requests[0].url.path.endswith("/auth.revoke")


async def test_revoke_installation_still_returns_a_notice_if_slack_rejects_the_call():
    """Best-effort: the row is archived on our side regardless of whether
    the platform call succeeds."""

    adapter, _ = _adapter_with_stub([{"ok": False, "error": "invalid_auth"}])

    notice = await adapter.revoke_installation(connection=_hosted_connection())

    assert notice is not None
