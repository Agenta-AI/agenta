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

import httpx
import pytest
from sqlalchemy import text

from oss.src.apis.fastapi.channels.ingress import ChannelsIngressRouter
from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.core.channels.dtos import ChannelConnection
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelNotSupported
from oss.src.core.gateway.connections.dtos import ConnectionProviderKind
from oss.src.dbs.postgres.channels.dao import ChannelsDAO

pytestmark = pytest.mark.integration

SIGNING_SECRET = "test-signing-secret"


def _connection(team_id: str) -> ChannelConnection:
    from uuid import uuid4

    return ChannelConnection(
        id=uuid4(),
        slug="slack-seam-connection",
        provider_key=ConnectionProviderKind.AGENTA,
        integration_key="slack",
        data={
            "signing_secret": SIGNING_SECRET,
            "bot_token": "xoxb-fake",
            "team_id": team_id,
        },
    )


def _slack_event_body(*, team_id: str, event_ts: str) -> bytes:
    return json.dumps(
        {
            "type": "event_callback",
            "team_id": team_id,
            "event": {
                "channel": "C1",
                "user": "U1",
                "text": "~agent hello",
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

    connection = _connection(team_id)
    adapter = SlackAdapter(connection=connection, http_client=httpx.AsyncClient())
    registry = _Registry({"slack": adapter})

    service = ChannelsService(
        channels_dao=ChannelsDAO(engine=engine),
        adapter_registry=registry,
        connections_service=None,
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
            "project_id": project_id,
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
