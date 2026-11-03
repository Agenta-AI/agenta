"""Unit tests for `ChannelsService`'s connection hydration seam: `data`
carries only a `credential_secret_id` reference at rest, and every read that
hands a connection to an adapter must see the resolved credential fields
merged in at the flat keys the adapters already read (`bot_token`,
`signing_secret`, ...). No DB and no vault: a fake DAO and a fake vault stand
in for persistence, mirroring `test_channels_connection_write_path.py`.
"""

from typing import Any, Optional
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.mock.adapter import MockAdapter
from oss.src.core.channels.dtos import ChannelConnection
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.types import ChannelsError
from oss.src.core.secrets.dtos import ChannelSecretDTO, ChannelSecretSettingsDTO
from oss.src.core.secrets.enums import ChannelSecretKind

pytestmark = pytest.mark.asyncio

_CANARY_TOKEN = "xoxb-hydration-unit-test-canary-do-not-echo"
_CANARY_SECRET = "hydration-unit-test-signing-secret-canary-do-not-echo"


class _FakeSecret:
    def __init__(self, *, id: UUID, data: Any):
        self.id = id
        self.data = data


class _FakeVaultService:
    def __init__(self):
        self.get_calls = []
        self._store = {}

    def seed(self, *, secret_id: UUID, data: Any):
        self._store[secret_id] = _FakeSecret(id=secret_id, data=data)

    async def get_secret_by_id(self, *, secret_id, project_id=None):
        self.get_calls.append((secret_id, project_id))
        return self._store.get(secret_id)


def _channel_secret(*, bot_token: str, signing_secret: str) -> ChannelSecretDTO:
    return ChannelSecretDTO(
        kind=ChannelSecretKind.SLACK,
        channel=ChannelSecretSettingsDTO(
            bot_token=bot_token, signing_secret=signing_secret
        ),
    )


def _connection(*, secret_id: Optional[UUID] = None) -> ChannelConnection:
    data = {"connection_locator": {"team_id": "T1"}}
    if secret_id is not None:
        data["credential_secret_id"] = str(secret_id)
    return ChannelConnection(
        id=uuid4(),
        slug="acme",
        channel="slack",
        external_key=uuid4(),
        data=data,
    )


def _fake_dao(*, connection: Optional[ChannelConnection]):
    dao = MagicMock()
    dao.fetch_connection = AsyncMock(return_value=connection)
    return dao


def _service(*, dao, vault=None) -> ChannelsService:
    registry = ChannelAdapterRegistry(adapters={"slack": MockAdapter()})
    return ChannelsService(
        channels_dao=dao,
        adapter_registry=registry,
        vault_service=vault,
    )


async def test_fetch_connection_merges_the_resolved_credential_at_the_flat_keys():
    secret_id = uuid4()
    connection = _connection(secret_id=secret_id)
    dao = _fake_dao(connection=connection)
    vault = _FakeVaultService()
    vault.seed(
        secret_id=secret_id,
        data=_channel_secret(bot_token=_CANARY_TOKEN, signing_secret=_CANARY_SECRET),
    )
    service = _service(dao=dao, vault=vault)

    result = await service.fetch_connection(project_id=uuid4(), connection_id=uuid4())

    assert result.data["bot_token"] == _CANARY_TOKEN
    assert result.data["signing_secret"] == _CANARY_SECRET
    # the reference and the declared locator both survive the merge
    assert result.data["credential_secret_id"] == str(secret_id)
    assert result.data["connection_locator"] == {"team_id": "T1"}


async def test_fetch_connection_is_a_noop_with_no_credential_reference():
    """Agenta has no credential row at all, and the mock adapter has none
    either -- hydration must not require a vault_service in that case."""

    connection = _connection(secret_id=None)
    dao = _fake_dao(connection=connection)
    service = _service(dao=dao, vault=None)

    result = await service.fetch_connection(project_id=uuid4(), connection_id=uuid4())

    assert result.data == connection.data


async def test_fetch_connection_returns_none_for_a_missing_row():
    dao = _fake_dao(connection=None)
    service = _service(dao=dao, vault=_FakeVaultService())

    result = await service.fetch_connection(project_id=uuid4(), connection_id=uuid4())

    assert result is None


async def test_fetch_connection_raises_without_a_vault_service_when_a_reference_exists():
    """A background worker built with no vault_service cannot decrypt --
    this must fail loudly rather than silently hand the adapter an
    unresolved reference."""

    connection = _connection(secret_id=uuid4())
    dao = _fake_dao(connection=connection)
    service = _service(dao=dao, vault=None)

    with pytest.raises(ChannelsError):
        await service.fetch_connection(project_id=uuid4(), connection_id=uuid4())


async def test_fetch_connection_degrades_when_the_referenced_secret_is_gone():
    """A stale reference (the secret row was deleted) degrades to the
    unhydrated connection rather than raising -- routing still refuses
    downstream, at the adapter, exactly as a never-configured credential does."""

    secret_id = uuid4()
    connection = _connection(secret_id=secret_id)
    dao = _fake_dao(connection=connection)
    vault = _FakeVaultService()  # nothing seeded: get_secret_by_id returns None
    service = _service(dao=dao, vault=vault)

    result = await service.fetch_connection(project_id=uuid4(), connection_id=uuid4())

    assert "bot_token" not in result.data
    assert result.data["credential_secret_id"] == str(secret_id)


async def test_get_connection_setup_reads_through_the_hydrating_fetch():
    """`get_connection_setup` hands its connection to
    `adapter.fetch_capabilities` -- it must go through the same hydrating
    read as every other adapter-facing path, not a bare DAO fetch."""

    secret_id = uuid4()
    connection = _connection(secret_id=secret_id)
    dao = _fake_dao(connection=connection)
    vault = _FakeVaultService()
    vault.seed(
        secret_id=secret_id,
        data=_channel_secret(bot_token=_CANARY_TOKEN, signing_secret=_CANARY_SECRET),
    )

    seen = {}

    class _RecordingAdapter(MockAdapter):
        async def fetch_capabilities(self, *, connection=None):
            seen["connection"] = connection
            return await super().fetch_capabilities(connection=connection)

    registry = ChannelAdapterRegistry(adapters={"slack": _RecordingAdapter()})
    service = ChannelsService(
        channels_dao=dao, adapter_registry=registry, vault_service=vault
    )

    await service.get_connection_setup(
        project_id=uuid4(), connection_id=uuid4(), request_url="https://x/events/"
    )

    assert seen["connection"].data["bot_token"] == _CANARY_TOKEN
