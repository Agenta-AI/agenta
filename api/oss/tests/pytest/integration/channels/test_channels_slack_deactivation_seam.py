"""`app_uninstalled` over the real ingress: deactivates the connection,
leaves its grants, spaces and threads in place. Same composition as
`test_channels_ingress_slack_seam.py` -- the real ChannelsIngressRouter,
the real SlackAdapter, the real ChannelsDAO -- because a test that builds
its own registry proves nothing about what the composition root wires.

WRITTEN BUT NOT RUN in this worktree: needs local Docker Postgres
(`channels_scope` fixture), which is not available here.
"""

import hashlib
import hmac
import json
import time
import uuid
from typing import Dict

import httpx
import pytest
from sqlalchemy import text

from oss.src.apis.fastapi.channels.ingress import ChannelsIngressRouter
from oss.src.core.channels.adapters.slack.adapter import SlackAdapter
from oss.src.core.channels.adapters.slack.capabilities import fetch_slack_capabilities
from oss.src.core.channels.dtos import (
    ChannelConnectionCreate,
    ChannelConnectionFlags,
    ChannelKeyGrain,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelNotSupported
from oss.src.core.channels.utils import compose_external_key
from oss.src.dbs.postgres.channels.dao import ChannelsDAO

pytestmark = pytest.mark.integration

SIGNING_SECRET = "test-signing-secret"
API_APP_ID = "A1"


def _signed_headers(body: bytes, *, secret: str = SIGNING_SECRET) -> Dict[str, str]:
    timestamp = str(int(time.time()))
    signed_bytes = f"v0:{timestamp}:".encode() + body
    signature = (
        "v0=" + hmac.new(secret.encode(), signed_bytes, hashlib.sha256).hexdigest()
    )
    return {"x-slack-signature": signature, "x-slack-request-timestamp": timestamp}


def _app_uninstalled_body(*, team_id: str) -> bytes:
    return json.dumps(
        {
            "type": "event_callback",
            "api_app_id": API_APP_ID,
            "team_id": team_id,
            "event": {"type": "app_uninstalled"},
        }
    ).encode()


class _Registry:
    def __init__(self, adapters):
        self._adapters = adapters

    def get(self, channel: str):
        if channel not in self._adapters:
            raise ChannelNotSupported(channel=channel)
        return self._adapters[channel]


async def _fetch_row(engine, project_id, connection_id):
    async with engine.session() as session:
        result = await session.execute(
            text(
                "SELECT flags FROM channel_connections "
                "WHERE project_id = :project_id AND id = :id"
            ),
            {"project_id": project_id, "id": connection_id},
        )
        return result.mappings().one()


@pytest.fixture
async def deactivation_seam(channels_scope):
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
            slug="slack-deactivation-seam",
            data={
                "connection_locator": {
                    "api_app_id": API_APP_ID,
                    "enterprise_id": "",
                    "team_id": team_id,
                },
                "bot_token": "xoxb-fake",
            },
            flags=ChannelConnectionFlags(
                is_active=True, is_hosted=True, is_verified=True
            ),
        ),
    )

    # A space, so "leaves grants, spaces and threads in place" has something
    # to check survived. Through the real DAO, not raw SQL -- the same
    # discipline as the connection above.
    await dao.create_space(
        project_id=project_id,
        user_id=channels_scope["user_id"],
        space=ChannelSpaceCreate(
            connection_id=connection.id,
            kind=ChannelSpaceKind.TOPIC,
            external_key=uuid.uuid4(),
            data=ChannelSpaceData(external_locator={"team": team_id, "channel": "C1"}),
        ),
    )

    adapter = SlackAdapter(http_client=httpx.AsyncClient())
    registry = _Registry({"slack": adapter})
    service = ChannelsService(channels_dao=dao, adapter_registry=registry)

    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(
        ChannelsIngressRouter(
            channels_service=service, adapter_registry=registry, dispatch_task=None
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
            "connection_id": connection.id,
        }


async def test_app_uninstalled_deactivates_the_connection(deactivation_seam):
    body = _app_uninstalled_body(team_id=deactivation_seam["team_id"])
    headers = _signed_headers(body)

    response = await deactivation_seam["client"].post(
        "/channels/slack/events/", headers=headers, content=body
    )

    assert response.status_code == 202, response.text

    row = await _fetch_row(
        deactivation_seam["engine"],
        deactivation_seam["project_id"],
        deactivation_seam["connection_id"],
    )
    assert row["flags"]["is_active"] is False


async def test_app_uninstalled_leaves_spaces_untouched(deactivation_seam):
    body = _app_uninstalled_body(team_id=deactivation_seam["team_id"])
    headers = _signed_headers(body)

    await deactivation_seam["client"].post(
        "/channels/slack/events/", headers=headers, content=body
    )

    async with deactivation_seam["engine"].session() as session:
        result = await session.execute(
            text(
                "SELECT count(*) FROM channel_spaces "
                "WHERE project_id = :project_id AND connection_id = :connection_id"
            ),
            {
                "project_id": deactivation_seam["project_id"],
                "connection_id": deactivation_seam["connection_id"],
            },
        )
        assert result.scalar_one() == 1
