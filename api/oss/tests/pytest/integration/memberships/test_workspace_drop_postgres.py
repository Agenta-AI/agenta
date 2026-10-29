"""Workspace removal step 3 on a migrated database.

Needs a database at `oss000000056` or later (the step 3 schema); skipped otherwise. The
downgrade round trip is not run here: its DDL locks shared tables and deadlocks with
tests that run in parallel.
"""

import pytest
from sqlalchemy import text

from oss.tests.pytest.utils.membership_seed import (
    fetch_all,
    rolled_back_connection,
)


pytestmark = [
    pytest.mark.integration,
    pytest.mark.xdist_group("memberships_global_sql"),
]


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


async def test_the_workspace_storage_is_gone():
    await _require_the_step_3_schema()
    async with rolled_back_connection() as connection:
        assert await _objects(connection) == {
            "workspaces": False,
            "workspace_members": False,
            "projects_workspace_id": False,
        }
