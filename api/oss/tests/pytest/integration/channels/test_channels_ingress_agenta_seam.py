"""The full seam for agenta: a real router, service and DAO, into a real
table. Only `resolve_project` is faked -- the one external boundary
(the API key store) this file is not testing; every other AgentaAdapter
method is real.

Mirrors `test_channels_ingress_seam.py`'s own framing exactly, one channel
over: a signed post must write *exactly one* `channel_inbox_events` row.
"""

from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import text

from oss.src.apis.fastapi.channels.ingress import ChannelsIngressRouter
from oss.src.core.channels.adapters.agenta.adapter import AgentaAdapter
from oss.src.core.channels.adapters.agenta.capabilities import (
    fetch_agenta_capabilities,
)
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import ChannelConnectionCreate, ChannelKeyGrain
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.utils import compose_external_key
from oss.src.dbs.postgres.channels.dao import ChannelsDAO

pytestmark = pytest.mark.integration

GOOD_KEY = "prefix.goodkey"


async def _row_count(engine, project_id: UUID, external_id: str) -> int:
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
async def seam(channels_scope):
    engine = channels_scope["engine"]
    project_id = channels_scope["project_id"]

    async def resolve_project(raw_key: str):
        return str(project_id) if raw_key == GOOD_KEY else None

    dao = ChannelsDAO(engine=engine)
    adapter = AgentaAdapter(channels_dao=dao, resolve_project=resolve_project)
    registry = ChannelAdapterRegistry(adapters={"agenta": adapter})

    external_key = compose_external_key(
        fetch_agenta_capabilities(),
        ChannelKeyGrain.CONNECTION,
        {"project": str(project_id), "bot": "support"},
    )
    await dao.create_connection(
        project_id=project_id,
        user_id=channels_scope["user_id"],
        connection=ChannelConnectionCreate(
            channel="agenta",
            external_key=external_key,
            slug="seam-agenta-connection",
            data={"connection_locator": {"project": str(project_id), "bot": "support"}},
        ),
    )

    service = ChannelsService(channels_dao=dao, adapter_registry=registry)

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
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        yield {
            "client": client,
            "engine": engine,
            "project_id": project_id,
        }


def _body(**overrides):
    payload = {"project": None, "bot": "support", "user": "U1", "text": "hello"}
    payload.update(overrides)
    return payload


async def test_signed_post_writes_exactly_one_row_and_acks_202(seam):
    import json

    body = _body(project=str(seam["project_id"]), id="msg-1")

    response = await seam["client"].post(
        "/channels/agenta/events/",
        headers={"Authorization": f"ApiKey {GOOD_KEY}"},
        content=json.dumps(body).encode(),
    )

    assert response.status_code == 202, response.text
    assert await _row_count(seam["engine"], seam["project_id"], "msg-1") == 1


async def test_unsigned_request_is_rejected_and_writes_nothing(seam):
    import json

    body = _body(project=str(seam["project_id"]), id="msg-2")

    response = await seam["client"].post(
        "/channels/agenta/events/",
        content=json.dumps(body).encode(),
    )

    assert response.status_code == 401
    assert await _row_count(seam["engine"], seam["project_id"], "msg-2") == 0


async def test_redelivery_writes_no_second_row(seam):
    import json

    body = _body(project=str(seam["project_id"]), id="msg-3")

    for _ in range(3):
        response = await seam["client"].post(
            "/channels/agenta/events/",
            headers={"Authorization": f"ApiKey {GOOD_KEY}"},
            content=json.dumps(body).encode(),
        )
        assert response.status_code == 202, response.text

    assert await _row_count(seam["engine"], seam["project_id"], "msg-3") == 1
