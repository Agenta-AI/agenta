"""Workspace removal step 1 ("accept") against a migrated Postgres.

Revision `oss000000052` drops every foreign key from `projects.workspace_id` to
`workspaces` and makes the column nullable, so step 2 can stop writing it. These cases pin
the schema, the lookup that finds the foreign keys by definition, and the readers and
writers that serve the rows step 2 writes (a project without a workspace, an organization
without workspace rows) while every answer for an existing row stays as it is.
"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

import oss.src.services.db_manager as db_manager
from oss.src.dbs.postgres.access.dao import PrincipalsDAO
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    SeededOrganization,
    delete_seeded_organization,
    execute,
    fetch_all,
    load_revision_sql,
    rolled_back_connection,
    seed_organization,
)
from oss.tests.pytest.utils.statements import count_statements


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


# --- step-2-shaped data ------------------------------------------------------ #


async def _seed_organization_without_workspaces(
    *, members: dict | None = None
) -> SeededOrganization:
    """An organization as step 2 writes it: no workspace and no workspace member rows,
    and a default project whose `workspace_id` is NULL."""

    seeded = await seed_organization(members=members or {"owner": "owner"})
    await execute(
        "UPDATE projects SET workspace_id = NULL WHERE organization_id = :o",
        {"o": seeded.organization_id},
    )
    await execute(
        "DELETE FROM workspaces WHERE organization_id = :o",
        {"o": seeded.organization_id},
    )
    seeded.workspace_ids = []
    return seeded


async def _organization_name(organization_id: UUID) -> str:
    rows = await fetch_all(
        "SELECT name FROM organizations WHERE id = :id", {"id": organization_id}
    )
    return rows[0]["name"]


async def _add_project(
    *,
    organization_id: UUID,
    workspace_id,
    is_default,
    name: str = "extra",
) -> UUID:
    project_id = uuid4()
    await execute(
        "INSERT INTO projects (id, project_name, is_default, organization_id, workspace_id, "
        "created_at, updated_at) VALUES (:id, :name, :d, :o, :w, clock_timestamp(), "
        "clock_timestamp())",
        {
            "id": project_id,
            "name": name,
            "d": is_default,
            "o": organization_id,
            "w": workspace_id,
        },
    )
    return project_id


async def _seed_cross_organization_project() -> SeededOrganization:
    """Project P of O1 whose workspace W belongs to O2 (a legacy shape)."""

    cross = await seed_organization(members={"m": "editor"})
    other = await seed_organization(members={"owner": "owner"})
    await execute(
        "UPDATE projects SET workspace_id = :ws WHERE id = :p",
        {"ws": other.workspace_ids[0], "p": cross.project_ids[0]},
    )
    cross.extra_organization_ids.append(other.organization_id)
    cross.extra_user_ids.extend(other.user_ids.values())
    cross.workspace_ids = [other.workspace_ids[0]]
    return cross


def _dao() -> MembershipsDAO:
    return MembershipsDAO(engine=get_transactions_engine())


# --- resolver readers ------------------------------------------------------- #


async def test_resolver_lists_a_project_without_workspace():
    seeded = await _seed_organization_without_workspaces()
    try:
        name = await _organization_name(seeded.organization_id)
        engine = get_transactions_engine()
        with count_statements(engine) as fetched:
            row = await _dao().fetch_membership_row(
                user_id=seeded.owner_id, project_id=seeded.project_ids[0]
            )
        with count_statements(engine) as listed:
            rows = await _dao().list_membership_rows(user_id=seeded.owner_id)

        assert row is not None
        assert row.summary.workspace_id == seeded.organization_id
        assert row.summary.workspace_name == name
        assert len(fetched) == 1
        mine = [r for r in rows if r.summary.organization_id == seeded.organization_id]
        assert [r.summary.project_id for r in mine] == [seeded.project_ids[0]]
        assert mine[0].summary.workspace_id == seeded.organization_id
        assert mine[0].summary.workspace_name == name
        assert len(listed) == 1

        projects = await _dao().list_projects(organization_ids=[seeded.organization_id])
        assert [p.workspace_id for p in projects] == [seeded.organization_id]
    finally:
        await delete_seeded_organization(seeded)


async def test_resolver_rows_of_legacy_projects_are_unchanged():
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    cross = await _seed_cross_organization_project()
    try:
        for org, user_id in (
            (seeded, seeded.user_ids["m"]),
            (cross, cross.user_ids["m"]),
        ):
            expected = {
                row["id"]: (row["workspace_id"], row["name"])
                for row in await fetch_all(
                    "SELECT p.id, p.workspace_id, w.name FROM projects p "
                    "JOIN workspaces w ON w.id = p.workspace_id "
                    "WHERE p.organization_id = :o",
                    {"o": org.organization_id},
                )
            }
            for project_id, (workspace_id, workspace_name) in expected.items():
                row = await _dao().fetch_membership_row(
                    user_id=user_id, project_id=project_id
                )
                assert row.summary.workspace_id == workspace_id
                assert row.summary.workspace_name == workspace_name
            listed = {
                r.summary.project_id: (r.summary.workspace_id, r.summary.workspace_name)
                for r in await _dao().list_membership_rows(user_id=user_id)
                if r.summary.organization_id == org.organization_id
            }
            assert listed == expected
    finally:
        await delete_seeded_organization(seeded)
        await delete_seeded_organization(cross)


# --- default project of a workspace or organization ------------------------- #


async def _multi_workspace_organization() -> SeededOrganization:
    """Three workspaces; the `default`-type one is created second; each has a default."""

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


async def test_fetch_default_project_by_workspace_id():
    seeded = await _multi_workspace_organization()
    try:
        for workspace_id, project_id in zip(seeded.workspace_ids, seeded.project_ids):
            ref = await db_manager.fetch_default_project(
                workspace_or_organization_id=str(workspace_id)
            )
            # Step 2: any id of the organization answers the organization's default.
            assert ref.project_id == seeded.project_ids[1]
            assert ref.ref_workspace_id == workspace_id
            assert ref.ref_organization_id == seeded.organization_id
    finally:
        await delete_seeded_organization(seeded)


async def test_fetch_default_project_by_organization_id():
    seeded = await _multi_workspace_organization()
    try:
        ref = await db_manager.fetch_default_project(
            workspace_or_organization_id=str(seeded.organization_id)
        )
        assert ref.project_id == seeded.project_ids[1]  # the default-type workspace
        assert ref.ref_organization_id == seeded.organization_id
    finally:
        await delete_seeded_organization(seeded)


async def test_fetch_default_project_of_an_organization_without_workspaces():
    seeded = await _seed_organization_without_workspaces()
    try:
        ref = await db_manager.fetch_default_project(
            workspace_or_organization_id=str(seeded.organization_id)
        )
        assert ref.project_id == seeded.project_ids[0]
        assert ref.project_workspace_id is None
        assert ref.ref_organization_id == seeded.organization_id
    finally:
        await delete_seeded_organization(seeded)


async def test_fetch_default_project_of_an_unknown_id():
    assert (
        await db_manager.fetch_default_project(
            workspace_or_organization_id=str(uuid4())
        )
        is None
    )


async def test_fetch_default_project_of_the_cross_organization_project():
    cross = await _seed_cross_organization_project()
    try:
        workspace_id = cross.workspace_ids[0]
        ref = await db_manager.fetch_default_project(
            workspace_or_organization_id=str(workspace_id)
        )
        # The workspace's own default is the cross-organization project, as today; the
        # organization of the reference is the workspace's organization, as today.
        own = await fetch_all(
            "SELECT id FROM projects WHERE workspace_id = :w AND is_default IS TRUE "
            "ORDER BY created_at, id",
            {"w": workspace_id},
        )
        assert ref.project_id in [row["id"] for row in own]
        assert ref.ref_organization_id == cross.extra_organization_ids[0]
    finally:
        await delete_seeded_organization(cross)


async def test_fetch_default_project_after_the_step2_consolidation():
    seeded = await _multi_workspace_organization()
    try:
        secondary = seeded.workspace_ids[2]
        await execute(
            "UPDATE projects SET is_default = false WHERE id = :p",
            {"p": seeded.project_ids[2]},
        )
        by_workspace = await db_manager.fetch_default_project(
            workspace_or_organization_id=str(secondary)
        )
        by_organization = await db_manager.fetch_default_project(
            workspace_or_organization_id=str(seeded.organization_id)
        )
        assert by_workspace.project_id == seeded.project_ids[1]
        assert by_organization.project_id == seeded.project_ids[1]
    finally:
        await delete_seeded_organization(seeded)


async def test_fetch_default_project_is_one_statement():
    seeded = await _multi_workspace_organization()
    try:
        engine = get_transactions_engine()
        for ref in (seeded.workspace_ids[0], seeded.organization_id, uuid4()):
            await db_manager.fetch_default_project(
                workspace_or_organization_id=str(ref)
            )
            with count_statements(engine) as statements:
                await db_manager.fetch_default_project(
                    workspace_or_organization_id=str(ref)
                )
            assert len(statements) == 1, statements
    finally:
        await delete_seeded_organization(seeded)


async def test_get_default_project_id_from_workspace_keeps_its_contract():
    seeded = await _multi_workspace_organization()
    try:
        assert await db_manager.get_default_project_id_from_workspace(
            workspace_id=str(seeded.workspace_ids[0])
        ) == str(seeded.project_ids[1])
        assert await db_manager.get_default_project_id_from_workspace(
            workspace_id=str(seeded.organization_id)
        ) == str(seeded.project_ids[1])
        with pytest.raises(db_manager.NoResultFound):
            await db_manager.get_default_project_id_from_workspace(
                workspace_id=str(uuid4())
            )
    finally:
        await delete_seeded_organization(seeded)


# --- get_project_by_workspace ----------------------------------------------- #

# Today's statement: the workspace's projects, `is_default DESC` (NULLS FIRST), then
# `created_at ASC`. Step 1 keeps this answer for every workspace that has a project.
_TODAY_PROJECT_BY_WORKSPACE_SQL = """
SELECT id FROM projects WHERE workspace_id = :w
ORDER BY is_default DESC, created_at ASC
"""


async def test_get_project_by_workspace_accepts_the_organization_id():
    seeded = await _multi_workspace_organization()
    no_workspaces = await _seed_organization_without_workspaces()
    try:
        project = await db_manager.get_project_by_workspace(
            workspace_id=str(seeded.organization_id)
        )
        assert project.id == seeded.project_ids[1]
        project = await db_manager.get_project_by_workspace(
            workspace_id=str(no_workspaces.organization_id)
        )
        assert project.id == no_workspaces.project_ids[0]
        with pytest.raises(db_manager.NoResultFound):
            await db_manager.get_project_by_workspace(workspace_id=str(uuid4()))
    finally:
        await delete_seeded_organization(seeded)
        await delete_seeded_organization(no_workspaces)


async def test_get_project_by_workspace_keeps_a_workspace_without_default():
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    try:
        secondary = seeded.workspace_ids[1]
        await execute(
            "UPDATE projects SET is_default = false WHERE id = :p",
            {"p": seeded.project_ids[1]},
        )
        project = await db_manager.get_project_by_workspace(workspace_id=str(secondary))
        # Step 2: the organization's default, not the workspace's own project.
        assert project.id == seeded.project_ids[0]
    finally:
        await delete_seeded_organization(seeded)


async def test_get_project_by_workspace_keeps_today_order_for_null_defaults():
    seeded = await seed_organization(members={"m": "editor"})
    try:
        workspace_id = seeded.workspace_ids[0]
        null_default = await _add_project(
            organization_id=seeded.organization_id,
            workspace_id=workspace_id,
            is_default=None,
            name="null-default",
        )
        project = await db_manager.get_project_by_workspace(
            workspace_id=str(workspace_id)
        )
        today = await fetch_all(_TODAY_PROJECT_BY_WORKSPACE_SQL, {"w": workspace_id})
        assert today[0]["id"] == null_default  # NULLS FIRST under DESC
        # Step 2: the default project wins (`is_default IS TRUE` first).
        assert project.id == seeded.project_ids[0]
    finally:
        await delete_seeded_organization(seeded)


async def test_both_default_helpers_stay_in_the_organization_after_the_step2_consolidation():
    seeded = await _multi_workspace_organization()
    try:
        secondary = seeded.workspace_ids[2]
        await execute(
            "UPDATE projects SET is_default = false WHERE id = :p",
            {"p": seeded.project_ids[2]},
        )
        by_route = await db_manager.get_project_by_workspace(
            workspace_id=str(secondary)
        )
        by_bearer = await db_manager.fetch_default_project(
            workspace_or_organization_id=str(secondary)
        )
        # Step 2: both helpers answer the organization default.
        assert by_route.id == seeded.project_ids[1]
        assert by_bearer.project_id == seeded.project_ids[1]
        assert by_route.organization_id == seeded.organization_id
        assert by_bearer.project_organization_id == seeded.organization_id
    finally:
        await delete_seeded_organization(seeded)


# --- writers ---------------------------------------------------------------- #


async def test_create_project_in_an_organization_without_workspaces():
    seeded = await _seed_organization_without_workspaces()
    try:
        created = await _dao().create_project(
            organization_id=seeded.organization_id,
            name="no-workspace",
            is_default=False,
        )
        rows = await fetch_all(
            "SELECT workspace_id, is_default FROM projects WHERE id = :p",
            {"p": created.scope.project_id},
        )
        assert rows[0]["workspace_id"] is None
        assert rows[0]["is_default"] is False  # the organization has a default
        assert created.scope.workspace_id == seeded.organization_id

        made_default = await _dao().create_project(
            organization_id=seeded.organization_id,
            name="no-workspace-default",
            is_default=True,
        )
        defaults = await fetch_all(
            "SELECT id FROM projects WHERE organization_id = :o AND is_default IS TRUE",
            {"o": seeded.organization_id},
        )
        assert [row["id"] for row in defaults] == [made_default.scope.project_id]
    finally:
        await delete_seeded_organization(seeded)


async def test_set_default_project_without_workspace_clears_every_default_of_its_organization():
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    try:
        no_workspace = await _add_project(
            organization_id=seeded.organization_id, workspace_id=None, is_default=False
        )
        await db_manager.set_default_project(project_id=str(no_workspace))
        defaults = await fetch_all(
            "SELECT id FROM projects WHERE organization_id = :o AND is_default IS TRUE",
            {"o": seeded.organization_id},
        )
        assert [row["id"] for row in defaults] == [no_workspace]
    finally:
        await delete_seeded_organization(seeded)


async def test_set_default_project_with_a_workspace_keeps_the_workspace_scope():
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    try:
        extra = await _add_project(
            organization_id=seeded.organization_id,
            workspace_id=seeded.workspace_ids[1],
            is_default=False,
        )
        await db_manager.set_default_project(project_id=str(extra))
        defaults = {
            row["id"]
            for row in await fetch_all(
                "SELECT id FROM projects WHERE organization_id = :o AND is_default IS TRUE",
                {"o": seeded.organization_id},
            )
        }
        # Step 2: the default is organization-wide.
        assert defaults == {extra}
    finally:
        await delete_seeded_organization(seeded)


async def test_mixed_organization_writes_from_both_versions():
    seeded = await _multi_workspace_organization()
    try:
        await execute(
            "UPDATE projects SET is_default = false WHERE id = :p",
            {"p": seeded.project_ids[2]},
        )
        # (1) Step 2: a project created as default clears every other default of the
        # organization (no second default).
        created = await _dao().create_project(
            organization_id=seeded.organization_id,
            name="step2-default",
            is_default=True,
        )
        ref = await db_manager.fetch_default_project(
            workspace_or_organization_id=str(seeded.organization_id)
        )
        assert ref.project_id == created.scope.project_id
        # (2) A step-2-shaped write: a NULL-workspace project becomes the only default.
        step2 = await _add_project(
            organization_id=seeded.organization_id, workspace_id=None, is_default=False
        )
        await db_manager.set_default_project(project_id=str(step2))
        ref = await db_manager.fetch_default_project(
            workspace_or_organization_id=str(seeded.organization_id)
        )
        assert ref.project_id == step2
        listed = await _dao().list_projects(organization_ids=[seeded.organization_id])
        ids = [p.project_id for p in listed]
        assert len(ids) == len(set(ids))
        by_id = {p.project_id: p.workspace_id for p in listed}
        assert by_id[step2] == seeded.organization_id
        assert by_id[seeded.project_ids[0]] == seeded.workspace_ids[0]
    finally:
        await delete_seeded_organization(seeded)


# --- workspace list items ---------------------------------------------------- #


async def test_user_workspace_items_add_organizations_without_workspaces():
    seeded = await _seed_organization_without_workspaces()
    try:
        engine = get_transactions_engine()
        await db_manager.fetch_user_workspace_items(user_id=str(seeded.owner_id))
        with count_statements(engine) as statements:
            items = await db_manager.fetch_user_workspace_items(
                user_id=str(seeded.owner_id)
            )
        assert len(statements) == 1
        mine = [i for i in items if i.organization_id == seeded.organization_id]
        assert len(mine) == 1
        assert mine[0].id == seeded.organization_id
        assert mine[0].name == await _organization_name(seeded.organization_id)
        assert mine[0].type == "default"
    finally:
        await delete_seeded_organization(seeded)


async def test_user_workspace_items_add_members_without_a_workspace_row():
    seeded = await seed_organization(
        members={"owner": "owner", "m": "editor"}, workspace_rows=False
    )
    try:
        items = await db_manager.fetch_user_workspace_items(
            user_id=str(seeded.user_ids["m"])
        )
        assert [(i.id, i.organization_id) for i in items] == [
            (seeded.organization_id, seeded.organization_id)
        ]
    finally:
        await delete_seeded_organization(seeded)


async def test_user_workspace_items_of_legacy_users_equal_today():
    seeded = await seed_organization(members={"m": "editor"}, workspaces=3)
    try:
        for user_id in seeded.user_ids.values():
            today = await fetch_all(
                "SELECT w.id, w.organization_id, w.name, w.description, w.type "
                "FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id "
                "WHERE wm.user_id = :u ORDER BY w.created_at ASC",
                {"u": user_id},
            )
            items = await db_manager.fetch_user_workspace_items(user_id=str(user_id))
            # Today's order leaves ties of `created_at` open (one transaction can create
            # several workspaces): same items, in `created_at` order.
            assert sorted(
                (i.id, i.organization_id, i.name, i.description, i.type) for i in items
            ) == sorted(
                (r["id"], r["organization_id"], r["name"], r["description"], r["type"])
                for r in today
            )
            assert [i.created_at for i in items] == sorted(i.created_at for i in items)
    finally:
        await delete_seeded_organization(seeded)


async def test_org_details_of_an_organization_without_workspaces():
    seeded = await _seed_organization_without_workspaces(
        members={"owner": "owner", "m": "viewer"}
    )
    try:
        organization = await db_manager.get_organization(str(seeded.organization_id))
        details = await db_manager.get_org_details(organization)
        assert details["workspaces"] == [str(seeded.organization_id)]
        default = details["default_workspace"]
        assert default["id"] == str(seeded.organization_id)
        assert default["name"] == organization.name
        assert default["organization"] == str(seeded.organization_id)
        assert default["created_at"] == str(organization.created_at)
        assert default["updated_at"] == str(organization.updated_at)
        members = {m["user"]["id"] for m in default["members"]}
        assert members == {str(u) for u in seeded.user_ids.values()}
    finally:
        await delete_seeded_organization(seeded)


async def test_oldest_organization_of_a_user():
    seeded = await seed_organization(members={"owner": "owner"})
    try:
        assert await db_manager.fetch_oldest_organization_id(
            user_id=str(seeded.owner_id)
        ) == str(seeded.organization_id)
        assert (
            await db_manager.fetch_oldest_organization_id(user_id=str(uuid4())) is None
        )
    finally:
        await delete_seeded_organization(seeded)


# --- deletes (the cascade is gone) ------------------------------------------- #


async def _project_exists(project_id: UUID) -> bool:
    return bool(
        await fetch_all("SELECT 1 FROM projects WHERE id = :p", {"p": project_id})
    )


async def test_admin_delete_workspace_deletes_its_projects():
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    try:
        await db_manager.admin_delete_workspace(seeded.workspace_ids[1])
        assert not await _project_exists(seeded.project_ids[1])
        assert await _project_exists(seeded.project_ids[0])
    finally:
        await delete_seeded_organization(seeded)


async def test_admin_delete_accounts_batch_deletes_projects_of_deleted_workspaces():
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    try:
        await db_manager.admin_delete_accounts_batch(
            org_ids=[],
            workspace_ids=[seeded.workspace_ids[1]],
            project_ids=[],
            user_ids=[],
        )
        assert not await _project_exists(seeded.project_ids[1])
        assert await _project_exists(seeded.project_ids[0])
    finally:
        await delete_seeded_organization(seeded)


async def test_delete_organization_deletes_cross_organization_projects_of_its_workspaces():
    cross = await _seed_cross_organization_project()
    try:
        await db_manager.delete_organization(str(cross.extra_organization_ids[0]))
        assert not await _project_exists(cross.project_ids[0])
    finally:
        await delete_seeded_organization(cross)


async def test_admin_delete_organization_deletes_cross_organization_projects_of_its_workspaces():
    cross = await _seed_cross_organization_project()
    try:
        await db_manager.admin_delete_organization(cross.extra_organization_ids[0])
        assert not await _project_exists(cross.project_ids[0])
    finally:
        await delete_seeded_organization(cross)


async def test_admin_delete_accounts_batch_deletes_cross_organization_projects():
    cross = await _seed_cross_organization_project()
    try:
        await db_manager.admin_delete_accounts_batch(
            org_ids=[cross.extra_organization_ids[0]],
            workspace_ids=[],
            project_ids=[],
            user_ids=[],
        )
        assert not await _project_exists(cross.project_ids[0])
    finally:
        await delete_seeded_organization(cross)


async def test_admin_delete_user_with_cascade_deletes_cross_organization_projects():
    cross = await _seed_cross_organization_project()
    other_owner = cross.extra_user_ids[0]
    try:
        await db_manager.admin_delete_user_with_cascade(other_owner)
        assert not await _project_exists(cross.project_ids[0])
    finally:
        cross.extra_user_ids = []
        await delete_seeded_organization(cross)


async def test_scope_snapshot_covers_projects_of_deleted_workspaces():
    cross = await _seed_cross_organization_project()
    try:
        key_id = uuid4()
        await execute(
            "INSERT INTO api_keys (id, prefix, hashed_key, created_by_id, project_id, "
            "rate_limit, hidden, created_at, updated_at) VALUES (:id, :prefix, :h, :u, :p, "
            "0, false, now(), now())",
            {
                "id": key_id,
                "prefix": uuid4().hex[:8],
                "h": uuid4().hex,
                "u": cross.user_ids["m"],
                "p": cross.project_ids[0],
            },
        )
        other = cross.extra_organization_ids[0]
        own_projects = {
            row["id"]
            for row in await fetch_all(
                "SELECT id FROM projects WHERE organization_id = :o", {"o": other}
            )
        }
        snapshot = await PrincipalsDAO(
            engine=get_transactions_engine()
        ).list_scope_principals(organization_ids=[other])
        assert set(snapshot.project_ids) == own_projects | {cross.project_ids[0]}
        assert set(snapshot.api_key_ids) == {key_id}
        assert snapshot.binding_ids == []
    finally:
        await delete_seeded_organization(cross)


# --- whole-request counts (Task B4) ------------------------------------------ #
#
# One `verify_bearer_token` call with a fake SuperTokens session and the real readers,
# resolver, caching and Redis (a throwaway Redis: REDIS_URI_VOLATILE); skipped when Redis
# is unreachable. Before = today's statements per branch (Task B3 table): project+workspace
# 3 cold / 2 partly warm, workspace only 3 / 3, no parameters 3 / 3, warm 0 everywhere.

from types import SimpleNamespace as _NS  # noqa: E402

from starlette.requests import Request as _Request  # noqa: E402

import oss.src.core.memberships.service as _memberships_module  # noqa: E402
from oss.src.core.memberships.dtos import MembershipPolicy as _Policy  # noqa: E402
from oss.src.core.memberships.service import MembershipsService as _Service  # noqa: E402
from oss.src.middlewares import auth as _auth  # noqa: E402
from oss.src.utils import caching as _caching  # noqa: E402
from oss.tests.pytest.utils.redis_calls import count_redis_calls  # noqa: E402

_BEFORE_SQL = {
    "project+workspace": {"cold": 3, "partly_warm": 2},
    "project+organization": {"cold": 3, "partly_warm": 2},  # today: refused after 2-3
    "workspace": {"cold": 3, "partly_warm": 3},
    "none": {"cold": 3, "partly_warm": 3},
}

POLICIES = [_Policy.ORGANIZATION_WIDE, _Policy.PROJECT_ROWS]


async def _redis_reachable() -> bool:
    # The cache client binds to the event loop it was created in; each test has its own.
    _caching.get_cache_engine()._r = None
    try:
        await _caching.get_cache_engine()._client().ping()
        return True
    except Exception:  # pylint: disable=broad-exception-caught
        return False


def _bearer_request() -> _Request:
    return _Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/projects/",
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )


@pytest.fixture
async def bearer_world(monkeypatch, request):
    if not await _redis_reachable():
        pytest.skip(
            "Redis is unreachable (set REDIS_URI_VOLATILE to a throwaway Redis)"
        )
    policy = request.param
    # No random early "leak" on a cache miss: every miss takes the same Redis path, so
    # the Redis counts below are exact.
    monkeypatch.setattr(_caching, "random", lambda: 0.99)
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    user = seeded.user_ids["m"]
    service = _Service(memberships_dao=_dao(), policy=policy)
    monkeypatch.setattr(_memberships_module, "_memberships_service", service)

    email = (await fetch_all("SELECT email FROM users WHERE id = :u", {"u": user}))[0][
        "email"
    ]

    async def _session(request):
        return _NS(get_user_id=lambda: f"st-{user.hex}")

    async def _supertokens_user(*, user_id):
        return _NS(emails=[email])

    monkeypatch.setattr(_auth, "get_session", _session)
    monkeypatch.setattr(_auth, "get_supertokens_user_by_id", _supertokens_user)
    yield seeded, user
    await _flush(user, ("*",))
    await delete_seeded_organization(seeded)


async def _flush(user, namespaces):
    client = _caching.get_cache_engine()._client()
    for namespace in namespaces:
        async for name in client.scan_iter(
            match=f"cache:p:*:u:{str(user)[-12:]}:{namespace}:*"
        ):
            await client.delete(name)


async def _flush_organization_names(project_ids):
    # Only this test's projects: tests in other workers share the Redis.
    client = _caching.get_cache_engine()._client()
    for project_id in project_ids:
        async for name in client.scan_iter(
            match=f"cache:p:{str(project_id)[-12:]}:*get_organization_name*"
        ):
            await client.delete(name)


async def _measure(user, *, project_id=None, workspace_id=None, project_ids=()):
    out = {}
    for state, namespaces in (
        ("fully_cold", ("*",)),
        ("cold", ("verify_bearer_token", "resolve_membership")),
        ("partly_warm", ("verify_bearer_token",)),
        ("warm", ()),
    ):
        # prime: the organization name and the resolver entry exist after this
        await _auth.verify_bearer_token(
            request=_bearer_request(),
            bearer_token="t",
            query_project_id=str(project_id) if project_id else None,
            query_workspace_id=str(workspace_id) if workspace_id else None,
        )
        await _flush(user, namespaces)
        if state == "fully_cold":
            await _flush_organization_names(project_ids)
        with (
            count_statements(get_transactions_engine()) as sql,
            count_redis_calls() as redis,
        ):
            await _auth.verify_bearer_token(
                request=_bearer_request(),
                bearer_token="t",
                query_project_id=str(project_id) if project_id else None,
                query_workspace_id=str(workspace_id) if workspace_id else None,
            )
        out[state] = {
            "sql": len(sql),
            "redis": [call.command for call in redis],
            "redis_keys": [call.key for call in redis],
        }
    return out


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_bearer_project_and_organization_id_counts(bearer_world):
    seeded, user = bearer_world
    project_id = seeded.project_ids[0]
    for name, workspace_id in (
        ("project+workspace", seeded.workspace_ids[0]),
        ("project+organization", seeded.organization_id),
    ):
        counts = await _measure(user, project_id=project_id, workspace_id=workspace_id)
        assert counts["cold"]["sql"] == 2, (name, counts)
        assert counts["partly_warm"]["sql"] == 1, (name, counts)
        assert counts["warm"]["sql"] == 0, (name, counts)
        assert counts["cold"]["sql"] <= _BEFORE_SQL[name]["cold"]
        assert counts["partly_warm"]["sql"] <= _BEFORE_SQL[name]["partly_warm"]


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_bearer_workspace_only_counts(bearer_world):
    seeded, user = bearer_world
    for workspace_id in (seeded.workspace_ids[0], seeded.organization_id):
        counts = await _measure(user, workspace_id=workspace_id)
        assert counts["cold"]["sql"] == 2, counts
        assert counts["partly_warm"]["sql"] == 2, counts
        assert counts["warm"]["sql"] == 0, counts
        # no resolve_membership key is read or written on this branch
        for state in counts.values():
            assert not [k for k in state["redis_keys"] if "resolve_membership" in k]


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_bearer_without_parameters_counts(bearer_world):
    seeded, user = bearer_world
    counts = await _measure(user)
    # the selection plus the resolver read (every selection is checked), today's 3
    assert counts["cold"]["sql"] == 3, counts
    assert counts["warm"]["sql"] == 0, counts
    assert counts["cold"]["sql"] <= _BEFORE_SQL["none"]["cold"]


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_bearer_without_workspace_rows_fallback_counts(bearer_world):
    seeded, user = bearer_world
    await execute("DELETE FROM workspace_members WHERE user_id = :u", {"u": user})
    counts = await _measure(user)
    assert counts["cold"]["sql"] == 4, counts  # this request is a 401 today
    assert counts["warm"]["sql"] == 0, counts


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_bearer_warm_requests_send_the_same_redis_commands(bearer_world):
    seeded, user = bearer_world
    warm = [
        (await _measure(user, project_id=seeded.project_ids[0]))["warm"]["redis"],
        (
            await _measure(
                user,
                project_id=seeded.project_ids[0],
                workspace_id=seeded.workspace_ids[0],
            )
        )["warm"]["redis"],
        (await _measure(user, workspace_id=seeded.workspace_ids[0]))["warm"]["redis"],
        (await _measure(user))["warm"]["redis"],
    ]
    assert all(w == warm[0] for w in warm), warm


async def test_project_list_stays_one_statement_with_a_project_without_workspace():
    seeded = await _seed_organization_without_workspaces()
    try:
        await _add_project(
            organization_id=seeded.organization_id, workspace_id=None, is_default=False
        )
        engine = get_transactions_engine()
        with count_statements(engine) as statements:
            rows = await _dao().list_membership_rows(user_id=seeded.owner_id)
        assert len(statements) == 1
        assert (
            len(
                [r for r in rows if r.summary.organization_id == seeded.organization_id]
            )
            == 2
        )
    finally:
        await delete_seeded_organization(seeded)


# The whole Bearer request after step 1, per state: (SQL statements, Redis commands).
# Fully cold also misses the SuperTokens-user and organization-name entries. Today's SQL
# for the same requests (plan Task B3 table, fully cold adds the same 2 statements on both
# sides): project+workspace 5 / 3 / 2, workspace only 5 / 3 / 3, no parameters 5 / 3 / 3.
_AFTER = {
    "project+workspace": {
        "fully_cold": (4, 16),
        "cold": (2, 10),
        "partly_warm": (1, 7),
        "warm": (0, 2),
    },
    "project": {
        "fully_cold": (4, 16),
        "cold": (2, 10),
        "partly_warm": (1, 7),
        "warm": (0, 2),
    },
    "workspace": {
        "fully_cold": (4, 12),
        "cold": (2, 6),
        "partly_warm": (2, 6),
        "warm": (0, 2),
    },
    "none": {
        "fully_cold": (5, 12),
        "cold": (3, 6),
        "partly_warm": (3, 6),
        "warm": (0, 2),
    },
}
_TODAY_SQL = {
    "project+workspace": {"fully_cold": 5, "cold": 3, "partly_warm": 2, "warm": 0},
    "project": {"fully_cold": 4, "cold": 2, "partly_warm": 1, "warm": 0},
    "workspace": {"fully_cold": 5, "cold": 3, "partly_warm": 3, "warm": 0},
    "none": {"fully_cold": 5, "cold": 3, "partly_warm": 3, "warm": 0},
}


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_bearer_counts_per_branch_and_state(bearer_world):
    seeded, user = bearer_world
    ids = seeded.project_ids
    measured = {
        "project+workspace": await _measure(
            user,
            project_id=seeded.project_ids[0],
            workspace_id=seeded.workspace_ids[0],
            project_ids=ids,
        ),
        "project": await _measure(
            user, project_id=seeded.project_ids[0], project_ids=ids
        ),
        "workspace": await _measure(
            user, workspace_id=seeded.workspace_ids[0], project_ids=ids
        ),
        "none": await _measure(user, project_ids=ids),
    }
    for branch, states in measured.items():
        for state, value in states.items():
            sql, redis = _AFTER[branch][state]
            assert value["sql"] == sql, (branch, state, value)
            assert value["sql"] <= _TODAY_SQL[branch][state], (branch, state)
            # The cache keys and calls of every branch are today's (the workspace-only
            # key gains a version field only), so today's Redis count is this one.
            assert len(value["redis"]) == redis, (branch, state, value)
            if branch in ("workspace", "none"):
                assert not [k for k in value["redis_keys"] if "resolve_membership" in k]
    # warm: one Redis GET for the SuperTokens user and one for the Bearer state, everywhere
    assert {tuple(states["warm"]["redis"]) for states in measured.values()} == {
        ("GET", "GET")
    }


_APIKEY_COLD_REDIS = 4  # GET miss, lock SET, state SET, lock DEL (as today)


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_apikey_counts_are_unchanged(bearer_world):
    from oss.src.services import api_key_service

    seeded, user = bearer_world
    raw_key = await api_key_service.create_api_key(
        user_id=str(user), project_id=str(seeded.project_ids[0])
    )
    client = _caching.get_cache_engine()._client()

    async def _call():
        request = _bearer_request()
        await _auth.verify_apikey_token(request=request, apikey_token=raw_key)
        return request.state

    await _call()
    counts = {}
    for state in ("cold", "warm"):
        if state == "cold":
            async for name in client.scan_iter(
                match=f"cache:p:*:verify_apikey_token:*{raw_key}*"
            ):
                await client.delete(name)
        with (
            count_statements(get_transactions_engine()) as sql,
            count_redis_calls() as redis,
        ):
            request_state = await _call()
        counts[state] = (len(sql), len(redis))
    # Today: the key read (with its creator) and the project read, no extra statement for
    # the legacy workspace id; warm: one Redis GET.
    assert counts["cold"][0] == 2, counts
    assert counts["cold"][1] == _APIKEY_COLD_REDIS, counts
    assert counts["warm"] == (0, 1), counts
    # Step 2: the organization id where the workspace id was.
    assert request_state.workspace_id == str(seeded.organization_id)


async def test_delete_paths_keep_their_statement_counts():
    engine = get_transactions_engine()
    seeded = await seed_organization(members={"m": "editor"}, workspaces=3)
    cross = await _seed_cross_organization_project()
    try:
        with count_statements(engine) as statements:
            await db_manager.admin_delete_workspace(seeded.workspace_ids[2])
        assert len(statements) == 1, statements
        with count_statements(engine) as statements:
            await db_manager.admin_delete_accounts_batch(
                org_ids=[],
                workspace_ids=[seeded.workspace_ids[1]],
                project_ids=[],
                user_ids=[],
            )
        assert len(statements) == 1, statements  # every statement, not only deletes
        assert not await _project_exists(seeded.project_ids[1])
        with count_statements(engine) as statements:
            await db_manager.admin_delete_organization(cross.extra_organization_ids[0])
        assert len(statements) == 1, statements
        assert not await _project_exists(cross.project_ids[0])
        with count_statements(engine) as statements:
            await db_manager.delete_organization(str(seeded.organization_id))
        assert len(statements) == 2, statements  # the read, then one delete
        assert not await _project_exists(seeded.project_ids[0])
    finally:
        await delete_seeded_organization(seeded)
        await delete_seeded_organization(cross)


async def test_batch_organization_delete_takes_own_and_foreign_projects_in_one_statement():
    engine = get_transactions_engine()
    cross = await _seed_cross_organization_project()
    other = cross.extra_organization_ids[0]
    own = [
        row["id"]
        for row in await fetch_all(
            "SELECT id FROM projects WHERE organization_id = :o", {"o": other}
        )
    ]
    try:
        assert own
        with count_statements(engine) as statements:
            await db_manager.admin_delete_accounts_batch(
                org_ids=[other], workspace_ids=[], project_ids=[], user_ids=[]
            )
        assert len(statements) == 1, statements
        assert not await _project_exists(
            cross.project_ids[0]
        )  # foreign, in its workspace
        for project_id in own:
            assert not await _project_exists(project_id)  # its own, by the cascade
    finally:
        await delete_seeded_organization(cross)


async def test_legacy_workspace_with_a_null_name_keeps_an_empty_name():
    seeded = await seed_organization(members={"m": "editor"})
    try:
        await execute(
            "UPDATE workspaces SET name = NULL WHERE id = :w",
            {"w": seeded.workspace_ids[0]},
        )
        row = await _dao().fetch_membership_row(
            user_id=seeded.user_ids["m"], project_id=seeded.project_ids[0]
        )
        assert row.summary.workspace_id == seeded.workspace_ids[0]
        assert row.summary.workspace_name == ""
    finally:
        await delete_seeded_organization(seeded)


async def test_org_details_of_an_organization_without_workspaces_or_projects():
    seeded = await _seed_organization_without_workspaces()
    try:
        await execute(
            "DELETE FROM projects WHERE organization_id = :o",
            {"o": seeded.organization_id},
        )
        engine = get_transactions_engine()
        for demo in (False, True):
            await execute(
                "UPDATE organizations SET flags = CAST(:f AS jsonb) WHERE id = :o",
                {
                    "f": '{"is_demo": %s}' % ("true" if demo else "false"),
                    "o": seeded.organization_id,
                },
            )
            organization = await db_manager.get_organization(
                str(seeded.organization_id)
            )
            with count_statements(engine) as statements:
                details = await db_manager.get_org_details(organization)
            assert details["default_workspace"] is None, demo
            assert details["workspaces"] == [], demo
            # Today: two default-workspace reads and the workspace list read. Now the
            # project read takes the place of the workspace list read.
            assert len(statements) == 3, (demo, statements)
    finally:
        await delete_seeded_organization(seeded)


async def test_org_details_of_a_legacy_organization_keep_their_statement_count():
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    try:
        organization = await db_manager.get_organization(str(seeded.organization_id))
        engine = get_transactions_engine()
        with count_statements(engine) as statements:
            details = await db_manager.get_org_details(organization)
        assert details["default_workspace"]["id"] == str(seeded.workspace_ids[0])
        assert sorted(details["workspaces"]) == sorted(
            str(w) for w in seeded.workspace_ids
        )
        # default workspace read, project read, members, invitations, workspace list
        assert len(statements) == 5, statements
    finally:
        await delete_seeded_organization(seeded)
