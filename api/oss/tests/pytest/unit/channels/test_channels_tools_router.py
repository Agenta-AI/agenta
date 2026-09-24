"""ChannelToolsRouter: the routes the channel agent tools call. RBAC, closed
request bodies, and the refusal mapping, over a real FastAPI app with the
tool service mocked."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.channels.tools import ChannelToolsRouter
from oss.src.core.channels.tools.dtos import (
    ChannelDestination,
    ChannelDestinationsPage,
)
from oss.src.core.channels.tools.types import (
    ChannelToolsNotFound,
    ChannelToolsRefused,
)

PROJECT_ID = uuid4()
ARTIFACT_ID = str(uuid4())


def _client(service, *, allowed=True):
    app = FastAPI()

    @app.middleware("http")
    async def _scope(request: Request, call_next):
        request.state.project_id = str(PROJECT_ID)
        request.state.user_id = str(uuid4())
        return await call_next(request)

    app.include_router(ChannelToolsRouter(tools_service=service).router)
    patcher = patch(
        "oss.src.apis.fastapi.channels.tools.check_action_access",
        new_callable=AsyncMock,
        return_value=allowed,
    )
    patcher.start()
    client = TestClient(app, raise_server_exceptions=False)
    return client, patcher


@pytest.fixture
def service():
    service = AsyncMock()
    service.list_destinations.return_value = ChannelDestinationsPage(
        destinations=[
            ChannelDestination(
                destination_id=f"dst_{uuid4().hex}",
                platform="slack",
                name="releases",
                can_post=True,
                can_read=True,
                can_search=True,
                supports_threads=True,
            )
        ]
    )
    service.is_available.return_value = True
    return service


ROUTES = [
    ("/tools/availability", {"artifact_id": ARTIFACT_ID}),
    ("/tools/destinations/query", {"artifact_id": ARTIFACT_ID}),
]


@pytest.mark.parametrize("path,body", ROUTES)
def test_tools_routes_require_run_channels(service, path, body):
    client, patcher = _client(service, allowed=False)
    try:
        response = client.post(path, json=body)
    finally:
        patcher.stop()

    assert response.status_code == 403
    service.list_destinations.assert_not_called()
    service.is_available.assert_not_called()


@pytest.mark.parametrize("path,body", ROUTES)
def test_tools_routes_reject_unknown_fields(service, path, body):
    client, patcher = _client(service)
    try:
        response = client.post(path, json={**body, "connection_id": str(uuid4())})
    finally:
        patcher.stop()

    assert response.status_code == 422
    service.list_destinations.assert_not_called()


def test_destinations_query_passes_the_project_from_the_credential(service):
    client, patcher = _client(service)
    try:
        response = client.post(
            "/tools/destinations/query",
            json={"artifact_id": ARTIFACT_ID, "query": "rel", "limit": 5},
        )
    finally:
        patcher.stop()

    assert response.status_code == 200
    kwargs = service.list_destinations.call_args.kwargs
    assert kwargs["project_id"] == PROJECT_ID
    assert str(kwargs["artifact_id"]) == ARTIFACT_ID
    assert kwargs["query"] == "rel" and kwargs["limit"] == 5


def test_destinations_response_has_no_raw_provider_ids(service):
    client, patcher = _client(service)
    try:
        body = client.post(
            "/tools/destinations/query", json={"artifact_id": ARTIFACT_ID}
        ).json()
    finally:
        patcher.stop()

    destination = body["destinations"][0]
    assert set(destination) == {
        "destination_id",
        "type",
        "platform",
        "name",
        "can_post",
        "can_read",
        "can_search",
        "supports_threads",
    }
    assert destination["destination_id"].startswith("dst_")


def test_availability_answers_the_kit(service):
    client, patcher = _client(service)
    try:
        response = client.post("/tools/availability", json={"artifact_id": ARTIFACT_ID})
    finally:
        patcher.stop()

    assert response.json() == {"available": True}


@pytest.mark.parametrize(
    "error,code",
    [
        (ChannelToolsRefused("No bot is connected to this agent."), 409),
        (ChannelToolsNotFound(), 404),
    ],
)
def test_refusals_map_to_readable_errors(service, error, code):
    service.list_destinations.side_effect = error
    client, patcher = _client(service)
    try:
        response = client.post(
            "/tools/destinations/query", json={"artifact_id": ARTIFACT_ID}
        )
    finally:
        patcher.stop()

    assert response.status_code == code
    assert response.json()["detail"] == error.message
