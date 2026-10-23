"""`PrincipalsDAO` against Postgres: one statement per kind, active and inactive rules.

The cache is faked empty (a `FakeCache` that is never warm between the two halves of a
test), so every call reads Postgres.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest

import oss.src.dbs.postgres.access.dao as dao_module
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.dbs.postgres.access.dao import PrincipalsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.cache import FakeCache
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    seed_organization,
)
from oss.tests.pytest.utils.principals import seed_api_key_with_missing_creator
from oss.tests.pytest.utils.statements import count_statements


pytestmark = pytest.mark.integration


@pytest.fixture
def fake_cache(monkeypatch):
    return FakeCache().install(monkeypatch, dao_module)


@pytest.fixture
async def seeded():
    organization = await seed_organization(members={"editor": "editor"})
    yield organization
    project_ids = organization.project_ids
    await execute(
        "DELETE FROM channel_agents WHERE project_id = ANY(CAST(:p AS uuid[]))",
        {"p": project_ids},
    )
    await execute(
        "DELETE FROM channel_connections WHERE project_id = ANY(CAST(:p AS uuid[]))",
        {"p": project_ids},
    )
    await execute(
        "DELETE FROM api_keys WHERE project_id = ANY(CAST(:p AS uuid[]))",
        {"p": project_ids},
    )
    await delete_seeded_organization(organization)


async def _api_key(
    *,
    project_id: UUID,
    created_by_id,
    expiration_date=None,
) -> UUID:
    key_id = uuid4()
    await execute(
        "INSERT INTO api_keys (id, prefix, hashed_key, project_id, created_by_id, "
        "rate_limit, hidden, expiration_date, created_at, updated_at) "
        "VALUES (:id, :prefix, 'x', :p, :u, 0, false, :exp, now(), now())",
        {
            "id": key_id,
            "prefix": f"m2dao{key_id.hex[:6]}",
            "p": project_id,
            "u": created_by_id,
            "exp": expiration_date,
        },
    )
    return key_id


async def _connection(*, project_id: UUID, flags=None, deleted: bool = False) -> UUID:
    connection_id = uuid4()
    await execute(
        "INSERT INTO channel_connections (id, project_id, channel, external_key, slug, "
        "flags, deleted_at) VALUES (:id, :p, 'slack', :ek, :slug, "
        "CAST(:flags AS jsonb), :deleted)",
        {
            "id": connection_id,
            "p": project_id,
            "ek": uuid4(),
            "slug": f"c-{connection_id.hex[:8]}",
            "flags": flags,
            "deleted": datetime.now(timezone.utc) if deleted else None,
        },
    )
    return connection_id


async def _binding(
    *,
    project_id: UUID,
    connection_id: UUID,
    created_by_id,
    flags=None,
    deleted: bool = False,
) -> UUID:
    agent_id = uuid4()
    await execute(
        "INSERT INTO channel_agents (id, project_id, connection_id, slug, flags, "
        "created_by_id, deleted_at) VALUES (:id, :p, :c, :slug, CAST(:flags AS jsonb), "
        ":u, :deleted)",
        {
            "id": agent_id,
            "p": project_id,
            "c": connection_id,
            "slug": f"a-{agent_id.hex[:8]}",
            "flags": flags,
            "u": created_by_id,
            "deleted": datetime.now(timezone.utc) if deleted else None,
        },
    )
    return agent_id


def _ref(kind: PrincipalKind, id_: UUID) -> PrincipalRef:
    return PrincipalRef(kind=kind, id=id_)


async def test_fetch_each_kind_active_and_inactive(seeded, fake_cache):
    dao = PrincipalsDAO(engine=get_transactions_engine())
    project_id = seeded.project_ids[0]
    editor = seeded.user_ids["editor"]

    human = await dao.fetch_principal(principal=_ref(PrincipalKind.HUMAN, editor))
    assert human.is_active and human.acting_user_id == editor
    assert human.project_id is None

    key = await _api_key(project_id=project_id, created_by_id=editor)
    record = await dao.fetch_principal(principal=_ref(PrincipalKind.API_KEY, key))
    assert record.is_active and record.project_id == project_id
    assert record.acting_user_id == editor and record.expires_at is None

    past = datetime.now(timezone.utc) - timedelta(days=1)
    expired = await _api_key(
        project_id=project_id, created_by_id=editor, expiration_date=past
    )
    record = await dao.fetch_principal(principal=_ref(PrincipalKind.API_KEY, expired))
    # Active: `decide` compares `expires_at` with the clock on every call.
    assert record.is_active and record.expires_at is not None

    null_creator = await _api_key(project_id=project_id, created_by_id=None)
    record = await dao.fetch_principal(
        principal=_ref(PrincipalKind.API_KEY, null_creator)
    )
    assert record.is_active is False

    connection = await _connection(project_id=project_id)
    binding = await _binding(
        project_id=project_id, connection_id=connection, created_by_id=editor
    )
    record = await dao.fetch_principal(
        principal=_ref(PrincipalKind.INSTALLATION, binding)
    )
    assert record.is_active and record.acting_user_id == editor
    assert record.project_id == project_id

    archived = await _binding(
        project_id=project_id,
        connection_id=connection,
        created_by_id=editor,
        deleted=True,
    )
    record = await dao.fetch_principal(
        principal=_ref(PrincipalKind.INSTALLATION, archived)
    )
    assert record.is_active is False

    inactive_binding = await _binding(
        project_id=project_id,
        connection_id=connection,
        created_by_id=editor,
        flags='{"is_active": false}',
    )
    record = await dao.fetch_principal(
        principal=_ref(PrincipalKind.INSTALLATION, inactive_binding)
    )
    assert record.is_active is False

    inactive_connection = await _connection(
        project_id=project_id, flags='{"is_active": false}'
    )
    on_inactive = await _binding(
        project_id=project_id,
        connection_id=inactive_connection,
        created_by_id=editor,
    )
    record = await dao.fetch_principal(
        principal=_ref(PrincipalKind.INSTALLATION, on_inactive)
    )
    assert record.is_active is False

    archived_connection = await _connection(project_id=project_id, deleted=True)
    on_archived = await _binding(
        project_id=project_id,
        connection_id=archived_connection,
        created_by_id=editor,
    )
    record = await dao.fetch_principal(
        principal=_ref(PrincipalKind.INSTALLATION, on_archived)
    )
    assert record.is_active is False

    for kind in PrincipalKind:
        assert await dao.fetch_principal(principal=_ref(kind, uuid4())) is None


async def test_api_key_with_missing_creator_user_is_inactive(seeded, fake_cache):
    dao = PrincipalsDAO(engine=get_transactions_engine())
    key = await seed_api_key_with_missing_creator(project_id=seeded.project_ids[0])
    record = await dao.fetch_principal(principal=_ref(PrincipalKind.API_KEY, key))
    assert record is not None
    assert record.is_active is False
    assert record.acting_user_id is not None  # the dangling creator id, kept as is


async def test_installation_without_creator_is_inactive(seeded, fake_cache):
    dao = PrincipalsDAO(engine=get_transactions_engine())
    project_id = seeded.project_ids[0]
    connection = await _connection(project_id=project_id)
    binding = await _binding(
        project_id=project_id, connection_id=connection, created_by_id=None
    )
    record = await dao.fetch_principal(
        principal=_ref(PrincipalKind.INSTALLATION, binding)
    )
    assert record is not None and record.is_active is False


async def test_fetch_principal_is_one_statement_per_kind(seeded, fake_cache):
    dao = PrincipalsDAO(engine=get_transactions_engine())
    project_id = seeded.project_ids[0]
    editor = seeded.user_ids["editor"]
    key = await _api_key(project_id=project_id, created_by_id=editor)
    connection = await _connection(project_id=project_id)
    binding = await _binding(
        project_id=project_id, connection_id=connection, created_by_id=editor
    )

    for ref in (
        _ref(PrincipalKind.HUMAN, editor),
        _ref(PrincipalKind.API_KEY, key),
        _ref(PrincipalKind.INSTALLATION, binding),
    ):
        with count_statements(get_transactions_engine()) as statements:
            await dao.fetch_principal(principal=ref)
        assert len(statements) == 1, (ref.kind, statements)

        # Warm: the second read is a cache hit and sends nothing.
        with count_statements(get_transactions_engine()) as statements:
            await dao.fetch_principal(principal=ref)
        assert statements == []


async def test_list_user_principals_reads_keys_bindings_and_projects(
    seeded, fake_cache
):
    dao = PrincipalsDAO(engine=get_transactions_engine())
    project_id = seeded.project_ids[0]
    editor = seeded.user_ids["editor"]
    key = await _api_key(project_id=project_id, created_by_id=editor)
    connection = await _connection(project_id=project_id)
    binding = await _binding(
        project_id=project_id, connection_id=connection, created_by_id=editor
    )

    with count_statements(get_transactions_engine()) as statements:
        snapshot = await dao.list_user_principals(user_id=editor)
    assert len(statements) == 1
    assert snapshot.api_key_ids == [key]
    assert snapshot.binding_ids == [binding]
    assert set(snapshot.project_ids) == set(seeded.project_ids)

    empty = await dao.list_user_principals(user_id=uuid4())
    assert (empty.api_key_ids, empty.binding_ids, empty.project_ids) == ([], [], [])
