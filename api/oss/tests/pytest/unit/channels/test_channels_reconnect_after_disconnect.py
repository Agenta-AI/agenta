"""Reconnecting a channel after a disconnect. A disconnect archives the row,
and `uq_channel_connections_external_key` still covers the archived row, so a
reconnect of the same installation must restore that row rather than insert
a second one. The fake DAO below enforces the key across archived rows and,
like the real query, hides archived rows from the identity lookup unless the
caller asks for them: a fake that returned archived rows unconditionally is
how the restore branches once passed their tests while the live reinstall
failed with a duplicate-key 500.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List
from uuid import UUID, uuid4

import pytest
from sqlalchemy.exc import IntegrityError

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
from oss.src.core.shared.exceptions import EntityCreationConflict

pytestmark = pytest.mark.asyncio


def _capabilities():
    return normalise_capabilities(
        {
            "channel": "slack",
            "identity": {
                "keys": {"connection": ["api_app_id", "enterprise_id", "team_id"]}
            },
        }
    )


class _FakeSlackAdapter(ChannelAdapterInterface):
    channel = "slack"

    def __init__(self, *, discovered: Dict[str, Any]):
        self.discovered = discovered

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
        return dict(self.discovered)


class _FakeSecret:
    def __init__(self, *, id: UUID, data: Any):
        self.id = id
        self.data = data


class _FakeVault:
    def __init__(self):
        self.store: Dict[UUID, _FakeSecret] = {}
        self.deleted: List[UUID] = []

    async def create_secret(self, *, project_id, create_secret_dto):
        secret = _FakeSecret(id=uuid4(), data=create_secret_dto.secret.data)
        self.store[secret.id] = secret
        return secret

    async def update_secret(self, *, secret_id, project_id, update_secret_dto):
        if secret_id not in self.store:
            return None
        secret = _FakeSecret(id=secret_id, data=update_secret_dto.secret.data)
        self.store[secret_id] = secret
        return secret

    async def delete_secret(self, *, secret_id, project_id=None):
        self.store.pop(secret_id, None)
        self.deleted.append(secret_id)


def _duplicate_key() -> IntegrityError:
    return IntegrityError(
        "INSERT INTO channel_connections ...",
        {},
        Exception(
            "duplicate key value violates unique constraint "
            '"uq_channel_connections_external_key"'
        ),
    )


class _ConstrainedDAO:
    """`channel_connections` with the real unique key: (channel, external_key)
    is unique across every row, archived or not."""

    def __init__(self):
        self.rows: Dict[UUID, ChannelConnection] = {}
        self.projects: Dict[UUID, UUID] = {}
        self.inserts = 0
        # set by a test to slip a competing row in between lookup and insert
        self.before_insert = None

    def seed(self, *, project_id: UUID, row: ChannelConnection) -> None:
        self.rows[row.id] = row
        self.projects[row.id] = project_id

    async def get_project_and_connection_by_external_key(
        self, *, channel, external_key, include_archived=False
    ):
        for row in self.rows.values():
            if row.channel != channel or row.external_key != external_key:
                continue
            if row.deleted_at is not None and not include_archived:
                continue
            return (self.projects[row.id], row.id)
        return None

    async def create_connection(self, *, project_id, user_id, connection):
        if self.before_insert is not None:
            hook, self.before_insert = self.before_insert, None
            hook()
        self.inserts += 1
        for row in self.rows.values():
            if (row.channel, row.external_key) == (
                connection.channel,
                connection.external_key,
            ):
                raise _duplicate_key()
        row = ChannelConnection(
            id=uuid4(),
            channel=connection.channel,
            external_key=connection.external_key,
            slug=connection.slug,
            name=connection.name,
            data=connection.data,
            flags=connection.flags,
        )
        self.seed(project_id=project_id, row=row)
        return row

    async def fetch_connection(self, *, project_id, connection_id):
        row = self.rows.get(connection_id)
        if row is None or self.projects[row.id] != project_id:
            return None
        return row

    async def edit_connection(self, *, project_id, user_id, connection):
        row = await self.fetch_connection(
            project_id=project_id, connection_id=connection.id
        )
        if row is None:
            return None
        edited = row.model_copy(
            update={
                "slug": connection.slug,
                "name": connection.name,
                "data": connection.data,
                "flags": connection.flags,
            }
        )
        self.rows[row.id] = edited
        return edited

    async def archive_connection(self, *, project_id, user_id, connection_id):
        row = self.rows[connection_id]
        self.rows[connection_id] = row.model_copy(
            update={"deleted_at": datetime.now(timezone.utc)}
        )
        return self.rows[connection_id]

    async def unarchive_connection(self, *, project_id, user_id, connection_id):
        row = await self.fetch_connection(
            project_id=project_id, connection_id=connection_id
        )
        if row is None:
            return None
        self.rows[connection_id] = row.model_copy(update={"deleted_at": None})
        return self.rows[connection_id]


def _service(dao, *, discovered=None) -> ChannelsService:
    adapter = _FakeSlackAdapter(discovered=discovered or {"team_id": "T1"})
    return ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"slack": adapter}),
        vault_service=_FakeVault(),
    )


def _hosted(token: str = "xoxb-new") -> ChannelConnectionCreate:
    return ChannelConnectionCreate(
        channel="slack",
        data={"api_app_id": "A1", "enterprise_id": "", "scopes": ["chat:write"]},
        credentials={"bot_token": token},
        flags=ChannelConnectionFlags(is_hosted=True),
    )


def _custom(token: str = "xoxb-custom") -> ChannelConnectionCreate:
    return ChannelConnectionCreate(
        channel="slack",
        data={"api_app_id": "A1", "enterprise_id": ""},
        credentials={"bot_token": token, "signing_secret": "sec"},
    )


def _secret_id(row: ChannelConnection) -> UUID:
    return UUID(row.data["credential_secret_id"])


# --- hosted install ------------------------------------------------------------ #


async def test_reinstall_after_disconnect_restores_the_archived_row_in_place():
    dao = _ConstrainedDAO()
    service = _service(dao)
    project_id, user_id = uuid4(), uuid4()

    first = await service.install_connection(
        project_id=project_id, user_id=user_id, connection=_hosted("xoxb-old")
    )
    await service.archive_connection(
        project_id=project_id, user_id=user_id, connection_id=first.id
    )

    again = await service.install_connection(
        project_id=project_id, user_id=user_id, connection=_hosted("xoxb-new")
    )

    assert again.id == first.id
    assert again.deleted_at is None
    assert again.flags.is_active is True
    assert dao.inserts == 1
    assert len(dao.rows) == 1
    # the new token went to the vault, the new scopes into the row
    stored = service.vault_service.store[_secret_id(again)]
    assert stored.data.channel.bot_token == "xoxb-new"
    assert again.data["scopes"] == ["chat:write"]


async def test_reinstall_refuses_an_archived_identity_held_by_another_project():
    dao = _ConstrainedDAO()
    service = _service(dao)
    other_project, user_id = uuid4(), uuid4()

    held = await service.install_connection(
        project_id=other_project, user_id=user_id, connection=_hosted()
    )
    await service.archive_connection(
        project_id=other_project, user_id=user_id, connection_id=held.id
    )

    with pytest.raises(ChannelConnectionIdentityConflict):
        await service.install_connection(
            project_id=uuid4(), user_id=user_id, connection=_hosted()
        )

    assert dao.inserts == 1
    assert dao.rows[held.id].deleted_at is not None


async def test_install_that_loses_an_insert_race_upserts_onto_the_winner():
    dao = _ConstrainedDAO()
    service = _service(dao)
    project_id, user_id = uuid4(), uuid4()

    winner = await service.install_connection(
        project_id=project_id, user_id=user_id, connection=_hosted("xoxb-winner")
    )
    winner_row = dao.rows.pop(winner.id)

    # the loser's lookup misses; the winner commits just before its insert
    dao.before_insert = lambda: dao.seed(project_id=project_id, row=winner_row)

    loser = await service.install_connection(
        project_id=project_id, user_id=user_id, connection=_hosted("xoxb-loser")
    )

    assert loser.id == winner.id
    assert len(dao.rows) == 1
    vault = service.vault_service
    # the secret the losing insert wrote is gone; the winner holds the new token
    assert len(vault.deleted) == 1
    assert vault.deleted[0] not in vault.store
    assert vault.store[_secret_id(loser)].data.channel.bot_token == "xoxb-loser"


# --- custom-app (BYO) create ------------------------------------------------------ #


async def test_custom_reconnect_after_disconnect_restores_the_archived_row():
    dao = _ConstrainedDAO()
    service = _service(dao, discovered={"team_id": "T1", "bot_user_id": "U1"})
    project_id, user_id = uuid4(), uuid4()

    first = await service.create_connection(
        project_id=project_id, user_id=user_id, connection=_custom("xoxb-old")
    )
    await service.archive_connection(
        project_id=project_id, user_id=user_id, connection_id=first.id
    )
    service.adapter_registry.get("slack").discovered = {
        "team_id": "T1",
        "bot_user_id": "U2",
    }

    again = await service.create_connection(
        project_id=project_id,
        user_id=user_id,
        connection=_custom("xoxb-new").model_copy(update={"name": "Renamed bot"}),
    )

    assert again.id == first.id
    assert again.deleted_at is None
    assert again.name == "Renamed bot"
    assert again.data["bot_user_id"] == "U2"
    assert dao.inserts == 1
    stored = service.vault_service.store[_secret_id(again)]
    assert stored.data.channel.bot_token == "xoxb-new"


async def test_custom_create_refuses_an_archived_identity_in_another_project():
    dao = _ConstrainedDAO()
    service = _service(dao)
    other_project, user_id = uuid4(), uuid4()

    held = await service.create_connection(
        project_id=other_project, user_id=user_id, connection=_custom()
    )
    await service.archive_connection(
        project_id=other_project, user_id=user_id, connection_id=held.id
    )

    with pytest.raises(ChannelConnectionIdentityConflict):
        await service.create_connection(
            project_id=uuid4(), user_id=user_id, connection=_custom()
        )

    assert dao.inserts == 1


async def test_custom_create_over_an_active_row_in_this_project_still_conflicts():
    dao = _ConstrainedDAO()
    service = _service(dao)
    project_id, user_id = uuid4(), uuid4()

    await service.create_connection(
        project_id=project_id, user_id=user_id, connection=_custom()
    )

    with pytest.raises(EntityCreationConflict):
        await service.create_connection(
            project_id=project_id, user_id=user_id, connection=_custom()
        )


async def test_custom_create_that_races_a_disconnected_row_restores_it():
    dao = _ConstrainedDAO()
    service = _service(dao)
    project_id, user_id = uuid4(), uuid4()

    first = await service.create_connection(
        project_id=project_id, user_id=user_id, connection=_custom("xoxb-old")
    )
    archived = dao.rows.pop(first.id).model_copy(
        update={"deleted_at": datetime.now(timezone.utc)}
    )
    dao.before_insert = lambda: dao.seed(project_id=project_id, row=archived)

    again = await service.create_connection(
        project_id=project_id, user_id=user_id, connection=_custom("xoxb-new")
    )

    assert again.id == first.id
    assert again.deleted_at is None
    assert len(dao.rows) == 1
    vault = service.vault_service
    assert vault.store[_secret_id(again)].data.channel.bot_token == "xoxb-new"
