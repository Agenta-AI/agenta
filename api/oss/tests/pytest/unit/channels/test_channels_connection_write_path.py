"""Unit tests for `ChannelsService`'s connections write path: create composes
the key from the declared locator plus what verification discovers, a failed
verification writes nothing, and a secret never rides a response body. No
DB and no vault: a fake DAO and a fake vault stand in for persistence.
"""

from typing import Any, Dict, Optional
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelConnectionEdit,
    ChannelConnectionResponse,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelConnectionVerificationFailed
from oss.src.core.channels.utils import ChannelKeyGrain, compose_external_key
from oss.src.core.shared.exceptions import EntityCreationConflict

pytestmark = pytest.mark.asyncio

_CANARY_TOKEN = "xoxb-unit-test-canary-do-not-echo"
_CANARY_SECRET = "unit-test-signing-secret-canary-do-not-echo"


def _slack_like_capabilities():
    return normalise_capabilities(
        {
            "channel": "slack",
            "identity": {
                "keys": {"connection": ["api_app_id", "enterprise_id", "team_id"]}
            },
        }
    )


class _FakeAdapter(ChannelAdapterInterface):
    """A minimal, fully-featured stand-in for Slack: only `verify_connection`
    is scripted, everything else raises if a test path ever reaches it."""

    channel = "slack"

    def __init__(self, *, discovered=None, fail: Optional[Exception] = None):
        self._discovered = discovered or {}
        self._fail = fail
        self.verify_calls = []

    async def fetch_capabilities(self, *, connection=None):
        return _slack_like_capabilities()

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
        self.verify_calls.append(dict(credentials))
        if self._fail is not None:
            raise self._fail
        return dict(self._discovered)


class _FakeSecret:
    def __init__(self, *, id: UUID, data: Any):
        self.id = id
        self.data = data


class _FakeVaultService:
    def __init__(self):
        self.create_calls = []
        self.created_ids = []
        self.update_calls = []
        self._store: Dict[UUID, _FakeSecret] = {}

    async def create_secret(self, *, project_id, create_secret_dto):
        secret_id = uuid4()
        secret = _FakeSecret(id=secret_id, data=create_secret_dto.secret.data)
        self._store[secret_id] = secret
        self.create_calls.append(create_secret_dto)
        self.created_ids.append(secret_id)
        return secret

    async def update_secret(self, *, secret_id, project_id, update_secret_dto):
        if secret_id not in self._store:
            return None
        secret = _FakeSecret(id=secret_id, data=update_secret_dto.secret.data)
        self._store[secret_id] = secret
        self.update_calls.append(update_secret_dto)
        return secret


def _service(*, dao, adapter, vault=None) -> ChannelsService:
    registry = ChannelAdapterRegistry(adapters={adapter.channel: adapter})
    return ChannelsService(
        channels_dao=dao,
        adapter_registry=registry,
        vault_service=vault,
    )


def _as_connection(created: ChannelConnectionCreate) -> ChannelConnection:
    """What the real DAO hands back: the DBE round-trip, stood in for here
    since only the shape matters, not persistence."""

    return ChannelConnection(
        id=uuid4(),
        channel=created.channel,
        external_key=created.external_key,
        slug=created.slug,
        name=created.name,
        description=created.description,
        tags=created.tags,
        meta=created.meta,
        data=created.data,
        flags=created.flags,
    )


def _fake_dao(*, existing: Optional[ChannelConnection] = None):
    dao = MagicMock()
    dao.create_connection = AsyncMock(
        side_effect=lambda **kw: _as_connection(kw["connection"])
    )
    dao.edit_connection = AsyncMock(
        side_effect=lambda **kw: (
            existing or _as_connection(kw["connection"])
        ).model_copy(update={"data": kw["connection"].data})
    )
    dao.fetch_connection = AsyncMock(return_value=existing)
    return dao


# --- create: verify, then store --------------------------------------------- #


async def test_create_composes_the_key_from_declared_locator_plus_discovered_fields():
    dao = _fake_dao()
    adapter = _FakeAdapter(discovered={"team_id": "T1", "bot_user_id": "U1"})
    vault = _FakeVaultService()
    service = _service(dao=dao, adapter=adapter, vault=vault)

    connection = ChannelConnectionCreate(
        channel="slack",
        external_key=uuid4(),  # a placeholder; must be overwritten
        slug="acme",
        data={"api_app_id": "A1", "enterprise_id": ""},
        credentials={"bot_token": _CANARY_TOKEN, "signing_secret": "sec"},
    )

    result = await service.create_connection(
        project_id=uuid4(), user_id=uuid4(), connection=connection
    )

    expected_key = compose_external_key(
        _slack_like_capabilities(),
        ChannelKeyGrain.CONNECTION,
        {"api_app_id": "A1", "enterprise_id": "", "team_id": "T1", "bot_user_id": "U1"},
    )
    assert result.external_key == expected_key
    # the identity-key subset lives nested under connection_locator -- the
    # only place the ingress seam (_connection_owns_identity) looks
    assert result.data["connection_locator"] == {
        "api_app_id": "A1",
        "enterprise_id": "",
        "team_id": "T1",
    }
    # discovered-but-not-a-key-field stays flat
    assert result.data["bot_user_id"] == "U1"
    dao.create_connection.assert_awaited_once()


async def test_create_writes_a_credential_secret_and_a_connection_row_on_success():
    dao = _fake_dao()
    adapter = _FakeAdapter(discovered={"team_id": "T1"})
    vault = _FakeVaultService()
    service = _service(dao=dao, adapter=adapter, vault=vault)

    connection = ChannelConnectionCreate(
        channel="slack",
        external_key=uuid4(),
        slug="acme",
        data={"api_app_id": "A1", "enterprise_id": ""},
        credentials={"bot_token": _CANARY_TOKEN, "signing_secret": "sec"},
    )

    result = await service.create_connection(
        project_id=uuid4(), user_id=uuid4(), connection=connection
    )

    assert len(vault.create_calls) == 1
    dao.create_connection.assert_awaited_once()
    assert result.data["credential_secret_id"] == str(vault.created_ids[0])


async def test_verify_runs_before_the_secret_and_the_connection_are_written():
    order = []

    dao = _fake_dao()

    async def _record_create(**kw):
        order.append("connection")
        return kw["connection"]

    dao.create_connection = AsyncMock(side_effect=_record_create)

    class _OrderedAdapter(_FakeAdapter):
        async def verify_connection(self, *, connection, credentials):
            order.append("verify")
            return await super().verify_connection(
                connection=connection, credentials=credentials
            )

    class _OrderedVault(_FakeVaultService):
        async def create_secret(self, **kw):
            order.append("secret")
            return await super().create_secret(**kw)

    adapter = _OrderedAdapter(discovered={"team_id": "T1"})
    vault = _OrderedVault()
    service = _service(dao=dao, adapter=adapter, vault=vault)

    connection = ChannelConnectionCreate(
        channel="slack",
        external_key=uuid4(),
        slug="acme",
        data={"api_app_id": "A1", "enterprise_id": ""},
        credentials={"bot_token": _CANARY_TOKEN, "signing_secret": "sec"},
    )

    await service.create_connection(
        project_id=uuid4(), user_id=uuid4(), connection=connection
    )

    assert order == ["verify", "secret", "connection"]


async def test_failed_verification_writes_neither_row():
    dao = _fake_dao()
    adapter = _FakeAdapter(
        fail=ChannelConnectionVerificationFailed(
            channel="slack", message="invalid_auth"
        )
    )
    vault = _FakeVaultService()
    service = _service(dao=dao, adapter=adapter, vault=vault)

    connection = ChannelConnectionCreate(
        channel="slack",
        external_key=uuid4(),
        slug="acme",
        data={"api_app_id": "A1", "enterprise_id": ""},
        credentials={"bot_token": "bad", "signing_secret": "sec"},
    )

    with pytest.raises(ChannelConnectionVerificationFailed):
        await service.create_connection(
            project_id=uuid4(), user_id=uuid4(), connection=connection
        )

    dao.create_connection.assert_not_awaited()
    assert vault.create_calls == []


async def test_a_channel_with_no_credentials_verifies_trivially_and_writes_no_secret():
    dao = _fake_dao()
    adapter = _FakeAdapter(discovered={})
    vault = _FakeVaultService()
    service = _service(dao=dao, adapter=adapter, vault=vault)

    connection = ChannelConnectionCreate(
        channel="slack",
        external_key=uuid4(),
        slug="acme",
        data={"api_app_id": "A1", "enterprise_id": "", "team_id": "T1"},
    )

    result = await service.create_connection(
        project_id=uuid4(), user_id=uuid4(), connection=connection
    )

    assert "credential_secret_id" not in result.data
    assert vault.create_calls == []


async def test_no_response_body_contains_a_secret_value():
    dao = _fake_dao()
    adapter = _FakeAdapter(discovered={"team_id": "T1"})
    vault = _FakeVaultService()
    service = _service(dao=dao, adapter=adapter, vault=vault)

    connection = ChannelConnectionCreate(
        channel="slack",
        external_key=uuid4(),
        slug="acme",
        data={"api_app_id": "A1", "enterprise_id": ""},
        credentials={"bot_token": _CANARY_TOKEN, "signing_secret": _CANARY_SECRET},
    )

    result = await service.create_connection(
        project_id=uuid4(), user_id=uuid4(), connection=connection
    )

    payload = ChannelConnectionResponse(count=1, connection=result).model_dump_json()
    assert _CANARY_TOKEN not in payload
    assert _CANARY_SECRET not in payload


async def test_two_projects_one_installation_collide_on_a_domain_error_not_a_500():
    dao = _fake_dao()
    dao.create_connection = AsyncMock(
        side_effect=IntegrityError(
            "INSERT INTO channel_connections ...",
            {},
            Exception(
                "duplicate key value violates unique constraint "
                '"uq_channel_connections_external_key"'
            ),
        )
    )
    adapter = _FakeAdapter(discovered={"team_id": "T1"})
    service = _service(dao=dao, adapter=adapter, vault=_FakeVaultService())

    connection = ChannelConnectionCreate(
        channel="slack",
        external_key=uuid4(),
        slug="acme",
        data={"api_app_id": "A1", "enterprise_id": ""},
        credentials={"bot_token": _CANARY_TOKEN, "signing_secret": "sec"},
    )

    with pytest.raises(EntityCreationConflict):
        await service.create_connection(
            project_id=uuid4(), user_id=uuid4(), connection=connection
        )


# --- edit: rotate without moving the identity -------------------------------- #


async def test_rotation_re_verifies_and_replaces_the_existing_secret_not_external_key():
    original_key = uuid4()
    secret_id = uuid4()
    existing = ChannelConnection(
        id=uuid4(),
        slug="acme",
        channel="slack",
        external_key=original_key,
        data={
            "connection_locator": {
                "api_app_id": "A1",
                "enterprise_id": "",
                "team_id": "T1",
            },
            "credential_secret_id": str(secret_id),
        },
    )
    dao = _fake_dao(existing=existing)
    adapter = _FakeAdapter(discovered={"team_id": "T1"})
    vault = _FakeVaultService()
    vault._store[secret_id] = _FakeSecret(id=secret_id, data=None)
    service = _service(dao=dao, adapter=adapter, vault=vault)

    edit = ChannelConnectionEdit(
        id=existing.id,
        name="Acme",
        data=dict(existing.data),
        credentials={"bot_token": "new-token", "signing_secret": "new-secret"},
    )

    result = await service.edit_connection(
        project_id=uuid4(), user_id=uuid4(), connection=edit
    )

    assert adapter.verify_calls, "rotation must re-verify before replacing the secret"
    assert len(vault.update_calls) == 1
    assert vault.create_calls == []  # updates the existing row, does not fork it
    assert result.data["credential_secret_id"] == str(secret_id)
    # ChannelConnectionEdit carries no external_key field at all -- there is
    # no code path here that could move it
    assert not hasattr(edit, "external_key")


async def test_edit_without_credentials_never_touches_the_vault():
    existing = ChannelConnection(
        id=uuid4(),
        slug="acme",
        channel="slack",
        external_key=uuid4(),
        data={"connection_locator": {"installation_id": "x"}},
    )
    dao = _fake_dao(existing=existing)
    adapter = _FakeAdapter()
    vault = _FakeVaultService()
    service = _service(dao=dao, adapter=adapter, vault=vault)

    edit = ChannelConnectionEdit(id=existing.id, name="Renamed", data=existing.data)

    await service.edit_connection(project_id=uuid4(), user_id=uuid4(), connection=edit)

    assert adapter.verify_calls == []
    assert vault.create_calls == []
    assert vault.update_calls == []
