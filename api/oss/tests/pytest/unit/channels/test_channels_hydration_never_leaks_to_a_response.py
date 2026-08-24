"""The one regression that matters most about hydration: a credential must
never reach a route's response body, even though `ChannelsService.fetch_connection`
now hands adapters a connection with the credential merged into `data`.

`ChannelConnection.data` is a loose `Dict[str, Any]` with no redaction of its
own -- the only thing standing between a resolved credential and a JSON
response is that the write-path routes never call the hydrating
`fetch_connection`. This test does not mock that discipline away: it drives
the real `ChannelsService` (a real vault stand-in, a real create -> rotate ->
archive -> unarchive -> query -> setup sequence) through the real
`ChannelsRouter`, including `fetch_channel_connection_setup`, which *does*
hydrate. If any of these routes started echoing the hydrated form, this is
where it would show up.
"""

from typing import Any, Dict
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, Request

from oss.src.apis.fastapi.channels.models import (
    ChannelConnectionCreateRequest,
    ChannelConnectionEditRequest,
    ChannelConnectionQueryRequest,
)
from oss.src.apis.fastapi.channels.router import ChannelsRouter
from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import ChannelConnection, ChannelConnectionEdit
from oss.src.core.channels.service import ChannelsService

pytestmark = pytest.mark.asyncio

_CANARY_TOKEN = "xoxb-response-leak-canary-do-not-echo"
_CANARY_SECRET = "response-leak-signing-secret-canary-do-not-echo"
_CANARY_ROTATED_TOKEN = "xoxb-response-leak-canary-rotated-do-not-echo"


def _capabilities():
    return normalise_capabilities(
        {
            "channel": "slack",
            "identity": {"keys": {"connection": ["api_app_id", "team_id"]}},
        }
    )


class _FakeAdapter(ChannelAdapterInterface):
    channel = "slack"

    async def fetch_capabilities(self, *, connection=None):
        return _capabilities()

    def connection_locator(self, *, request):
        raise NotImplementedError

    async def verify_signature(self, *, request, connection):
        raise NotImplementedError

    async def parse_event(self, *, body, connection=None):
        raise NotImplementedError

    async def post_message(self, *, connection, locator, content, idempotency_key):
        raise NotImplementedError

    async def edit_message(
        self, *, connection, external_locator, content, idempotency_key
    ):
        raise NotImplementedError

    async def discover_spaces(self, *, connection):
        raise NotImplementedError

    async def fetch_history(self, *, connection, locator, limit):
        raise NotImplementedError

    async def verify_connection(self, *, connection, credentials):
        return {"team_id": "T1", "api_app_id": "A1"}

    async def build_setup_document(self, *, request_url):
        return None


class _FakeSecret:
    def __init__(self, *, id: UUID, data: Any):
        self.id = id
        self.data = data


class _FakeVaultService:
    """Round-trips through the real `ChannelSecretDTO` shape, same as the
    write path's own fake -- the point is a real resolve, not a stub."""

    def __init__(self):
        self._store: Dict[UUID, _FakeSecret] = {}

    async def create_secret(self, *, project_id, create_secret_dto):
        secret_id = uuid4()
        self._store[secret_id] = _FakeSecret(
            id=secret_id, data=create_secret_dto.secret.data
        )
        return self._store[secret_id]

    async def update_secret(self, *, secret_id, project_id, update_secret_dto):
        if secret_id not in self._store:
            return None
        self._store[secret_id] = _FakeSecret(
            id=secret_id, data=update_secret_dto.secret.data
        )
        return self._store[secret_id]

    async def get_secret_by_id(self, *, secret_id, project_id=None):
        return self._store.get(secret_id)


class _FakeConnectionsDAO:
    """An in-memory stand-in for `channel_connections`, just enough of
    `ChannelsDAOInterface` to drive create/rotate/archive/unarchive/query/fetch
    through the router exactly as the real DAO would."""

    def __init__(self):
        self._store: Dict[UUID, ChannelConnection] = {}

    async def create_connection(self, *, project_id, user_id, connection):
        row = ChannelConnection(
            id=uuid4(),
            channel=connection.channel,
            external_key=connection.external_key,
            slug=connection.slug,
            name=connection.name,
            description=connection.description,
            tags=connection.tags,
            meta=connection.meta,
            data=connection.data,
            flags=connection.flags,
        )
        self._store[row.id] = row
        return row

    async def fetch_connection(self, *, project_id, connection_id):
        return self._store.get(connection_id)

    async def edit_connection(self, *, project_id, user_id, connection):
        existing = self._store.get(connection.id)
        if existing is None:
            return None
        updated = existing.model_copy(
            update={
                "name": connection.name or existing.name,
                "data": connection.data
                if connection.data is not None
                else existing.data,
            }
        )
        self._store[updated.id] = updated
        return updated

    async def archive_connection(self, *, project_id, user_id, connection_id):
        existing = self._store.get(connection_id)
        if existing is None:
            return None
        updated = existing.model_copy(
            update={"flags": existing.flags.model_copy(update={"is_active": False})}
        )
        self._store[updated.id] = updated
        return updated

    async def unarchive_connection(self, *, project_id, user_id, connection_id):
        existing = self._store.get(connection_id)
        if existing is None:
            return None
        updated = existing.model_copy(
            update={"flags": existing.flags.model_copy(update={"is_active": True})}
        )
        self._store[updated.id] = updated
        return updated

    async def query_connections(self, *, project_id, connection=None, windowing=None):
        return list(self._store.values())


def _make_request(method: str = "POST") -> Request:
    app = FastAPI()
    scope = {
        "type": "http",
        "method": method,
        "path": "/channels/connections/",
        "headers": [],
        "app": app,
    }
    request = Request(scope)
    request.state.project_id = str(uuid4())
    request.state.user_id = str(uuid4())
    return request


def _patched_access():
    return patch(
        "oss.src.apis.fastapi.channels.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    )


def _assert_no_canary(payload: str) -> None:
    assert _CANARY_TOKEN not in payload
    assert _CANARY_SECRET not in payload
    assert _CANARY_ROTATED_TOKEN not in payload


async def test_the_full_connection_lifecycle_never_echoes_a_credential():
    dao = _FakeConnectionsDAO()
    registry = ChannelAdapterRegistry(adapters={"slack": _FakeAdapter()})
    vault = _FakeVaultService()
    service = ChannelsService(
        channels_dao=dao, adapter_registry=registry, vault_service=vault
    )
    router = ChannelsRouter(channels_service=service, adapter_registry=registry)

    from oss.src.core.channels.dtos import ChannelConnectionCreate

    create_body = ChannelConnectionCreateRequest(
        connection=ChannelConnectionCreate(
            channel="slack",
            external_key=uuid4(),
            slug="acme",
            data={"api_app_id": "A1"},
            credentials={"bot_token": _CANARY_TOKEN, "signing_secret": _CANARY_SECRET},
        )
    )
    with _patched_access():
        create_response = await router.create_channel_connection(
            _make_request(), body=create_body
        )
    _assert_no_canary(create_response.model_dump_json())
    connection_id = create_response.connection.id

    with _patched_access():
        query_response = await router.query_channel_connections(
            _make_request(), body=ChannelConnectionQueryRequest()
        )
    _assert_no_canary(query_response.model_dump_json())

    rotate_body = ChannelConnectionEditRequest(
        connection=ChannelConnectionEdit(
            id=connection_id,
            credentials={
                "bot_token": _CANARY_ROTATED_TOKEN,
                "signing_secret": _CANARY_SECRET,
            },
        )
    )
    with _patched_access():
        edit_response = await router.edit_channel_connection(
            _make_request(), connection_id=connection_id, body=rotate_body
        )
    _assert_no_canary(edit_response.model_dump_json())

    with _patched_access():
        archive_response = await router.archive_channel_connection(
            _make_request(), connection_id=connection_id
        )
    _assert_no_canary(archive_response.model_dump_json())

    with _patched_access():
        unarchive_response = await router.unarchive_channel_connection(
            _make_request(), connection_id=connection_id
        )
    _assert_no_canary(unarchive_response.model_dump_json())

    # This is the one that actually hydrates: `fetch_channel_connection_setup`
    # calls `service.fetch_connection`, which resolves the vault reference.
    with _patched_access():
        setup_response = await router.fetch_channel_connection_setup(
            _make_request(method="GET"), connection_id=connection_id
        )
    _assert_no_canary(setup_response.model_dump_json())
