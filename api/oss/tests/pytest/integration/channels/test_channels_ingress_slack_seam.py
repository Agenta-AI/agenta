"""The C1 seam (test_channels_ingress_seam.py), replayed with the REAL
SlackAdapter instead of a fake — proves the checkpoint's three ingress
behaviours hold when the thing standing in for "the platform" is this
package's own signature verification and event parsing, not an
assert-what-I-assumed fake.

WRITTEN BUT NOT RUN in this worktree: needs local Docker Postgres
(`channels_scope` fixture), which is not available here.
"""

import hashlib
import hmac
import json
import time
from typing import Dict
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import text

from oss.src.apis.fastapi.channels.ingress import ChannelsIngressRouter
from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.core.channels.adapters.slack.capabilities import fetch_slack_capabilities
from oss.src.core.channels.dtos import (
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelConnectionCreate,
    ChannelGrantCreate,
    ChannelGrantData,
    ChannelGrantEffect,
    ChannelInboxEventQuery,
    ChannelKeyGrain,
    ChannelSpaceKind,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelNotSupported
from oss.src.core.channels.utils import compose_external_key
from oss.src.dbs.postgres.channels.dao import ChannelsDAO

pytestmark = pytest.mark.integration

SIGNING_SECRET = "test-signing-secret"
API_APP_ID = "A1"


def _slack_event_body(*, team_id: str, event_ts: str) -> bytes:
    return json.dumps(
        {
            "type": "event_callback",
            "api_app_id": API_APP_ID,
            "team_id": team_id,
            "event": {
                "channel": "C1",
                "user": "U1",
                "text": "~agent hello",
                "ts": event_ts,
            },
        }
    ).encode()


def _slack_dm_event_body(*, team_id: str, event_ts: str, text: str) -> bytes:
    """channel_type: "im" -- the shape `classify_space_kind` reads as a DM,
    not a channel message."""

    return json.dumps(
        {
            "type": "event_callback",
            "api_app_id": API_APP_ID,
            "team_id": team_id,
            "event": {
                "channel": "D1",
                "channel_type": "im",
                "user": "U1",
                "text": text,
                "ts": event_ts,
            },
        }
    ).encode()


def _signed_headers(body: bytes, *, secret: str = SIGNING_SECRET) -> Dict[str, str]:
    timestamp = str(int(time.time()))
    signed_bytes = f"v0:{timestamp}:".encode() + body
    signature = (
        "v0=" + hmac.new(secret.encode(), signed_bytes, hashlib.sha256).hexdigest()
    )
    return {"x-slack-signature": signature, "x-slack-request-timestamp": timestamp}


class _Registry:
    def __init__(self, adapters):
        self._adapters = adapters

    def get(self, channel: str):
        if channel not in self._adapters:
            raise ChannelNotSupported(channel=channel)
        return self._adapters[channel]


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
async def slack_seam(channels_scope):
    engine = channels_scope["engine"]
    project_id = channels_scope["project_id"]
    team_id = channels_scope["external_id"]

    dao = ChannelsDAO(engine=engine)
    external_key = compose_external_key(
        fetch_slack_capabilities(),
        ChannelKeyGrain.CONNECTION,
        {"api_app_id": API_APP_ID, "enterprise_id": "", "team_id": team_id},
    )
    connection = await dao.create_connection(
        project_id=project_id,
        user_id=channels_scope["user_id"],
        connection=ChannelConnectionCreate(
            channel="slack",
            external_key=external_key,
            slug="slack-seam-connection",
            data={
                "connection_locator": {
                    "api_app_id": API_APP_ID,
                    "enterprise_id": "",
                    "team_id": team_id,
                },
                "signing_secret": SIGNING_SECRET,
                "bot_token": "xoxb-fake",
            },
        ),
    )

    # Registered exactly as the composition root registers it: one shared
    # instance holding no connection. Constructing it WITH one would test a
    # shape nothing builds, which is how a total ingress failure once stayed
    # green here.
    adapter = SlackAdapter(http_client=httpx.AsyncClient())
    registry = _Registry({"slack": adapter})

    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=registry,
    )

    from fastapi import FastAPI

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
            "dao": dao,
            "service": service,
            "project_id": project_id,
            "connection_id": connection.id,
            "user_id": channels_scope["user_id"],
            "team_id": team_id,
        }


async def test_signed_slack_request_writes_exactly_one_row_and_acks_202(slack_seam):
    body = _slack_event_body(team_id=slack_seam["team_id"], event_ts="1.1")
    headers = _signed_headers(body)

    response = await slack_seam["client"].post(
        "/channels/slack/events/", headers=headers, content=body
    )

    assert response.status_code == 202, response.text
    assert (
        await _row_count(slack_seam["engine"], slack_seam["project_id"], "C1:1.1") == 1
    )


async def test_unsigned_slack_request_is_rejected(slack_seam):
    body = _slack_event_body(team_id=slack_seam["team_id"], event_ts="2.2")

    response = await slack_seam["client"].post("/channels/slack/events/", content=body)

    assert response.status_code == 401
    assert (
        await _row_count(slack_seam["engine"], slack_seam["project_id"], "C1:2.2") == 0
    )


async def test_redelivery_of_the_same_slack_event_writes_no_second_row(slack_seam):
    body = _slack_event_body(team_id=slack_seam["team_id"], event_ts="3.3")
    headers = _signed_headers(body)

    for _ in range(3):
        response = await slack_seam["client"].post(
            "/channels/slack/events/", headers=headers, content=body
        )
        assert response.status_code == 202, response.text

    assert (
        await _row_count(slack_seam["engine"], slack_seam["project_id"], "C1:3.3") == 1
    )


async def test_dm_through_the_real_ingress_ends_in_an_answer(slack_seam):
    """The gap this suite existed to close: nothing before this drove a real
    is_im-shaped Slack payload through the signed HTTP route against a real
    ChannelsService and a real ChannelsDAO, with a kind-level grant seeded
    ahead of time and no space row pre-created.

    Seeding the agent and the grant through `dao.create_agent`/`create_grant`
    -- the same calls `ChannelsService.create_agent`/`create_grant` make --
    rather than a raw INSERT, so the assertions exercise the write path a
    grant author actually uses, not a shape only this test could produce.
    """

    dao = slack_seam["dao"]
    project_id = slack_seam["project_id"]
    connection_id = slack_seam["connection_id"]

    agent = await dao.create_agent(
        project_id=project_id,
        user_id=slack_seam["user_id"],
        agent=ChannelAgentCreate(
            connection_id=connection_id,
            slug="triage",
            data=ChannelAgentData(
                references={"workflow_revision": {"id": str(uuid4())}}
            ),
        ),
    )
    await dao.create_grant(
        project_id=project_id,
        user_id=slack_seam["user_id"],
        grant=ChannelGrantCreate(
            agent_id=agent.id,
            effect=ChannelGrantEffect.ALLOW,
            kind=ChannelSpaceKind.PRIVATE,
            data=ChannelGrantData(),
        ),
    )

    body = _slack_dm_event_body(
        team_id=slack_seam["team_id"], event_ts="4.4", text="~triage hi there"
    )
    headers = _signed_headers(body)

    response = await slack_seam["client"].post(
        "/channels/slack/events/", headers=headers, content=body
    )

    assert response.status_code == 202, response.text
    assert await _row_count(slack_seam["engine"], project_id, "D1:4.4") == 1

    events = await dao.query_inbox_events(
        project_id=project_id,
        event=ChannelInboxEventQuery(external_id="D1:4.4"),
    )
    assert len(events) == 1
    event = events[0]
    assert event.space_id is None  # the ingress could not know it yet

    # No `channel_spaces` row exists for this DM before this call -- get_or_
    # create_space makes one on first contact, and the grant that admits it
    # names the KIND, since no space-level row could have pre-approved a DM
    # nobody had opened yet.
    resolution = await slack_seam["service"].resolve(
        project_id=project_id,
        connection_id=connection_id,
        event=event,
    )

    assert resolution is not None
    assert resolution.space.kind == ChannelSpaceKind.PRIVATE
    assert resolution.agent.id == agent.id
