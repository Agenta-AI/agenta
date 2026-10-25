"""Workspace removal step 2 ("switch") against a migrated Postgres.

Revision `oss000000053` repairs projects whose workspace belongs to another organization
and keeps one default project per organization. These cases pin both data changes, their
order, their locks against the step-1 and step-2 default writers, and the rule every
reader uses afterwards.

Global statements run on temp copies of the membership tables
(`rolled_back_connection(organizations=...)`) or are limited to the test's own
organizations (`switch(bind, organization_ids)`), so they never lock rows of tests that run
in parallel.
"""

import asyncio
from uuid import UUID, uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    ConnectionEngine,
    SeededOrganization,
    delete_seeded_organization,
    execute,
    fetch_all,
    load_revision_module,
    rolled_back_connection,
    seed_organization,
)


pytestmark = pytest.mark.integration

_REVISION = "oss000000053_switch_projects_to_organization_defaults.py"


def _revision():
    return load_revision_module(_REVISION)


# --- shapes ------------------------------------------------------------------ #


async def _multi_default_organization() -> SeededOrganization:
    """Three workspaces, each with a default project. The `default`-type workspace is the
    second one, so the oldest default (project 0) is not the D-11 default (project 1)."""

    seeded = await seed_organization(members={"m": "editor"}, workspaces=3)
    await execute(
        "UPDATE workspaces SET type = NULL WHERE organization_id = :o",
        {"o": seeded.organization_id},
    )
    await execute(
        "UPDATE workspaces SET type = 'default' WHERE id = :w",
        {"w": seeded.workspace_ids[1]},
    )
    return seeded


async def _cross_organization_project(*, foreign_default_type: bool = True):
    """Project P of O1 whose workspace W belongs to O2 (a legacy shape)."""

    cross = await seed_organization(members={"m": "editor"}, workspaces=2)
    other = await seed_organization(members={"owner": "owner"})
    # O1: workspace 0 is not `default`-type, so only P's foreign workspace could rank first.
    await execute(
        "UPDATE workspaces SET type = NULL WHERE organization_id = :o",
        {"o": cross.organization_id},
    )
    await execute(
        "UPDATE workspaces SET type = :t WHERE id = :w",
        {"w": other.workspace_ids[0], "t": "default" if foreign_default_type else None},
    )
    await execute(
        "UPDATE projects SET workspace_id = :ws WHERE id = :p",
        {"ws": other.workspace_ids[0], "p": cross.project_ids[1]},
    )
    cross.extra_organization_ids.append(other.organization_id)
    cross.extra_user_ids.extend(other.user_ids.values())
    return cross, other


async def _no_default_organization() -> SeededOrganization:
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    await execute(
        "UPDATE projects SET is_default = false WHERE organization_id = :o",
        {"o": seeded.organization_id},
    )
    return seeded


async def _upgrade(connection):
    def run(sync_connection):
        context = MigrationContext.configure(sync_connection)
        with Operations.context(context):
            _revision().upgrade()

    await connection.run_sync(run)


async def _switch(connection, organization_ids):
    return await connection.run_sync(
        lambda sync_connection: _revision().switch(sync_connection, organization_ids)
    )


async def _rows(connection, sql, params=None):
    return list((await connection.execute(text(sql), params or {})).mappings().all())


async def _defaults(connection, organization_id):
    return [
        row["id"]
        for row in await _rows(
            connection,
            "SELECT id FROM projects WHERE organization_id = :o AND is_default IS TRUE "
            "ORDER BY id",
            {"o": organization_id},
        )
    ]


# --- 053: data changes -------------------------------------------------------- #


async def test_053_repairs_cross_organization_projects():
    cross, other = await _cross_organization_project()
    try:
        async with rolled_back_connection(organizations=[cross]) as connection:
            before = {
                row["id"]: row["workspace_id"]
                for row in await _rows(
                    connection, "SELECT id, workspace_id FROM projects"
                )
            }
            await _upgrade(connection)
            after = {
                row["id"]: (row["workspace_id"], row["organization_id"])
                for row in await _rows(
                    connection, "SELECT id, workspace_id, organization_id FROM projects"
                )
            }
        p = cross.project_ids[1]
        assert after[p] == (None, cross.organization_id)
        for project_id, workspace_id in before.items():
            if project_id != p:
                assert after[project_id][0] == workspace_id
    finally:
        await delete_seeded_organization(cross)


async def test_053_keeps_one_default_per_organization(capsys):
    seeded = await _multi_default_organization()
    try:
        async with rolled_back_connection(organizations=[seeded]) as connection:
            await _upgrade(connection)
            defaults = await _defaults(connection, seeded.organization_id)
        assert defaults == [seeded.project_ids[1]]
        printed = capsys.readouterr().out
        for cleared in (seeded.project_ids[0], seeded.project_ids[2]):
            assert f"cleared default project {cleared}" in printed
        assert str(seeded.project_ids[1]) not in printed
    finally:
        await delete_seeded_organization(seeded)


async def test_053_sets_no_default_where_none_exists():
    seeded = await _no_default_organization()
    try:
        async with rolled_back_connection(organizations=[seeded]) as connection:
            await _upgrade(connection)
            defaults = await _defaults(connection, seeded.organization_id)
        assert defaults == []
    finally:
        await delete_seeded_organization(seeded)


async def test_053_repairs_before_it_consolidates():
    # P's foreign workspace is `default`-type: if the ranking ran first, P would win O1.
    cross, other = await _cross_organization_project(foreign_default_type=True)
    try:
        async with rolled_back_connection(organizations=[cross]) as connection:
            await _upgrade(connection)
            defaults = await _defaults(connection, cross.organization_id)
            foreign = await _defaults(connection, other.organization_id)
        assert defaults == [cross.project_ids[0]]
        assert foreign == [other.project_ids[0]]
    finally:
        await delete_seeded_organization(cross)


async def test_053_is_idempotent():
    seeded = await _multi_default_organization()
    cross, _ = await _cross_organization_project()
    try:
        async with rolled_back_connection(organizations=[seeded, cross]) as connection:
            first = await _switch(connection, None)
            second = await _switch(connection, None)
        assert first["repaired"] == 1 and first["cleared"] >= 2
        assert second == {
            "repaired": 0,
            "organizations_with_several_defaults": 0,
            "cleared": 0,
        }
    finally:
        await delete_seeded_organization(seeded)
        await delete_seeded_organization(cross)


async def test_053_keeps_project_access():
    seeded = await _multi_default_organization()
    cross, _ = await _cross_organization_project()
    try:
        async with rolled_back_connection(organizations=[seeded, cross]) as connection:
            dao = MembershipsDAO(engine=ConnectionEngine(connection))
            pairs = [
                (user_id, project_id)
                for org in (seeded, cross)
                for user_id in org.user_ids.values()
                for project_id in org.project_ids
            ]

            async def answers():
                out = {}
                for user_id, project_id in pairs:
                    row = await dao.fetch_membership_row(
                        user_id=user_id, project_id=project_id
                    )
                    out[(user_id, project_id)] = (
                        None
                        if row is None
                        else (
                            row.summary.organization_id,
                            row.has_organization_row,
                            row.organization_role,
                            row.has_project_row,
                            row.project_role,
                        )
                    )
                return out

            before = await answers()
            await _upgrade(connection)
            after = await answers()
        assert before == after
        assert all(value is not None for value in after.values())
    finally:
        await delete_seeded_organization(seeded)
        await delete_seeded_organization(cross)


async def test_053_downgrade_is_a_noop():
    seeded = await _multi_default_organization()
    try:
        async with rolled_back_connection(organizations=[seeded]) as connection:
            await _upgrade(connection)
            before = await _rows(connection, "SELECT * FROM projects ORDER BY id")

            def run(sync_connection):
                context = MigrationContext.configure(sync_connection)
                with Operations.context(context):
                    _revision().downgrade()

            await connection.run_sync(run)
            after = await _rows(connection, "SELECT * FROM projects ORDER BY id")
        assert before == after
    finally:
        await delete_seeded_organization(seeded)


async def test_053_locks_only_organizations_with_several_defaults():
    several = await _multi_default_organization()
    single = await seed_organization(members={"m": "editor"}, workspaces=1)
    none = await _no_default_organization()
    try:
        async with rolled_back_connection(
            organizations=[several, single, none]
        ) as connection:
            await _upgrade(connection)
            advisory = await _rows(
                connection,
                "SELECT objid FROM pg_locks WHERE locktype = 'advisory' "
                "AND pid = pg_backend_pid()",
            )
        assert len(advisory) == 1
    finally:
        for seeded in (several, single, none):
            await delete_seeded_organization(seeded)


# --- 053 against concurrent default writers ----------------------------------- #
#
# Two connections on the real tables, in an explicit order. The revision's `switch` is
# limited to the test's organization.

_STEP1_CLEAR_ORGANIZATION_SQL = (
    "UPDATE projects SET is_default = false "
    "WHERE organization_id = :o AND is_default = true"
)
_STEP1_CLEAR_WORKSPACE_SQL = (
    "UPDATE projects SET is_default = false "
    "WHERE workspace_id = :w AND is_default = true"
)
_STEP1_SET_SQL = "UPDATE projects SET is_default = true WHERE id = :p"


async def _add_project(*, organization_id, workspace_id, is_default) -> UUID:
    project_id = uuid4()
    await execute(
        "INSERT INTO projects (id, project_name, is_default, organization_id, workspace_id, "
        "created_at, updated_at) VALUES (:id, 'extra', :d, :o, :w, clock_timestamp(), "
        "clock_timestamp())",
        {"id": project_id, "d": is_default, "o": organization_id, "w": workspace_id},
    )
    return project_id


async def _committed_defaults(organization_id) -> list:
    return [
        row["id"]
        for row in await fetch_all(
            "SELECT id FROM projects WHERE organization_id = :o AND is_default IS TRUE "
            "ORDER BY id",
            {"o": organization_id},
        )
    ]


async def _blocked(task, seconds=0.4) -> bool:
    await asyncio.sleep(seconds)
    return not task.done()


async def _migration_task(organization_id):
    engine = get_transactions_engine()._engine

    async def run():
        async with engine.begin() as connection:
            await connection.execute(text("SET LOCAL lock_timeout = '2s'"))
            return await _switch(connection, [organization_id])

    return asyncio.create_task(run())


async def test_053_waits_for_a_step1_null_workspace_promotion():
    seeded = await _multi_default_organization()
    try:
        target = await _add_project(
            organization_id=seeded.organization_id, workspace_id=None, is_default=False
        )
        engine = get_transactions_engine()._engine
        async with engine.connect() as a:
            transaction = await a.begin()
            await a.execute(
                text(_STEP1_CLEAR_ORGANIZATION_SQL), {"o": seeded.organization_id}
            )
            migration = await _migration_task(seeded.organization_id)
            assert await _blocked(migration)
            await a.execute(text(_STEP1_SET_SQL), {"p": target})
            await transaction.commit()
        counts = await migration
        assert counts["cleared"] == 0
        assert await _committed_defaults(seeded.organization_id) == [target]
    finally:
        await delete_seeded_organization(seeded)


async def test_step1_promotion_after_053_waits_and_keeps_one_default():
    seeded = await _multi_default_organization()
    try:
        target = await _add_project(
            organization_id=seeded.organization_id, workspace_id=None, is_default=False
        )
        engine = get_transactions_engine()._engine
        async with engine.connect() as b:
            transaction = await b.begin()
            await _switch(b, [seeded.organization_id])

            async def step1():
                async with engine.begin() as a:
                    await a.execute(
                        text(_STEP1_CLEAR_ORGANIZATION_SQL),
                        {"o": seeded.organization_id},
                    )
                    await a.execute(text(_STEP1_SET_SQL), {"p": target})

            promotion = asyncio.create_task(step1())
            assert await _blocked(promotion)
            await transaction.commit()
        await promotion
        assert await _committed_defaults(seeded.organization_id) == [target]
    finally:
        await delete_seeded_organization(seeded)


async def test_step1_workspace_promotion_after_053_may_leave_two_defaults_never_zero():
    seeded = await _multi_default_organization()
    try:
        secondary = seeded.workspace_ids[2]
        target = await _add_project(
            organization_id=seeded.organization_id,
            workspace_id=secondary,
            is_default=False,
        )
        engine = get_transactions_engine()._engine
        async with engine.connect() as b:
            transaction = await b.begin()
            await _switch(b, [seeded.organization_id])

            async def step1():
                async with engine.begin() as a:
                    await a.execute(text(_STEP1_CLEAR_WORKSPACE_SQL), {"w": secondary})
                    await a.execute(text(_STEP1_SET_SQL), {"p": target})

            promotion = asyncio.create_task(step1())
            await asyncio.sleep(0.3)
            await transaction.commit()
        await promotion
        defaults = await _committed_defaults(seeded.organization_id)
        assert sorted(defaults) == sorted([seeded.project_ids[1], target])
    finally:
        await delete_seeded_organization(seeded)


async def test_step1_stale_project_read_keeps_a_default():
    # Step-1 `set_default_project` reads the target, sees `is_default` true and returns
    # without writing ("already default"). When 053 cleared that project in between, the
    # organization still keeps exactly one default: the D-11 winner.
    seeded = await _multi_default_organization()
    try:
        stale = seeded.project_ids[0]
        read = await fetch_all(
            "SELECT is_default FROM projects WHERE id = :p", {"p": stale}
        )
        assert read[0]["is_default"] is True
        engine = get_transactions_engine()._engine
        async with engine.begin() as b:
            await _switch(b, [seeded.organization_id])
        # The step-1 writer returns here from its stale read; nothing else runs.
        assert await _committed_defaults(seeded.organization_id) == [
            seeded.project_ids[1]
        ]
    finally:
        await delete_seeded_organization(seeded)
