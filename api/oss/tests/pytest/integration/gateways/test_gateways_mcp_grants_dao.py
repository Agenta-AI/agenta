"""McpGrantsDAO against real Postgres (entities.md §2.5, §7, WP1 exit condition).

Needs a live deployment — write, do not run without one. `endpoint_id` has no DB
FK (validated in the service layer, entities.md §2.1's "child-to-child" carve-out),
so these tests use a bare `uuid4()` for it.
"""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from oss.src.core.gateways.mcps.dtos import McpGrantCreate
from oss.src.core.shared.dtos import Status
from oss.src.dbs.postgres.gateways.mcps.dao import McpGrantsDAO
from oss.src.dbs.postgres.gateways.mcps.dbes import McpGrantDBE
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


async def test_create_grant_project_owned_is_idempotent_never_returns_none(
    seeded_project,
):
    dao = McpGrantsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    secret_id = seeded_project["secret_id"]
    endpoint_id = uuid4()

    first = await dao.create_grant(
        project_id=project_id,
        user_id=None,
        #
        grant=McpGrantCreate(endpoint_id=endpoint_id, secret_id=secret_id),
    )
    assert first is not None

    second = await dao.create_grant(
        project_id=project_id,
        user_id=None,
        #
        grant=McpGrantCreate(endpoint_id=endpoint_id, secret_id=secret_id),
    )
    assert second is not None
    assert second.id == first.id  # the surviving row, never a second one, never None

    all_grants = await dao.query_grants(
        project_id=project_id,
        #
        grant=None,
    )
    assert len([g for g in all_grants if g.endpoint_id == endpoint_id]) == 1


async def test_create_grant_two_distinct_owners_produce_two_rows(seeded_project):
    dao = McpGrantsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    secret_id = seeded_project["secret_id"]
    endpoint_id = uuid4()
    owner_a = uuid4()
    owner_b = uuid4()

    grant_a = await dao.create_grant(
        project_id=project_id,
        user_id=owner_a,
        #
        grant=McpGrantCreate(
            endpoint_id=endpoint_id, user_id=owner_a, secret_id=secret_id
        ),
    )
    grant_b = await dao.create_grant(
        project_id=project_id,
        user_id=owner_b,
        #
        grant=McpGrantCreate(
            endpoint_id=endpoint_id, user_id=owner_b, secret_id=secret_id
        ),
    )
    assert grant_a.id != grant_b.id
    assert grant_a.user_id == owner_a
    assert grant_b.user_id == owner_b

    # Re-consent by owner_a: idempotent on that owner, still not a third row.
    grant_a_again = await dao.create_grant(
        project_id=project_id,
        user_id=owner_a,
        #
        grant=McpGrantCreate(
            endpoint_id=endpoint_id, user_id=owner_a, secret_id=secret_id
        ),
    )
    assert grant_a_again.id == grant_a.id


async def test_raw_insert_violating_partial_indexes_raises_integrity_error(
    seeded_project,
):
    """Defense in depth: the two partial unique indexes reject violations at the
    database level even when the DAO's ON CONFLICT DO NOTHING is bypassed."""
    engine = get_transactions_engine()
    project_id = seeded_project["project_id"]
    secret_id = seeded_project["secret_id"]
    endpoint_id = uuid4()

    async with engine.session() as session:
        session.add(
            McpGrantDBE(
                project_id=project_id,
                endpoint_id=endpoint_id,
                user_id=None,
                secret_id=secret_id,
            )
        )
        await session.commit()

    with pytest.raises(IntegrityError) as excinfo:
        async with engine.session() as session:
            session.add(
                McpGrantDBE(
                    project_id=project_id,
                    endpoint_id=endpoint_id,
                    user_id=None,
                    secret_id=secret_id,
                )
            )
            await session.commit()
    assert "uq_mcp_gateway_grants_project" in str(excinfo.value.orig)

    owner_id = uuid4()
    async with engine.session() as session:
        session.add(
            McpGrantDBE(
                project_id=project_id,
                endpoint_id=endpoint_id,
                user_id=owner_id,
                secret_id=secret_id,
            )
        )
        await session.commit()

    with pytest.raises(IntegrityError) as excinfo:
        async with engine.session() as session:
            session.add(
                McpGrantDBE(
                    project_id=project_id,
                    endpoint_id=endpoint_id,
                    user_id=owner_id,
                    secret_id=secret_id,
                )
            )
            await session.commit()
    assert "uq_mcp_gateway_grants_user" in str(excinfo.value.orig)


async def test_fetch_grant_never_crosses_project_and_user_owner(seeded_project):
    dao = McpGrantsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    secret_id = seeded_project["secret_id"]
    endpoint_id = uuid4()
    owner_id = uuid4()

    project_grant = await dao.create_grant(
        project_id=project_id,
        user_id=None,
        #
        grant=McpGrantCreate(endpoint_id=endpoint_id, secret_id=secret_id),
    )
    user_grant = await dao.create_grant(
        project_id=project_id,
        user_id=owner_id,
        #
        grant=McpGrantCreate(
            endpoint_id=endpoint_id, user_id=owner_id, secret_id=secret_id
        ),
    )

    fetched_project = await dao.fetch_grant(
        project_id=project_id,
        #
        endpoint_id=endpoint_id,
        user_id=None,
    )
    assert fetched_project is not None
    assert fetched_project.id == project_grant.id

    fetched_user = await dao.fetch_grant(
        project_id=project_id,
        #
        endpoint_id=endpoint_id,
        user_id=owner_id,
    )
    assert fetched_user is not None
    assert fetched_user.id == user_grant.id
    assert fetched_user.id != fetched_project.id

    fetched_other_owner = await dao.fetch_grant(
        project_id=project_id,
        #
        endpoint_id=endpoint_id,
        user_id=uuid4(),
    )
    assert fetched_other_owner is None


async def test_update_grant_flips_is_valid_without_touching_identity(seeded_project):
    dao = McpGrantsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    secret_id = seeded_project["secret_id"]
    endpoint_id = uuid4()
    owner_id = uuid4()

    created = await dao.create_grant(
        project_id=project_id,
        user_id=owner_id,
        #
        grant=McpGrantCreate(
            endpoint_id=endpoint_id, user_id=owner_id, secret_id=secret_id
        ),
    )
    assert created.flags.is_valid is True

    updated = await dao.update_grant(
        project_id=project_id,
        #
        grant_id=created.id,
        is_valid=False,
        status=Status(type="refresh_failed", message="token expired"),
    )
    assert updated is not None
    assert updated.flags.is_valid is False
    assert updated.status is not None
    assert updated.status.type == "refresh_failed"
    # identity untouched
    assert updated.endpoint_id == endpoint_id
    assert updated.user_id == owner_id
    assert updated.secret_id == secret_id


async def test_delete_grant_then_fetch_by_id_returns_none(seeded_project):
    dao = McpGrantsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    secret_id = seeded_project["secret_id"]
    endpoint_id = uuid4()

    created = await dao.create_grant(
        project_id=project_id,
        user_id=None,
        #
        grant=McpGrantCreate(endpoint_id=endpoint_id, secret_id=secret_id),
    )

    deleted = await dao.delete_grant(
        project_id=project_id,
        #
        grant_id=created.id,
    )
    assert deleted is True

    assert (
        await dao.fetch_grant_by_id(project_id=project_id, grant_id=created.id) is None
    )


async def test_deleting_secret_cascades_to_grant_row(seeded_project):
    """§2.1: a grant with no secret means nothing — CASCADE, not SET NULL."""
    dao = McpGrantsDAO(engine=get_transactions_engine())
    project_id = seeded_project["project_id"]
    endpoint_id = uuid4()

    engine = get_transactions_engine()
    own_secret_id = uuid4()
    async with engine.session() as session:
        await session.execute(
            text("INSERT INTO secrets (id, project_id) VALUES (:id, :project_id)"),
            {"id": own_secret_id, "project_id": project_id},
        )
        await session.commit()

    created = await dao.create_grant(
        project_id=project_id,
        user_id=None,
        #
        grant=McpGrantCreate(endpoint_id=endpoint_id, secret_id=own_secret_id),
    )
    assert created is not None

    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM secrets WHERE id = :id"), {"id": own_secret_id}
        )
        await session.commit()

    assert (
        await dao.fetch_grant_by_id(project_id=project_id, grant_id=created.id) is None
    )
