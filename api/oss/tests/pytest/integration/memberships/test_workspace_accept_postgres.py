"""Workspace removal step 1 ("accept") against a migrated Postgres.

Revision `oss000000052` drops every foreign key from `projects.workspace_id` to
`workspaces` and makes the column nullable, so step 2 can stop writing it. These cases pin
the schema and the lookup that finds the foreign keys by definition.
"""

from uuid import uuid4

import pytest
from sqlalchemy import text

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    load_revision_sql,
    rolled_back_connection,
    seed_organization,
)


pytestmark = pytest.mark.integration

_REVISION = "oss000000052_drop_projects_workspace_cascade.py"


def _find_foreign_keys_sql() -> str:
    return load_revision_sql(_REVISION, "_FIND_WORKSPACE_FOREIGN_KEYS_SQL")


# --- revision -------------------------------------------------------------- #


async def test_projects_have_no_workspace_foreign_key():
    async with get_transactions_engine().transaction() as connection:
        rows = (await connection.execute(text(_find_foreign_keys_sql()))).all()

    assert rows == []


async def test_projects_workspace_id_is_nullable():
    async with get_transactions_engine().transaction() as connection:
        nullable = (
            await connection.execute(
                text(
                    "SELECT is_nullable FROM information_schema.columns "
                    "WHERE table_schema = current_schema() "
                    "AND table_name = 'projects' AND column_name = 'workspace_id'"
                )
            )
        ).scalar_one()

    assert nullable == "YES"


async def test_the_lookup_finds_a_foreign_key_with_any_name():
    async with rolled_back_connection() as connection:
        # Temp tables in `pg_temp` shadow the real ones for this session.
        await connection.execute(
            text("CREATE TEMP TABLE workspaces (id uuid PRIMARY KEY) ON COMMIT DROP")
        )
        await connection.execute(
            text(
                "CREATE TEMP TABLE projects (id uuid, workspace_id uuid "
                "CONSTRAINT odd_name REFERENCES pg_temp.workspaces(id) ON DELETE CASCADE) "
                "ON COMMIT DROP"
            )
        )
        names = [
            row.conname
            for row in (await connection.execute(text(_find_foreign_keys_sql()))).all()
        ]

    assert names == ["odd_name"]


async def test_deleting_a_workspace_row_keeps_its_projects():
    seeded = await seed_organization(members={"owner": "owner"})
    try:
        async with rolled_back_connection() as connection:
            await connection.execute(
                text("DELETE FROM workspaces WHERE id = :id"),
                {"id": seeded.workspace_ids[0]},
            )
            row = (
                await connection.execute(
                    text("SELECT workspace_id FROM projects WHERE id = :id"),
                    {"id": seeded.project_ids[0]},
                )
            ).one_or_none()

        assert row is not None
        assert row.workspace_id == seeded.workspace_ids[0]
    finally:
        await delete_seeded_organization(seeded)


async def test_a_project_can_be_written_without_a_workspace():
    seeded = await seed_organization(members={"owner": "owner"})
    try:
        async with rolled_back_connection() as connection:
            project_id = uuid4()
            await connection.execute(
                text(
                    "INSERT INTO projects (id, project_name, is_default, organization_id, "
                    "workspace_id, created_at, updated_at) "
                    "VALUES (:id, 'no-workspace', false, :organization_id, NULL, now(), now())"
                ),
                {"id": project_id, "organization_id": seeded.organization_id},
            )
            stored = (
                await connection.execute(
                    text("SELECT workspace_id FROM projects WHERE id = :id"),
                    {"id": project_id},
                )
            ).scalar_one()

        assert stored is None
    finally:
        await delete_seeded_organization(seeded)
