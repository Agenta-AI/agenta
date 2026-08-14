"""In-process Slack vs bridged Slack: one conversation -- a DM arrives, a
reply is posted, that reply is edited -- driven through both arms against the
same `FakeSlackWorkspace`, asserting the outcomes agree. This is the
comparison `waves.md` calls "re-verified" that does not otherwise exist
anywhere in the tree; see the package report for that framing.

What this does NOT prove: the wire contract's generality across platforms.
Both arms terminate at the same fake Slack, so a divergence here is a
contract or bridge defect, never a platform disagreeing with itself -- but it
says nothing about a non-Slack channel, which is the real publish gate.

Needs Postgres (the vault write path, a real `ChannelsService`/DAO) and
nothing external -- no live credentials -- so this carries
`pytest.mark.integration`, matching `bridge_process`'s own tests that live
under this same `acceptance/` directory for the same reason.

WRITTEN BUT NOT RUN in this worktree: needs local Docker Postgres
(`differential_scope` fixture), which is not available here.
"""

import hashlib
import hmac
import json
import time
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI

from oss.src.apis.fastapi.channels.ingress import ChannelsIngressRouter
from oss.src.core.channels.adapters.bridge.adapter import BridgeAdapter
from oss.src.core.channels.adapters.bridge.signature import sign_outbound
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.core.channels.adapters.slack.mapping import BUTTONS_MAX
from oss.src.core.channels.dtos import (
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelAgentFlags,
    ChannelConnectionCreate,
    ChannelGrantCreate,
    ChannelGrantData,
    ChannelGrantEffect,
    ChannelGrantFlags,
    ChannelInboxEventQuery,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.secrets.services import VaultService
from oss.src.core.shared.dtos import Reference
from oss.src.dbs.postgres.channels.dao import ChannelsDAO
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.tests.pytest.acceptance.channels.differential.slack_fronting_bridge import (
    build_slack_fronting_bridge_app,
)
from oss.tests.pytest.unit.channels.slack.fake_slack import (
    FakeSlackTransport,
    FakeSlackWorkspace,
)

pytestmark = pytest.mark.integration

DM_CHANNEL_ID = "D1"
TEAM_ID = "T-differential"
API_APP_ID = "A-differential"
BOT_USER_ID = "UBOT-differential"
BOT_TOKEN = (
    "xoxb-fake-differential-do-not-echo"  # fake fixture value, never a real token
)
THREAD_TS = "1700000000.000100"

# The bridge in this suite happens to front Slack itself (see
# slack_fronting_bridge.py), so its own locator convention mirrors Slack's
# field names directly rather than inventing a fictional platform shape --
# the bridge wire contract's locator is free-form per channel regardless.
_BRIDGE_CAPABILITIES = {
    "conversation": {"units": ["thread", "space"], "default": "thread"},
    "identity": {"keys": {"space": ["channel"], "thread": ["channel", "thread_ts"]}},
}


def _sign_slack(*, body: bytes, secret: str) -> dict:
    timestamp = str(int(time.time()))
    signed_bytes = f"v0:{timestamp}:".encode() + body
    signature = (
        "v0=" + hmac.new(secret.encode(), signed_bytes, hashlib.sha256).hexdigest()
    )
    return {"x-slack-signature": signature, "x-slack-request-timestamp": timestamp}


def _slack_dm_body(*, text: str, external_id: str) -> bytes:
    return json.dumps(
        {
            "type": "event_callback",
            "team_id": TEAM_ID,
            "api_app_id": API_APP_ID,
            "event": {
                "type": "message",
                "channel": DM_CHANNEL_ID,
                "channel_type": "im",
                "user": "U-customer",
                "text": text,
                "ts": external_id,
                "thread_ts": THREAD_TS,
                "client_msg_id": external_id,
            },
        }
    ).encode()


def _bridge_envelope_body(*, text: str, external_id: str, source: str) -> bytes:
    return json.dumps(
        {
            "specversion": "1.0",
            "id": external_id,
            "type": "io.agenta.channel.message.received.v1",
            "source": source,
            "time": "2026-07-20T10:00:00Z",
            "data": {
                "space": {
                    "locator": {"channel": DM_CHANNEL_ID, "thread_ts": THREAD_TS},
                    "type": "private",
                },
                "sender": {"id": "u-customer"},
                "content": [{"type": "text", "text": text}],
                "addressed": True,
            },
        }
    ).encode()


async def _configure_agent(service, *, project_id, user_id, connection_id, locator):
    """The minimum `resolve()` needs to answer without a sigil: a configured
    space at the event's own locator, a connection-default agent, and a
    default grant tying them together -- mirrors
    `bridge_process/test_bridge_two_bridges.py`'s own helper."""

    space = await service.create_space(
        project_id=project_id,
        user_id=user_id,
        space=ChannelSpaceCreate(
            connection_id=connection_id,
            kind=ChannelSpaceKind.PRIVATE,
            external_key=uuid4(),
            data=ChannelSpaceData(external_locator=locator),
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


@pytest.fixture
async def arms(differential_scope):
    """Everything both arms share: one `FakeSlackWorkspace`, one real
    `ChannelsService` against Postgres, one core ingress app reachable over
    ASGITransport, a slack connection and a bridge connection both created
    through `create_connection` -- never a direct row insert -- and a bridge
    front ASGI app that replays deliveries against the identical fake
    through the exact `SlackAdapter` instance the in-process arm also
    drives."""

    engine = differential_scope["engine"]
    project_id = differential_scope["project_id"]
    user_id = differential_scope["user_id"]

    workspace = FakeSlackWorkspace(
        bot_token=BOT_TOKEN,
        channels=[{"id": DM_CHANNEL_ID, "name": "dm-acme", "is_im": True}],
        team_id=TEAM_ID,
        bot_user_id=BOT_USER_ID,
        api_app_id=API_APP_ID,
    )
    fake_slack_client = httpx.AsyncClient(
        transport=FakeSlackTransport(workspace), base_url="https://slack.com/api"
    )
    slack_adapter = SlackAdapter(http_client=fake_slack_client)

    # a placeholder bridge adapter for the create call below -- its
    # verify_connection is the trivial interface default and touches no
    # network, so it does not need the real delivery wiring yet
    adapters = {"slack": slack_adapter, "bridge": BridgeAdapter()}
    registry = ChannelAdapterRegistry(adapters=adapters)
    service = ChannelsService(
        channels_dao=ChannelsDAO(engine=engine),
        adapter_registry=registry,
        vault_service=VaultService(secrets_dao=SecretsDAO(engine=engine)),
    )

    slack_signing_secret = "differential-test-slack-signing-secret-fixture"
    slack_created = await service.create_connection(
        project_id=project_id,
        user_id=user_id,
        connection=ChannelConnectionCreate(
            channel="slack",
            slug="differential-slack",
            data={"api_app_id": API_APP_ID, "enterprise_id": ""},
            credentials={
                "bot_token": BOT_TOKEN,
                "signing_secret": slack_signing_secret,
            },
        ),
    )

    bridge_source = "differential-slack-front"
    bridge_created = await service.create_connection(
        project_id=project_id,
        user_id=user_id,
        connection=ChannelConnectionCreate(
            channel="bridge",
            slug="differential-bridge",
            data={
                "source": bridge_source,
                "delivery_url": "http://bridge-front/deliver",
                "capabilities": _BRIDGE_CAPABILITIES,
            },
        ),
    )
    # this is half one's own mint path, exercised end to end here too
    assert bridge_created.one_time_secret
    bridge_secret = bridge_created.one_time_secret

    # the bridge front app plays the far side of the wire: its own Slack
    # integration reuses the exact SlackAdapter instance -- and the same
    # hydrated connection -- the in-process arm drives directly
    bridge_front_slack_connection = await service.fetch_connection(
        project_id=project_id, connection_id=slack_created.id
    )
    bridge_front_app = build_slack_fronting_bridge_app(
        secret=bridge_secret,
        slack_adapter=slack_adapter,
        slack_connection=bridge_front_slack_connection,
    )
    bridge_front_client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=bridge_front_app),
        base_url="http://bridge-front",
    )
    # swap the placeholder for the real front -- `adapters` is the exact
    # dict object the registry holds, so this mutation is visible to
    # `service` without rebuilding it
    adapters["bridge"] = BridgeAdapter(http_client=bridge_front_client)

    core_app = FastAPI()
    core_app.include_router(
        ChannelsIngressRouter(
            channels_service=service, adapter_registry=registry, dispatch_task=None
        ).router,
        prefix="/channels",
    )
    core_client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=core_app), base_url="http://testserver"
    )

    await _configure_agent(
        service,
        project_id=project_id,
        user_id=user_id,
        connection_id=slack_created.id,
        locator={"team": TEAM_ID, "channel": DM_CHANNEL_ID, "thread_ts": THREAD_TS},
    )
    await _configure_agent(
        service,
        project_id=project_id,
        user_id=user_id,
        connection_id=bridge_created.id,
        locator={"channel": DM_CHANNEL_ID, "thread_ts": THREAD_TS},
    )

    slack_connection = await service.fetch_connection(
        project_id=project_id, connection_id=slack_created.id
    )
    bridge_connection = await service.fetch_connection(
        project_id=project_id, connection_id=bridge_created.id
    )

    try:
        yield {
            "service": service,
            "project_id": project_id,
            "workspace": workspace,
            "core_client": core_client,
            "slack_adapter": slack_adapter,
            "bridge_adapter": adapters["bridge"],
            "slack_connection": slack_connection,
            "bridge_connection": bridge_connection,
            "slack_signing_secret": slack_signing_secret,
            "bridge_secret": bridge_secret,
            "bridge_source": bridge_source,
        }
    finally:
        await fake_slack_client.aclose()
        await bridge_front_client.aclose()
        await core_client.aclose()


async def _ingest_and_resolve(
    arms, *, route: str, body: bytes, headers: dict, connection_id, external_id
):
    response = await arms["core_client"].post(route, headers=headers, content=body)
    assert response.status_code == 202, response.text

    events = await arms["service"].query_inbox_events(
        project_id=arms["project_id"],
        event=ChannelInboxEventQuery(
            connection_id=connection_id, external_id=external_id
        ),
    )
    assert len(events) == 1, f"expected exactly one recorded event for {external_id}"

    resolution = await arms["service"].resolve(
        project_id=arms["project_id"], connection_id=connection_id, event=events[0]
    )
    assert resolution is not None, (
        f"resolve() refused an event it should have accepted: {external_id}"
    )
    return resolution


async def test_dm_reply_and_edit_agree_between_in_process_and_bridged_slack(arms):
    workspace = arms["workspace"]

    # --- a DM arrives, through each arm's real ingress route --- #

    slack_body = _slack_dm_body(
        text="Hello, can you help me?", external_id="slack-dm-1"
    )
    slack_headers = _sign_slack(body=slack_body, secret=arms["slack_signing_secret"])
    slack_resolution = await _ingest_and_resolve(
        arms,
        route="/channels/slack/events/",
        body=slack_body,
        headers=slack_headers,
        connection_id=arms["slack_connection"].id,
        external_id="slack-dm-1",
    )

    bridge_body = _bridge_envelope_body(
        text="Hello, can you help me?",
        external_id="bridge-dm-1",
        source=f"bridge/{arms['bridge_source']}",
    )
    bridge_headers = sign_outbound(secret=arms["bridge_secret"], body=bridge_body)
    bridge_resolution = await _ingest_and_resolve(
        arms,
        route="/channels/bridge/events/",
        body=bridge_body,
        headers=bridge_headers,
        connection_id=arms["bridge_connection"].id,
        external_id="bridge-dm-1",
    )

    assert slack_resolution.thread is not None
    assert bridge_resolution.thread is not None

    # a second event at the same locator reuses the same thread, in both arms
    slack_body_2 = _slack_dm_body(text="still there?", external_id="slack-dm-2")
    slack_headers_2 = _sign_slack(
        body=slack_body_2, secret=arms["slack_signing_secret"]
    )
    slack_resolution_2 = await _ingest_and_resolve(
        arms,
        route="/channels/slack/events/",
        body=slack_body_2,
        headers=slack_headers_2,
        connection_id=arms["slack_connection"].id,
        external_id="slack-dm-2",
    )
    assert slack_resolution_2.thread.id == slack_resolution.thread.id

    bridge_body_2 = _bridge_envelope_body(
        text="still there?",
        external_id="bridge-dm-2",
        source=f"bridge/{arms['bridge_source']}",
    )
    bridge_headers_2 = sign_outbound(secret=arms["bridge_secret"], body=bridge_body_2)
    bridge_resolution_2 = await _ingest_and_resolve(
        arms,
        route="/channels/bridge/events/",
        body=bridge_body_2,
        headers=bridge_headers_2,
        connection_id=arms["bridge_connection"].id,
        external_id="bridge-dm-2",
    )
    assert bridge_resolution_2.thread.id == bridge_resolution.thread.id

    # --- a reply is posted, through each arm --- #

    reply_content = [
        {"type": "text", "text": "Thanks for reaching out! How can I help?"}
    ]
    slack_locator = slack_resolution.thread.data.external_locator
    bridge_locator = bridge_resolution.thread.data.external_locator

    slack_receipt = await arms["slack_adapter"].post_message(
        connection=arms["slack_connection"],
        locator=slack_locator,
        content=reply_content,
        idempotency_key=uuid4(),
    )
    bridge_receipt = await arms["bridge_adapter"].post_message(
        connection=arms["bridge_connection"],
        locator=bridge_locator,
        content=reply_content,
        idempotency_key=uuid4(),
    )

    assert set(slack_receipt.keys()) == {"channel", "ts"}
    assert set(bridge_receipt.keys()) == {"channel", "ts"}
    assert slack_receipt["ts"] != bridge_receipt["ts"], (
        "two distinct posts, same channel"
    )

    posted_texts = {
        workspace.messages[DM_CHANNEL_ID][slack_receipt["ts"]]["text"],
        workspace.messages[DM_CHANNEL_ID][bridge_receipt["ts"]]["text"],
    }
    assert posted_texts == {reply_content[0]["text"]}

    # --- that reply is edited, through each arm --- #

    edited_content = [
        {"type": "text", "text": "Thanks for reaching out! How can I help? (edited)"}
    ]

    slack_edit_receipt = await arms["slack_adapter"].edit_message(
        connection=arms["slack_connection"],
        external_locator=slack_receipt,
        content=edited_content,
        idempotency_key=uuid4(),
    )
    bridge_edit_receipt = await arms["bridge_adapter"].edit_message(
        connection=arms["bridge_connection"],
        external_locator=bridge_receipt,
        content=edited_content,
        idempotency_key=uuid4(),
    )

    # the edit reuses the same external locator -- no new message either side
    assert slack_edit_receipt["ts"] == slack_receipt["ts"]
    assert bridge_edit_receipt["ts"] == bridge_receipt["ts"]
    assert len(workspace.messages[DM_CHANNEL_ID]) == 2

    edited_texts = {
        workspace.messages[DM_CHANNEL_ID][slack_receipt["ts"]]["text"],
        workspace.messages[DM_CHANNEL_ID][bridge_receipt["ts"]]["text"],
    }
    assert edited_texts == {edited_content[0]["text"]}


async def test_button_degradation_agrees_between_in_process_and_bridged_slack(arms):
    """Proves the wire carries capability-driven rendering faithfully, not
    just message bytes: a button count over the declared max degrades to
    numbered text identically whichever arm posts it, because the bridge
    front replays the same, unrendered `content` list through the same
    `SlackAdapter._render_content` the in-process arm uses -- the bridge
    protocol never carries pre-rendered Block Kit, only the raw parts."""

    workspace = arms["workspace"]

    options = [
        {"type": "button", "id": f"opt{i}", "label": f"Option {i}"}
        for i in range(BUTTONS_MAX + 2)
    ]
    content = [{"type": "text", "text": "pick one"}] + options
    locator = {"channel": DM_CHANNEL_ID}

    slack_receipt = await arms["slack_adapter"].post_message(
        connection=arms["slack_connection"],
        locator=locator,
        content=content,
        idempotency_key=uuid4(),
    )
    bridge_receipt = await arms["bridge_adapter"].post_message(
        connection=arms["bridge_connection"],
        locator=locator,
        content=content,
        idempotency_key=uuid4(),
    )

    slack_message = workspace.messages[DM_CHANNEL_ID][slack_receipt["ts"]]
    bridge_message = workspace.messages[DM_CHANNEL_ID][bridge_receipt["ts"]]

    assert slack_message["text"] == bridge_message["text"]
    assert "1. Option 0" in slack_message["text"]
    # degraded means numbered text, never a Block Kit actions block
    assert slack_message["blocks"][0]["type"] == "section"
    assert bridge_message["blocks"][0]["type"] == "section"
