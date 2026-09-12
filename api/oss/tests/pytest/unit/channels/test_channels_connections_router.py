"""Unit tests for the connections write-path routes on `ChannelsRouter`:
create/edit/archive/unarchive/setup. `ChannelsService` is an AsyncMock; this
module asserts the router's delegation and its exception-to-HTTP mapping,
never a real create/verify flow (that is `test_channels_connection_write_path.py`).
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request

from oss.src.apis.fastapi.channels.models import (
    ChannelConnectionCreateRequest,
    ChannelConnectionEditRequest,
)
from oss.src.apis.fastapi.channels.router import ChannelsRouter
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelConnectionEdit,
    ChannelSetup,
)
from oss.src.core.channels.types import (
    ChannelConnectionVerificationFailed,
)

pytestmark = pytest.mark.asyncio


def _make_request(project_id, user_id, method="POST") -> Request:
    app = FastAPI()
    scope = {
        "type": "http",
        "method": method,
        "path": "/channels/connections/",
        "headers": [],
        "app": app,
    }
    request = Request(scope)
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)
    return request


def _patched_access(allowed: bool = True):
    return patch(
        "oss.src.apis.fastapi.channels.router.check_action_access",
        new_callable=AsyncMock,
        return_value=allowed,
    )


def _router(service=None) -> ChannelsRouter:
    return ChannelsRouter(
        channels_service=service or AsyncMock(),
        adapter_registry=AsyncMock(),
    )


def _connection(connection_id=None) -> ChannelConnection:
    return ChannelConnection(
        id=connection_id or uuid4(),
        slug="acme",
        channel="slack",
        external_key=uuid4(),
        data={"connection_locator": {"team_id": "T1"}},
    )


async def test_create_channel_connection_delegates_to_the_service():
    service = AsyncMock()
    service.create_connection.return_value = _connection()
    router = _router(service)
    request = _make_request(uuid4(), uuid4())
    body = ChannelConnectionCreateRequest(
        connection=ChannelConnectionCreate(
            channel="slack",
            external_key=uuid4(),
            slug="acme",
            credentials={"bot_token": "x", "signing_secret": "y"},
        )
    )

    with _patched_access(True):
        response = await router.create_channel_connection(request, body=body)

    assert response.count == 1
    service.create_connection.assert_awaited_once()


async def test_create_channel_connection_maps_verification_failure_to_400():
    service = AsyncMock()
    service.create_connection.side_effect = ChannelConnectionVerificationFailed(
        channel="slack", message="invalid_auth"
    )
    router = _router(service)
    request = _make_request(uuid4(), uuid4())
    body = ChannelConnectionCreateRequest(
        connection=ChannelConnectionCreate(
            channel="slack", external_key=uuid4(), slug="acme"
        )
    )

    with _patched_access(True):
        with pytest.raises(HTTPException) as exc_info:
            await router.create_channel_connection(request, body=body)

    assert exc_info.value.status_code == 400


async def test_edit_channel_connection_404s_on_a_missing_connection():
    service = AsyncMock()
    service.edit_connection.return_value = None
    router = _router(service)
    request = _make_request(uuid4(), uuid4())
    connection_id = uuid4()
    body = ChannelConnectionEditRequest(
        connection=ChannelConnectionEdit(id=connection_id)
    )

    with _patched_access(True):
        with pytest.raises(HTTPException) as exc_info:
            await router.edit_channel_connection(
                request, connection_id=connection_id, body=body
            )

    assert exc_info.value.status_code == 404


async def test_edit_channel_connection_400s_on_a_path_body_id_mismatch():
    router = _router()
    request = _make_request(uuid4(), uuid4())
    body = ChannelConnectionEditRequest(connection=ChannelConnectionEdit(id=uuid4()))

    with _patched_access(True):
        with pytest.raises(HTTPException) as exc_info:
            await router.edit_channel_connection(
                request, connection_id=uuid4(), body=body
            )

    assert exc_info.value.status_code == 400


async def test_archive_channel_connection_states_nothing_changed_on_the_platform():
    connection = _connection()
    service = AsyncMock()
    service.archive_connection.return_value = connection
    service.describe_connection_teardown.return_value = (
        "Archived on our side only. We never own the customer's app, "
        "so nothing was uninstalled or removed on the platform."
    )
    router = _router(service)
    request = _make_request(uuid4(), uuid4())

    with _patched_access(True):
        response = await router.archive_channel_connection(
            request, connection_id=connection.id
        )

    assert response.connection.id == connection.id
    assert "nothing" in response.platform_notice.lower()
    service.archive_connection.assert_awaited_once()
    service.describe_connection_teardown.assert_awaited_once_with(connection=connection)


async def test_unarchive_channel_connection_404s_on_a_missing_connection():
    service = AsyncMock()
    service.unarchive_connection.return_value = None
    router = _router(service)
    request = _make_request(uuid4(), uuid4())

    with _patched_access(True):
        with pytest.raises(HTTPException) as exc_info:
            await router.unarchive_channel_connection(request, connection_id=uuid4())

    assert exc_info.value.status_code == 404


async def test_fetch_channel_connection_setup_delegates_and_builds_the_request_url():
    connection = _connection()
    service = AsyncMock()
    service.fetch_connection.return_value = connection
    service.get_connection_setup.return_value = ChannelSetup()
    router = _router(service)
    request = _make_request(uuid4(), uuid4(), method="GET")

    with _patched_access(True):
        response = await router.fetch_channel_connection_setup(
            request, connection_id=connection.id
        )

    assert response.count == 1
    _, kwargs = service.get_connection_setup.await_args
    assert kwargs["request_url"].endswith("/channels/slack/events/")


async def test_fetch_channel_connection_setup_404s_on_a_missing_connection():
    service = AsyncMock()
    service.fetch_connection.return_value = None
    router = _router(service)
    request = _make_request(uuid4(), uuid4(), method="GET")

    with _patched_access(True):
        with pytest.raises(HTTPException) as exc_info:
            await router.fetch_channel_connection_setup(request, connection_id=uuid4())

    assert exc_info.value.status_code == 404
