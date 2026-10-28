"""Workspace removal step 3 on a migrated database.

Needs a database at `oss000000056` or later (the step 3 schema); skipped otherwise. The
round trip runs `downgrade()` and `upgrade()` inside one transaction that is always
rolled back, so the shared database keeps nothing.
"""

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from oss.tests.pytest.utils.membership_seed import (
    fetch_all,
    load_revision_module,
    rolled_back_connection,
)


pytestmark = [
    pytest.mark.integration,
    pytest.mark.xdist_group("memberships_global_sql"),
]

_DROP = "oss000000056_drop_workspaces.py"

_OBJECTS_SQL = """
SELECT to_regclass('public.workspaces') IS NOT NULL AS workspaces,
       to_regclass('public.workspace_members') IS NOT NULL AS workspace_members,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'projects'
                 AND column_name = 'workspace_id') AS projects_workspace_id
"""


async def _require_the_step_3_schema():
    rows = await fetch_all("SELECT version_num FROM alembic_version_oss")
    if not any(row["version_num"] >= "oss000000056" for row in rows):
        pytest.skip("the database is not at oss000000056 (workspace removal step 3)")


async def _objects(connection) -> dict:
    return dict((await connection.execute(text(_OBJECTS_SQL))).mappings().one())


async def _run(connection, function):
    def run(sync_connection):
        context = MigrationContext.configure(sync_connection)
        with Operations.context(context):
            function()

    await connection.run_sync(run)


async def test_the_workspace_storage_is_gone():
    await _require_the_step_3_schema()
    async with rolled_back_connection() as connection:
        assert await _objects(connection) == {
            "workspaces": False,
            "workspace_members": False,
            "projects_workspace_id": False,
        }


async def test_downgrade_restores_an_empty_schema_and_upgrade_drops_it_again():
    await _require_the_step_3_schema()
    revision = load_revision_module(_DROP)
    async with rolled_back_connection() as connection:
        # The downgrade and upgrade lock both tables through their foreign keys; take
        # them in one statement first, so a fixture that writes users then
        # organizations in parallel waits instead of deadlocking.
        await connection.execute(
            text("LOCK TABLE organizations, users IN SHARE ROW EXCLUSIVE MODE")
        )
        await _run(connection, revision.downgrade)
        assert await _objects(connection) == {
            "workspaces": True,
            "workspace_members": True,
            "projects_workspace_id": True,
        }
        count = (
            await connection.execute(text("SELECT count(*) FROM workspaces"))
        ).scalar_one()
        assert count == 0
        await _run(connection, revision.upgrade)
        assert await _objects(connection) == {
            "workspaces": False,
            "workspace_members": False,
            "projects_workspace_id": False,
        }
