"""Writers outside the access domain clear cached principals after their write: API key
deletion (both paths), channel connection and binding changes, user deletion (both
paths). A failure is logged and never fails the writer."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

import oss.src.core.access.service as access_module
import oss.src.core.accounts.service as accounts_module
import oss.src.core.channels.service as channels_module
import oss.src.dbs.postgres.access.dao as principals_dao_module
import oss.src.core.memberships.service as memberships_module
import oss.src.services.api_key_service as api_key_module
import oss.src.services.user_service as user_service_module
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef, UserPrincipals
from oss.src.core.access.service import AccessService
from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentData,
    ChannelConnection,
    ChannelConnectionEdit,
    ChannelConnectionFlags,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.shared.dtos import Reference
from oss.src.core.memberships.service import MembershipsService
from oss.src.utils import caching
from oss.src.utils.env import env
from oss.tests.pytest.utils.cache import FakeCache
from oss.tests.pytest.utils.memberships import InMemoryMembershipsDAO, RecordingRbac
from oss.tests.pytest.utils.principals import InMemoryPrincipalsDAO


class _Recorder:
    def __init__(self):
        self.calls = []

    async def __call__(self, *, principals, source):
        self.calls.append((list(principals), source))

    @property
    def principals(self):
        return [p for principals, _ in self.calls for p in principals]


@pytest.fixture
def recorded(monkeypatch):
    recorder = _Recorder()
    for module in (api_key_module, accounts_module, channels_module):
        monkeypatch.setattr(module, "invalidate_principals_after_write", recorder)
    return recorder


def _key(id_):
    return PrincipalRef(kind=PrincipalKind.API_KEY, id=id_)


def _binding(id_):
    return PrincipalRef(kind=PrincipalKind.INSTALLATION, id=id_)


# -- API keys -----------------------------------------------------------------------


class _Session:
    def __init__(self, row):
        self.row = row
        self.deleted = []
        self.committed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def execute(self, *args, **kwargs):
        row = self.row
        return SimpleNamespace(
            scalars=lambda: SimpleNamespace(first=lambda: row),
        )

    async def delete(self, obj):
        self.deleted.append(obj)

    async def commit(self):
        self.committed = True


@pytest.mark.parametrize("path", ["services.api_key_service", "core.accounts"])
async def test_delete_api_key_invalidates_principal(path, recorded, monkeypatch):
    key_id = uuid4()
    if path == "services.api_key_service":
        session = _Session(SimpleNamespace(id=key_id))
        monkeypatch.setattr(
            api_key_module,
            "get_transactions_engine",
            lambda: SimpleNamespace(session=lambda: session),
        )
        await api_key_module.delete_api_key(user_id=str(uuid4()), key_prefix="abc")
        assert session.committed
    else:
        monkeypatch.setattr(
            accounts_module,
            "_db_get_api_key_by_id",
            AsyncMock(return_value=SimpleNamespace(id=key_id)),
        )
        monkeypatch.setattr(accounts_module, "_db_delete_api_key", AsyncMock())
        service = accounts_module.PlatformAdminAccountsService.__new__(
            accounts_module.PlatformAdminAccountsService
        )
        await service.delete_api_key(api_key_id=str(key_id))

    assert recorded.principals == [_key(key_id)]


# -- channels -----------------------------------------------------------------------


def _connection(*, is_active=True, **overrides) -> ChannelConnection:
    fields = dict(
        id=uuid4(),
        slug="slack-conn",
        channel="slack",
        external_key=uuid4(),
        name="Acme",
        data={"team_id": "T1"},
        flags=ChannelConnectionFlags(is_active=is_active, is_verified=True),
    )
    fields.update(overrides)
    return ChannelConnection(**fields)


def _channels(*, connection, binding_ids):
    dao = MagicMock()
    dao.fetch_connection = AsyncMock(return_value=connection)
    dao.query_agents = AsyncMock(
        return_value=[
            SimpleNamespace(id=b, connection_id=connection.id) for b in binding_ids
        ]
    )

    async def _edit(**kw):
        return connection.model_copy(update={"flags": kw["connection"].flags})

    dao.edit_connection = AsyncMock(side_effect=_edit)
    dao.archive_connection = AsyncMock(return_value=connection)
    dao.unarchive_connection = AsyncMock(return_value=connection)
    service = ChannelsService(channels_dao=dao, adapter_registry=MagicMock())
    return service, dao


@pytest.mark.parametrize(
    "method", ["archive_connection", "unarchive_connection", "deactivate_connection"]
)
async def test_connection_changes_invalidate_every_binding(method, recorded):
    connection = _connection()
    binding_ids = [uuid4(), uuid4()]
    service, dao = _channels(connection=connection, binding_ids=binding_ids)
    kwargs = dict(project_id=uuid4(), connection_id=connection.id)
    if method != "deactivate_connection":
        kwargs["user_id"] = uuid4()

    await getattr(service, method)(**kwargs)

    assert recorded.principals == [_binding(b) for b in binding_ids]
    # Archived bindings count too: the ids are read with include_archived.
    query = dao.query_agents.await_args.kwargs["agent"]
    assert query.connection_id == connection.id and query.include_archived is True


async def test_edit_connection_inactive_invalidates_bindings(recorded):
    connection = _connection(is_active=True)
    binding_ids = [uuid4()]
    service, _ = _channels(connection=connection, binding_ids=binding_ids)

    await service.edit_connection(
        project_id=uuid4(),
        user_id=uuid4(),
        connection=ChannelConnectionEdit(
            id=connection.id,
            slug=connection.slug,
            flags=ChannelConnectionFlags(is_active=False, is_verified=True),
        ),
    )

    assert recorded.principals == [_binding(b) for b in binding_ids]


async def test_edit_connection_name_only_invalidates_nothing(recorded):
    connection = _connection(is_active=True)
    service, dao = _channels(connection=connection, binding_ids=[uuid4()])

    await service.edit_connection(
        project_id=uuid4(),
        user_id=uuid4(),
        connection=ChannelConnectionEdit(
            id=connection.id, slug=connection.slug, name="Renamed"
        ),
    )

    assert recorded.calls == []
    dao.query_agents.assert_not_awaited()


async def test_reinstall_invalidates_bindings(recorded):
    from oss.tests.pytest.unit.channels.test_channels_install_connection import (
        _FakeAdapter,
        _FakeVaultService,
        _fake_dao,
        _install_create,
        _service,
    )

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
    binding_id = uuid4()
    dao.query_agents = AsyncMock(
        return_value=[SimpleNamespace(id=binding_id, connection_id=existing.id)]
    )
    service = _service(
        dao=dao,
        adapter=_FakeAdapter(discovered={"team_id": "T1"}),
        vault=_FakeVaultService(),
    )

    await service.install_connection(
        project_id=project_id, user_id=uuid4(), connection=_install_create()
    )

    assert recorded.principals == [_binding(binding_id)]


@pytest.mark.parametrize("method", ["delete_agent", "edit_agent"])
async def test_binding_changes_invalidate_the_binding(method, recorded):
    agent_id = uuid4()
    dao = MagicMock()
    existing = ChannelAgent(
        id=agent_id,
        connection_id=uuid4(),
        slug="a",
        data=ChannelAgentData(references={"workflow": Reference(id=uuid4())}),
    )
    dao.fetch_agent = AsyncMock(return_value=existing)
    dao.edit_agent = AsyncMock(return_value=existing)
    dao.delete_agent = AsyncMock(return_value=True)
    service = ChannelsService(channels_dao=dao, adapter_registry=MagicMock())

    if method == "delete_agent":
        await service.delete_agent(project_id=uuid4(), agent_id=agent_id)
    else:
        from oss.src.core.channels.dtos import ChannelAgentEdit

        await service.edit_agent(
            project_id=uuid4(),
            user_id=uuid4(),
            agent=ChannelAgentEdit(id=agent_id),
        )

    assert recorded.principals == [_binding(agent_id)]


# -- users --------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["core.accounts", "services.user_service"])
async def test_user_deletion_invalidates_user_keys_bindings_and_memberships(
    path, monkeypatch
):
    user_id = uuid4()
    snapshot = UserPrincipals(
        user_id=user_id,
        api_key_ids=[uuid4()],
        binding_ids=[uuid4()],
        project_ids=[uuid4(), uuid4()],
    )
    order = []

    async def _read(*, user_id):
        order.append("read")
        return snapshot

    async def _invalidate(*, snapshot):
        order.append(("invalidate", snapshot))

    if path == "core.accounts":
        module = accounts_module
        monkeypatch.setattr(module, "read_user_principals_before_delete", _read)
        monkeypatch.setattr(module, "invalidate_user_after_delete", _invalidate)
        monkeypatch.setattr(
            module, "_db_get_user_by_id", AsyncMock(return_value=SimpleNamespace())
        )
        monkeypatch.setattr(
            module, "_member_organization_ids", AsyncMock(return_value=[])
        )
        monkeypatch.setattr(module, "is_ee", lambda: False)

        async def _delete(uid):
            order.append("delete")
            return []

        monkeypatch.setattr(module, "_db_delete_user_with_cascade", _delete)
        monkeypatch.setattr(module, "_invalidate_memberships", AsyncMock())
        service = module.PlatformAdminAccountsService.__new__(
            module.PlatformAdminAccountsService
        )
        await service.delete_user(user_id=str(user_id))
    else:
        module = user_service_module
        monkeypatch.setattr(module, "read_user_principals_before_delete", _read)
        monkeypatch.setattr(module, "invalidate_user_after_delete", _invalidate)
        session = _Session(SimpleNamespace(id=user_id))

        async def _delete(obj):
            order.append("delete")

        session.delete = _delete
        monkeypatch.setattr(
            module,
            "get_transactions_engine",
            lambda: SimpleNamespace(session=lambda: session),
        )
        await module.delete_user(str(user_id))

    assert order == ["read", "delete", ("invalidate", snapshot)]


async def test_invalidate_user_clears_user_keys_bindings_and_memberships(monkeypatch):
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    cache = FakeCache().install(monkeypatch, principals_dao_module, memberships_module)
    service = AccessService(
        memberships=MembershipsService(
            memberships_dao=InMemoryMembershipsDAO(),
            policy=MembershipPolicy.PROJECT_ROWS,
        ),
        rbac=RecordingRbac(),
        principals=InMemoryPrincipalsDAO(),
    )
    user_id, key_id, binding_id, project_id = uuid4(), uuid4(), uuid4(), uuid4()
    names = []
    for ref in (
        PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id),
        _key(key_id),
        _binding(binding_id),
    ):
        name = caching._pack(
            namespace="fetch_principal", key={"k": ref.kind.value, "id": str(ref.id)}
        )
        cache.store[name] = b"{}"
        names.append(name)
    membership = caching._pack(
        namespace="resolve_membership",
        key="membership",
        project_id=str(project_id),
        user_id=str(user_id),
    )
    cache.store[membership] = b"{}"

    await service.invalidate_user(
        snapshot=UserPrincipals(
            user_id=user_id,
            api_key_ids=[key_id],
            binding_ids=[binding_id],
            project_ids=[project_id],
        )
    )

    assert not any(name in cache.store for name in names)
    assert membership not in cache.store


async def test_invalidation_failure_does_not_fail_the_writer(monkeypatch):
    class _Broken:
        async def invalidate_principals(self, *, principals):
            raise RuntimeError("redis down")

    monkeypatch.setattr(access_module, "_access_service", _Broken())
    warnings = []
    monkeypatch.setattr(
        access_module,
        "log",
        SimpleNamespace(warning=lambda event, **fields: warnings.append(event)),
    )

    await access_module.invalidate_principals_after_write(
        principals=[_key(uuid4())], source="test"
    )
    assert warnings == ["[access] principal invalidation failed"]

    # A process that never registered the service: logged too, never raised.
    monkeypatch.setattr(access_module, "_access_service", None)
    await access_module.invalidate_principals_after_write(
        principals=[_key(uuid4())], source="test"
    )
    assert len(warnings) == 2
