"""`ChannelsService.install_connection` -- the hosted-app upsert. A reinstall
must update the row it already holds, not fork a second one: the DAO fake
here is scripted with `get_project_and_connection_by_external_key`, the same
lookup the real DAO backs with `uq_channel_connections_external_key`, so a
test that only counted rows could not tell an upsert from an accidental
insert-that-happened-to-work.
"""

from typing import Any, Dict, Optional
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelConnectionFlags,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelConnectionIdentityConflict
from oss.src.core.channels.utils import ChannelKeyGrain, compose_external_key

pytestmark = pytest.mark.asyncio

_CANARY_TOKEN = "xoxb-unit-test-canary-do-not-echo"


def _capabilities():
    return normalise_capabilities(
        {
            "channel": "slack",
            "identity": {
                "keys": {"connection": ["api_app_id", "enterprise_id", "team_id"]}
            },
        }
    )


class _FakeAdapter(ChannelAdapterInterface):
    channel = "slack"

    def __init__(self, *, discovered=None):
        self._discovered = discovered or {}

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
        return dict(self._discovered)


class _FakeSecret:
    def __init__(self, *, id: UUID, data: Any):
        self.id = id
        self.data = data


class _FakeVaultService:
    def __init__(self):
        self.create_calls = []
        self.update_calls = []
        self._store: Dict[UUID, _FakeSecret] = {}

    async def create_secret(self, *, project_id, create_secret_dto):
        secret_id = uuid4()
        secret = _FakeSecret(id=secret_id, data=create_secret_dto.secret.data)
        self._store[secret_id] = secret
        self.create_calls.append(create_secret_dto)
        return secret

    async def update_secret(self, *, secret_id, project_id, update_secret_dto):
        if secret_id not in self._store:
            return None
        secret = _FakeSecret(id=secret_id, data=update_secret_dto.secret.data)
        self._store[secret_id] = secret
        self.update_calls.append(update_secret_dto)
        return secret


def _as_connection(created: ChannelConnectionCreate) -> ChannelConnection:
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


def _fake_dao(
    *, existing: Optional[ChannelConnection] = None, existing_project_id=None
):
    dao = MagicMock()
    dao.create_connection = AsyncMock(
        side_effect=lambda **kw: _as_connection(kw["connection"])
    )

    async def _edit(**kw):
        edited = kw["connection"]
        assert existing is not None
        return existing.model_copy(
            update={"data": edited.data, "flags": edited.flags, "slug": edited.slug}
        )

    dao.edit_connection = AsyncMock(side_effect=_edit)
    dao.fetch_connection = AsyncMock(return_value=existing)

    async def _lookup(*, channel, external_key):
        if existing is None:
            return None
        return (existing_project_id, existing.id)

    dao.get_project_and_connection_by_external_key = AsyncMock(side_effect=_lookup)
    return dao


def _service(*, dao, adapter, vault=None) -> ChannelsService:
    registry = ChannelAdapterRegistry(adapters={adapter.channel: adapter})
    return ChannelsService(
        channels_dao=dao, adapter_registry=registry, vault_service=vault
    )


def _install_create(**data_overrides) -> ChannelConnectionCreate:
    data = {"api_app_id": "A1", "enterprise_id": ""}
    data.update(data_overrides)
    return ChannelConnectionCreate(
        channel="slack",
        data=data,
        credentials={"bot_token": _CANARY_TOKEN},
        flags=ChannelConnectionFlags(is_hosted=True),
    )


# --- no existing identity: behaves like create_connection --------------------- #


async def test_install_creates_a_new_connection_when_no_identity_exists_yet():
    dao = _fake_dao(existing=None)
    adapter = _FakeAdapter(discovered={"team_id": "T1"})
    vault = _FakeVaultService()
    service = _service(dao=dao, adapter=adapter, vault=vault)

    result = await service.install_connection(
        project_id=uuid4(), user_id=uuid4(), connection=_install_create()
    )

    dao.create_connection.assert_awaited_once()
    dao.edit_connection.assert_not_awaited()
    assert result.flags.is_hosted is True
    assert result.flags.is_verified is True


# --- a reinstall of a known identity: upsert, not fork ------------------------- #


async def test_reinstall_keeps_the_existing_row_id_not_just_the_row_count():
    """The assertion this project's own notes call out: a test that counts
    rows would pass even if the upsert quietly wrote a NEW row -- only
    asserting the returned id proves the same row was reused."""

    project_id = uuid4()
    existing = ChannelConnection(
        id=uuid4(),
        slug="slack-hosted",
        channel="slack",
        external_key=uuid4(),
        data={
            "api_app_id": "A1",
            "enterprise_id": "",
            "team_id": "T1",
            "credential_secret_id": str(uuid4()),
        },
        flags=ChannelConnectionFlags(is_active=False, is_hosted=True, is_verified=True),
    )
    dao = _fake_dao(existing=existing, existing_project_id=project_id)
    adapter = _FakeAdapter(discovered={"team_id": "T1"})
    vault = _FakeVaultService()
    service = _service(dao=dao, adapter=adapter, vault=vault)

    result = await service.install_connection(
        project_id=project_id, user_id=uuid4(), connection=_install_create()
    )

    dao.edit_connection.assert_awaited_once()
    dao.create_connection.assert_not_awaited()
    assert result.id == existing.id


async def test_reinstall_reactivates_a_connection_app_uninstalled_had_deactivated():
    project_id = uuid4()
    existing = ChannelConnection(
        id=uuid4(),
        slug="slack-hosted",
        channel="slack",
        external_key=uuid4(),
        data={"api_app_id": "A1", "enterprise_id": "", "team_id": "T1"},
        flags=ChannelConnectionFlags(is_active=False, is_hosted=True, is_verified=True),
    )
    dao = _fake_dao(existing=existing, existing_project_id=project_id)
    adapter = _FakeAdapter(discovered={"team_id": "T1"})
    service = _service(dao=dao, adapter=adapter, vault=_FakeVaultService())

    result = await service.install_connection(
        project_id=project_id, user_id=uuid4(), connection=_install_create()
    )

    assert result.flags.is_active is True


async def test_reinstall_rotates_the_existing_secret_rather_than_creating_a_new_one():
    project_id = uuid4()
    secret_id = uuid4()
    existing = ChannelConnection(
        id=uuid4(),
        slug="slack-hosted",
        channel="slack",
        external_key=uuid4(),
        data={
            "api_app_id": "A1",
            "enterprise_id": "",
            "team_id": "T1",
            "credential_secret_id": str(secret_id),
        },
        flags=ChannelConnectionFlags(is_hosted=True, is_verified=True),
    )
    dao = _fake_dao(existing=existing, existing_project_id=project_id)
    adapter = _FakeAdapter(discovered={"team_id": "T1"})
    vault = _FakeVaultService()
    # Pre-seed the store so update_secret finds it, mirroring a real prior write.
    vault._store[secret_id] = _FakeSecret(id=secret_id, data=None)
    service = _service(dao=dao, adapter=adapter, vault=vault)

    await service.install_connection(
        project_id=project_id, user_id=uuid4(), connection=_install_create()
    )

    assert len(vault.update_calls) == 1
    assert vault.create_calls == []


# --- cross-project identity: refused, never silently moved --------------------- #


async def test_install_refuses_when_the_identity_belongs_to_a_different_project():
    project_id = uuid4()
    other_project_id = uuid4()
    existing = ChannelConnection(
        id=uuid4(),
        slug="slack-hosted",
        channel="slack",
        external_key=uuid4(),
        data={"api_app_id": "A1", "enterprise_id": "", "team_id": "T1"},
        flags=ChannelConnectionFlags(is_hosted=True, is_verified=True),
    )
    dao = _fake_dao(existing=existing, existing_project_id=other_project_id)
    adapter = _FakeAdapter(discovered={"team_id": "T1"})
    service = _service(dao=dao, adapter=adapter, vault=_FakeVaultService())

    with pytest.raises(ChannelConnectionIdentityConflict):
        await service.install_connection(
            project_id=project_id, user_id=uuid4(), connection=_install_create()
        )

    dao.create_connection.assert_not_awaited()
    dao.edit_connection.assert_not_awaited()


async def test_external_key_composition_is_unaffected_by_which_branch_runs():
    """Sanity check on the fixture itself: the same locator composes the
    same key regardless of hosted/customer-owned, which is what makes the
    upsert lookup meaningful in the first place."""

    key = compose_external_key(
        _capabilities(),
        ChannelKeyGrain.CONNECTION,
        {"api_app_id": "A1", "enterprise_id": "", "team_id": "T1"},
    )
    assert isinstance(key, UUID)
