"""Workspace removal step 2b ("stop reading") against a migrated Postgres.

Revision `oss000000055` reruns the repair and the one-default consolidation of
`oss000000053`: pods of the step-1 release could write a second default or a
cross-organization workspace during the step 2 rollout, and from step 2b on no reader
looks at `workspaces` or `projects.workspace_id` to pick between them.

Global statements run on temp copies of the membership tables
(`rolled_back_connection(organizations=...)`), so they never lock rows of tests that run
in parallel.
"""

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

from oss.src.services import db_manager
from oss.tests.pytest.utils.membership_seed import (
    ConnectionEngine,
    SeededOrganization,
    delete_seeded_organization,
    execute,
    load_revision_module,
    rolled_back_connection,
    seed_organization,
)


pytestmark = pytest.mark.integration

_REVISION = "oss000000055_rerun_organization_defaults.py"
_STEP_2_REVISION = "oss000000053_switch_projects_to_organization_defaults.py"


def _revision():
    return load_revision_module(_REVISION)


async def _multi_default_organization() -> SeededOrganization:
    """Three workspaces, each with a default project; the `default`-type workspace is
    the second one, so the D-11 default is project 1, not the oldest (project 0)."""

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


async def _run(connection, function):
    def run(sync_connection):
        context = MigrationContext.configure(sync_connection)
        with Operations.context(context):
            function()

    await connection.run_sync(run)


async def _step_2(connection, organization_ids):
    module = load_revision_module(_STEP_2_REVISION)
    await connection.run_sync(lambda sync: module.switch(sync, organization_ids))


async def _defaults(connection, organization_id):
    rows = await connection.execute(
        text(
            "SELECT id FROM projects WHERE organization_id = :o AND is_default IS TRUE "
            "ORDER BY id"
        ),
        {"o": organization_id},
    )
    return [row.id for row in rows]


def test_055_follows_053_and_reuses_its_switch():
    revision = _revision()
    assert (revision.revision, revision.down_revision) == (
        "oss000000055",
        "oss000000053",
    )
    step_2 = revision._step_2_revision()
    assert step_2.revision == "oss000000053"
    assert callable(step_2.switch)


async def test_055_clears_a_second_default_written_after_053():
    seeded = await _multi_default_organization()
    try:
        async with rolled_back_connection(organizations=[seeded]) as connection:
            await _step_2(connection, [seeded.organization_id])
            assert await _defaults(connection, seeded.organization_id) == [
                seeded.project_ids[1]
            ]
            # A step-1 pod makes a project of a secondary workspace the default again.
            await connection.execute(
                text("UPDATE projects SET is_default = true WHERE id = :p"),
                {"p": seeded.project_ids[2]},
            )
            await _run(connection, _revision().upgrade)
            assert await _defaults(connection, seeded.organization_id) == [
                seeded.project_ids[1]
            ]
    finally:
        await delete_seeded_organization(seeded)


async def test_055_repairs_a_cross_organization_project_written_after_053():
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    other = await seed_organization(members={"owner": "owner"})
    seeded.extra_organization_ids.append(other.organization_id)
    seeded.extra_user_ids.extend(other.user_ids.values())
    try:
        async with rolled_back_connection(organizations=[seeded]) as connection:
            await _step_2(connection, [seeded.organization_id])
            await connection.execute(
                text("UPDATE projects SET workspace_id = :w WHERE id = :p"),
                {"w": other.workspace_ids[0], "p": seeded.project_ids[1]},
            )
            await _run(connection, _revision().upgrade)
            row = (
                await connection.execute(
                    text(
                        "SELECT workspace_id, organization_id FROM projects WHERE id = :p"
                    ),
                    {"p": seeded.project_ids[1]},
                )
            ).first()
            assert row.workspace_id is None
            assert row.organization_id == seeded.organization_id
    finally:
        await delete_seeded_organization(seeded)


async def test_055_is_idempotent_and_changes_nothing_after_053(capsys):
    seeded = await _multi_default_organization()
    try:
        async with rolled_back_connection(organizations=[seeded]) as connection:
            await _step_2(connection, [seeded.organization_id])
            capsys.readouterr()
            await _run(connection, _revision().upgrade)
            output = capsys.readouterr().out
            assert "cleared default project" not in output
            assert "repaired project" not in output
            assert await _defaults(connection, seeded.organization_id) == [
                seeded.project_ids[1]
            ]
    finally:
        await delete_seeded_organization(seeded)


async def test_055_downgrade_is_a_noop():
    seeded = await _multi_default_organization()
    try:
        async with rolled_back_connection(organizations=[seeded]) as connection:
            await _step_2(connection, [seeded.organization_id])
            await _run(connection, _revision().upgrade)
            before = await _defaults(connection, seeded.organization_id)
            await _run(connection, _revision().downgrade)
            assert await _defaults(connection, seeded.organization_id) == before
    finally:
        await delete_seeded_organization(seeded)


async def test_readers_after_055_answer_the_d11_default_without_workspaces(
    monkeypatch,
):
    """After the rerun, the 2b readers (no workspace join) answer the same project the
    step-2 readers answered by the D-11 order."""

    seeded = await _multi_default_organization()
    try:
        async with rolled_back_connection(organizations=[seeded]) as connection:
            await _step_2(connection, [seeded.organization_id])
            await connection.execute(
                text("UPDATE projects SET is_default = true WHERE id = :p"),
                {"p": seeded.project_ids[0]},
            )
            await _run(connection, _revision().upgrade)
            monkeypatch.setattr(
                db_manager,
                "get_transactions_engine",
                lambda: ConnectionEngine(connection),
            )
            default = await db_manager.fetch_default_project(
                organization_id=str(seeded.organization_id)
            )
            project = await db_manager.get_project_by_workspace(
                str(seeded.organization_id)
            )
            assert default.project_id == seeded.project_ids[1]
            assert project.id == seeded.project_ids[1]
            # A legacy workspace id names no organization any more.
            assert (
                await db_manager.fetch_default_project(
                    organization_id=str(seeded.workspace_ids[1])
                )
                is None
            )
    finally:
        await delete_seeded_organization(seeded)
