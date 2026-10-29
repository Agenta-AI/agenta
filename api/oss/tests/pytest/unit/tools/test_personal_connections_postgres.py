"""A person's default Composio connection, on a real Postgres: the first connection is
the default, the next is not, make default moves the flag, and two calls at once leave
exactly one default. Skipped when Postgres is not reachable."""

import asyncio
import socket
import uuid
from urllib.parse import urlparse

import pytest
import pytest_asyncio
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
import oss.src.models.db_models  # noqa: F401
from oss.src.core.gateway.connections.dtos import (
    ConnectionCreate,
    ConnectionProviderKind,
)
from oss.src.core.secrets.dtos import SecretOwner
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.dbs.postgres.gateway.connections.dao import ConnectionsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.env import env

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


def _reachable() -> bool:
    parsed = urlparse(env.postgres.uri_core)
    try:
        with socket.create_connection(
            (parsed.hostname or "postgres", parsed.port or 5432), timeout=0.5
        ):
            return True
    except OSError:
        return False


@pytest.fixture(autouse=True)
def _skip_without_postgres():
    if not _reachable():
        pytest.skip("Postgres not reachable")


@pytest_asyncio.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest_asyncio.fixture
async def person():
    engine = get_transactions_engine()
    user_id, organization_id = uuid.uuid4(), uuid.uuid4()
    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "personal-connections-test",
                "email": f"personal-connections-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {
                "id": organization_id,
                "name": "personal-connections",
                "owner_id": user_id,
            },
        )
        await session.commit()
    yield SecretOwner.for_user(organization_id=organization_id, user_id=user_id)
    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM organizations WHERE id = :id"), {"id": organization_id}
        )
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        await session.commit()


def _create(slug: str) -> ConnectionCreate:
    return ConnectionCreate(
        slug=slug,
        provider_key=ConnectionProviderKind.COMPOSIO,
        integration_key="gmail",
        flags={"is_active": True, "is_valid": True},
    )


async def _create_for(dao, owner, slug):
    return await dao.create_connection(
        project_id=None, user_id=owner.id, connection_create=_create(slug), owner=owner
    )


async def _defaults(dao, owner):
    rows = await dao.query_connections(project_id=None, owner=owner, is_active=None)
    return sorted(row.slug for row in rows if row.is_default)


async def test_the_first_connection_is_the_default_and_the_next_is_not(person):
    dao = ConnectionsDAO()
    first = await _create_for(dao, person, "gmail-main")
    second = await _create_for(dao, person, "gmail-other")
    assert first.is_default is True and second.is_default is False
    assert (
        first.user_id == person.id and first.organization_id == person.organization_id
    )

    with pytest.raises(EntityCreationConflict):
        await _create_for(dao, person, "gmail-main")


async def test_after_the_default_is_deleted_a_new_connection_is_not_the_default(
    person,
):
    dao = ConnectionsDAO()
    first = await _create_for(dao, person, "gmail-main")
    await _create_for(dao, person, "gmail-other")
    assert await dao.delete_connection(
        project_id=None, connection_id=first.id, owner=person
    )
    third = await _create_for(dao, person, "gmail-third")
    assert third.is_default is False
    assert await _defaults(dao, person) == []


async def test_make_default_moves_the_flag_and_concurrent_calls_leave_one(person):
    dao = ConnectionsDAO()
    first = await _create_for(dao, person, "gmail-main")
    second = await _create_for(dao, person, "gmail-other")
    third = await _create_for(dao, person, "gmail-third")

    moved = await dao.make_default(owner=person, connection_id=second.id)
    assert moved.is_default is True
    assert await _defaults(dao, person) == ["gmail-other"]

    # Both calls move the flag away from `second`, so both clear and both set.
    results = await asyncio.gather(
        dao.make_default(owner=person, connection_id=third.id),
        dao.make_default(owner=person, connection_id=first.id),
    )
    assert all(result is not None for result in results)
    assert len(await _defaults(dao, person)) == 1


async def test_make_default_of_another_persons_connection_is_none(person):
    dao = ConnectionsDAO()
    connection = await _create_for(dao, person, "gmail-main")
    stranger = SecretOwner.for_user(
        organization_id=person.organization_id, user_id=uuid.uuid4()
    )
    assert await dao.make_default(owner=stranger, connection_id=connection.id) is None


async def test_concurrent_first_creates_store_exactly_one_default(person):
    dao = ConnectionsDAO()
    created = await asyncio.gather(
        *(_create_for(dao, person, f"gmail-{index}") for index in range(4))
    )
    assert len(created) == 4
    assert len(await _defaults(dao, person)) == 1
