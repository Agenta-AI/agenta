"""One default project per organization, against a migrated Postgres.

Every reader picks the organization's default project by one rule (`is_default` first,
then `created_at, id`), every default writer takes the organization lock, and the write
paths that once wrote workspace rows (signup, membership writes, the admin graph) work on
an organization-only schema. Also the organization details, the project list, the admin
notice, the admin workspace aliases and the session link.
"""

import asyncio
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    SeededOrganization,
    delete_seeded_organization,
    execute,
    fetch_all,
    seed_organization,
)


pytestmark = pytest.mark.integration


def _dao() -> MembershipsDAO:
    return MembershipsDAO(engine=get_transactions_engine())


# --- shapes ------------------------------------------------------------------ #


async def _multi_default_organization() -> SeededOrganization:
    """Three projects, each a default (data written before the one-default rule)."""

    seeded = await seed_organization(members={"m": "editor"}, projects=3)
    await execute(
        "UPDATE projects SET is_default = true WHERE organization_id = :o",
        {"o": seeded.organization_id},
    )
    return seeded


async def _one_default_organization() -> SeededOrganization:
    """Three projects; the default is project 1, so it is not the oldest."""

    seeded = await seed_organization(members={"m": "editor"}, projects=3)
    await execute(
        "UPDATE projects SET is_default = (id = :d) WHERE organization_id = :o",
        {"d": seeded.project_ids[1], "o": seeded.organization_id},
    )
    return seeded


async def _no_default_organization() -> SeededOrganization:
    seeded = await seed_organization(members={"m": "editor"}, projects=2)
    await execute(
        "UPDATE projects SET is_default = false WHERE organization_id = :o",
        {"o": seeded.organization_id},
    )
    return seeded


async def _add_project(*, organization_id, is_default) -> UUID:
    project_id = uuid4()
    await execute(
        "INSERT INTO projects (id, project_name, is_default, organization_id, "
        "created_at, updated_at) VALUES (:id, 'extra', :d, :o, clock_timestamp(), "
        "clock_timestamp())",
        {"id": project_id, "d": is_default, "o": organization_id},
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


import oss.src.core.access.permissions.service as permissions_service  # noqa: E402
import oss.src.services.db_manager as db_manager  # noqa: E402
from oss.src.core.access.dtos import RequestCredentialKind  # noqa: E402
from oss.src.core.access.permissions.types import Permission  # noqa: E402
from oss.tests.pytest.utils.statements import count_statements  # noqa: E402


async def _readers(ref) -> tuple:
    """(member-route project, Bearer default project) for an id; an id that is not an
    organization id names nothing, (None, None)."""

    try:
        by_workspace = (await db_manager.get_project_by_workspace(str(ref))).id
    except db_manager.NoResultFound:
        by_workspace = None
    default = await db_manager.fetch_default_project(organization_id=str(ref))
    return by_workspace, default.project_id if default else None


async def _oldest(sql_where: str, params: dict):
    rows = await fetch_all(
        f"SELECT id FROM projects WHERE {sql_where} "
        "ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1",
        params,
    )
    return rows[0]["id"] if rows else None


async def test_default_helpers_agree_for_every_seed_scope():
    # Every organization id of the seed (when the database holds one; not of other tests)
    # that has a default project, plus this test's own organization with several
    # defaults (before any consolidation).
    own = await _multi_default_organization()
    try:
        # (Organizations older than an hour: tests running in parallel create and delete
        # their own.)
        seed = (
            "(o.id = CAST(:own AS uuid) OR (o.name NOT LIKE 'membership-seed-%' AND "
            "o.created_at < now() - interval '1 hour')) AND EXISTS (SELECT 1 FROM "
            "projects p WHERE p.organization_id = o.id AND p.is_default IS TRUE)"
        )
        refs = await fetch_all(
            f"SELECT o.id AS ref FROM organizations o WHERE {seed}",
            {"own": own.organization_id},
        )
        assert len(refs) >= 1
        for row in refs:
            by_workspace, default = await _readers(row["ref"])
            assert by_workspace == default, row["ref"]
    finally:
        await delete_seeded_organization(own)


async def test_member_routes_and_bearer_pick_the_same_project():
    seeded = await _one_default_organization()
    try:
        assert await _readers(seeded.organization_id) == (seeded.project_ids[1],) * 2
        assert await _readers(uuid4()) == (None, None)
    finally:
        await delete_seeded_organization(seeded)


async def test_fallback_project_takes_the_default_then_the_oldest():
    # The organization has one default (project 1). A user who may open only projects
    # 0 and 2 lands on the oldest of them; with project 1, on the default.
    seeded = await _one_default_organization()
    try:
        # Seeded projects can share a timestamp: make project 0 the oldest.
        await execute(
            "UPDATE projects SET created_at = created_at - interval '1 day' "
            "WHERE id = :p",
            {"p": seeded.project_ids[0]},
        )
        candidates = [seeded.project_ids[2], seeded.project_ids[0]]
        assert (
            await db_manager.pick_fallback_project(project_ids=candidates)
            == seeded.project_ids[0]
        )
        assert (
            await db_manager.pick_fallback_project(
                project_ids=[*candidates, seeded.project_ids[1]]
            )
            == seeded.project_ids[1]
        )
        assert await db_manager.pick_fallback_project(project_ids=[]) is None
    finally:
        await delete_seeded_organization(seeded)


async def test_readers_pick_the_oldest_default_when_two_remain():
    seeded = await _one_default_organization()
    try:
        # A second default (data written before the one-default rule): the readers agree
        # on the oldest default.
        await execute(
            "UPDATE projects SET is_default = true WHERE id = :p",
            {"p": seeded.project_ids[2]},
        )
        oldest = await _oldest(
            "organization_id = :o AND is_default IS TRUE",
            {"o": seeded.organization_id},
        )
        assert await _readers(seeded.organization_id) == (oldest, oldest)
    finally:
        await delete_seeded_organization(seeded)


async def test_get_project_by_workspace_falls_back_without_a_default():
    seeded = await _no_default_organization()
    try:
        project = await db_manager.get_project_by_workspace(str(seeded.organization_id))
        # No default: the oldest project of the organization.
        assert project.id == await _oldest(
            "organization_id = :o", {"o": seeded.organization_id}
        )
        assert (
            await db_manager.fetch_default_project(
                organization_id=str(seeded.organization_id)
            )
            is None
        )
    finally:
        await delete_seeded_organization(seeded)


async def test_default_lookups_are_one_statement():
    seeded = await _one_default_organization()
    try:
        engine = get_transactions_engine()
        with count_statements(engine) as fetched:
            await db_manager.fetch_default_project(
                organization_id=str(seeded.organization_id)
            )
        with count_statements(engine) as found:
            await db_manager.get_project_by_workspace(str(seeded.organization_id))
        assert len(fetched) == 1
        assert len(found) == 1
        # An unknown id: one statement, no answer.
        with count_statements(engine) as fetched:
            await db_manager.fetch_default_project(organization_id=str(uuid4()))
        assert len(fetched) == 1
    finally:
        await delete_seeded_organization(seeded)


# --- check_organization_write follows the organization default ------------------- #


class _KeyAccess:
    def __init__(self, project_id):
        self.credential_kind = RequestCredentialKind.API_KEY
        self.project_id = project_id


async def _organization_write(monkeypatch, organization_id, key_project_id) -> bool:
    checked = []

    async def check_action_access(*, user_uid, project_id, permission):
        checked.append(project_id)
        return str(project_id) == str(key_project_id)

    monkeypatch.setattr(
        permissions_service, "get_request_access", lambda: _KeyAccess(key_project_id)
    )
    monkeypatch.setattr(permissions_service, "check_action_access", check_action_access)
    allowed = await permissions_service.check_organization_write(
        user_uid="u",
        organization_id=str(organization_id),
        permission=Permission.EDIT_WORKSPACE,
    )
    assert len(checked) == 1
    return allowed


async def test_check_organization_write_uses_the_organization_default(monkeypatch):
    # The default (project 1) is not the oldest project (project 0).
    seeded = await _one_default_organization()
    try:
        engine = get_transactions_engine()
        with count_statements(engine) as statements:
            kept = await _organization_write(
                monkeypatch, seeded.organization_id, seeded.project_ids[1]
            )
        assert kept is True
        assert len(statements) == 1
        assert (
            await _organization_write(
                monkeypatch, seeded.organization_id, seeded.project_ids[0]
            )
            is False
        )
    finally:
        await delete_seeded_organization(seeded)


async def test_kept_default_key_can_update_organization_settings(monkeypatch):
    seeded = await _one_default_organization()
    try:
        assert await _organization_write(
            monkeypatch, seeded.organization_id, seeded.project_ids[1]
        )
    finally:
        await delete_seeded_organization(seeded)


async def test_cleared_default_key_cannot_update_organization_settings(monkeypatch):
    seeded = await _one_default_organization()
    try:
        # A key of a project that is not the default.
        assert not await _organization_write(
            monkeypatch, seeded.organization_id, seeded.project_ids[0]
        )
    finally:
        await delete_seeded_organization(seeded)


def test_organization_write_callers_go_through_check_organization_write():
    # Organization settings, domains, SSO providers and billing all decide through
    # `check_organization_write`, so the two tests above cover them.
    from pathlib import Path

    api = Path(__file__).resolve().parents[5]
    callers = {
        "oss/src/routers/organization_router.py",
        "oss/src/routers/workspace_router.py",
        "ee/src/apis/fastapi/billing/router.py",
        "ee/src/apis/fastapi/organizations/router.py",
    }
    for relative in callers:
        path = api / relative
        if not path.exists():
            continue
        assert "check_organization_write" in path.read_text(), relative


# --- default writers serialize on the organization lock (S-30) ---------------- #

_LOCK_SQL = (
    "SELECT pg_advisory_xact_lock(hashtextextended('agenta:project_default:' "
    "|| CAST(:o AS text), 0))"
)


async def _hold_lock_and_promote(connection, organization_id, project_id):
    await connection.execute(text(_LOCK_SQL), {"o": str(organization_id)})
    await connection.execute(
        text(
            "UPDATE projects SET is_default = (id = :p) WHERE organization_id = :o "
            "AND (is_default IS TRUE OR id = :p)"
        ),
        {"o": organization_id, "p": project_id},
    )


def test_every_default_writer_uses_one_lock_key():
    assert "'agenta:project_default:'" in db_manager._PROJECT_DEFAULT_LOCK_SQL
    assert "'agenta:project_default:'" in db_manager._LOCK_PROJECT_ORGANIZATION_SQL
    from oss.src.dbs.postgres.memberships import dao as memberships_dao

    assert "'agenta:project_default:'" in memberships_dao._LOCK_WITH_PROJECT_DEFAULT_SQL


async def test_default_writers_serialize_on_the_organization_lock():
    seeded = await _one_default_organization()
    try:
        p_a, p_b = seeded.project_ids[1], seeded.project_ids[2]
        engine = get_transactions_engine()._engine
        async with engine.connect() as a:
            transaction = await a.begin()
            await _hold_lock_and_promote(a, seeded.organization_id, p_b)
            # B starts while pA is still the committed default.
            b = asyncio.create_task(db_manager.set_default_project(str(p_a)))
            assert await _blocked(b)
            await transaction.commit()
        promoted = await b
        assert promoted.id == p_a and promoted.is_default is True
        assert await _committed_defaults(seeded.organization_id) == [p_a]
    finally:
        await delete_seeded_organization(seeded)


async def test_create_and_admin_create_serialize_with_set_default():
    seeded = await _one_default_organization()
    try:
        engine = get_transactions_engine()._engine
        for writer in ("create", "admin"):
            async with engine.connect() as a:
                transaction = await a.begin()
                await _hold_lock_and_promote(
                    a, seeded.organization_id, seeded.project_ids[2]
                )
                if writer == "create":
                    task = asyncio.create_task(
                        _dao().create_project(
                            organization_id=seeded.organization_id,
                            name="made-default",
                            is_default=True,
                        )
                    )
                else:
                    task = asyncio.create_task(
                        db_manager.admin_create_project(
                            name="admin-default",
                            org_id=seeded.organization_id,
                            is_default=True,
                        )
                    )
                assert await _blocked(task)
                await transaction.commit()
            created = await task
            created_id = created.scope.project_id if writer == "create" else created.id
            assert await _committed_defaults(seeded.organization_id) == [created_id]
    finally:
        await delete_seeded_organization(seeded)


async def test_default_writer_statement_counts():
    seeded = await _one_default_organization()
    try:
        engine = get_transactions_engine()
        with count_statements(engine) as promoted:
            await db_manager.set_default_project(str(seeded.project_ids[2]))
        with count_statements(engine) as created:
            await _dao().create_project(
                organization_id=seeded.organization_id,
                name="c",
                is_default=True,
            )
        with count_statements(engine) as admin_created:
            await db_manager.admin_create_project(
                name="a", org_id=seeded.organization_id, is_default=False
            )
        assert len(promoted) == 2  # lock, then clear-and-set
        assert len(created) <= 5
        assert len(admin_created) == 2  # lock, insert
    finally:
        await delete_seeded_organization(seeded)


async def test_admin_routes_cannot_create_a_second_default():
    seeded = await _one_default_organization()
    try:
        first = await db_manager.admin_create_project(
            name="one", org_id=seeded.organization_id, is_default=True
        )
        second = await db_manager.admin_create_project(
            name="two", org_id=seeded.organization_id, is_default=True
        )
        assert await _committed_defaults(seeded.organization_id) == [second.id]
        assert first.id != second.id
    finally:
        await delete_seeded_organization(seeded)


# --- write paths on an organization-only schema --------------------------------- #

from oss.src.core.accounts.dtos import (  # noqa: E402
    AdminAccountsCreate,
    AdminOrganizationCreate,
    AdminOrganizationMembershipCreate,
    AdminProjectCreate,
    AdminSimpleAccountsWorkspacesCreate,
    AdminSimpleAccountsWorkspacesMembershipsCreate,
    AdminWorkspaceCreate,
    AdminWorkspaceMembershipCreate,
    EntityRef,
)
from oss.src.core.accounts.service import PlatformAdminAccountsService  # noqa: E402
from oss.tests.pytest.utils.membership_seed import create_user  # noqa: E402


async def _signup_organization():
    from oss.src.services import commoners

    user_id = await create_user(label="signup")
    user = await db_manager.get_user_with_id(user_id=str(user_id))
    organization = await commoners.create_organization(user=user, name="signup-org")
    seeded = SeededOrganization(
        organization_id=organization.id,
        owner_id=user_id,
        project_ids=[],
        user_ids={"owner": user_id},
    )
    return seeded


async def test_write_paths_need_no_workspace_storage():
    """Signup, project creation, membership writes, the ownership transfer, the default
    writers and the admin graph (with its workspace entries) all run on a schema
    without workspace tables."""

    legacy = await seed_organization(members={"m": "editor"}, projects=2)
    joiner = await create_user(label="joiner")
    legacy.extra_user_ids.append(joiner)
    admin = PlatformAdminAccountsService()
    created = []
    try:
        signup = await _signup_organization()
        created.append(signup)
        dao = _dao()
        await dao.create_project(
            organization_id=legacy.organization_id, name="a", is_default=True
        )
        await dao.create_project(
            organization_id=legacy.organization_id, name="b", is_default=False
        )
        await dao.set_member_role(
            organization_id=legacy.organization_id,
            user_id=legacy.user_ids["m"],
            role="viewer",
            must_exist=True,
        )
        await dao.set_member_role(
            organization_id=legacy.organization_id,
            user_id=joiner,
            role="editor",
            join_all_projects=True,
        )
        await dao.set_member_role(
            organization_id=legacy.organization_id,
            user_id=joiner,
            role="admin",
            join_project_ids=[legacy.project_ids[1]],
        )
        await dao.set_member_role(
            organization_id=legacy.organization_id,
            user_id=joiner,
            role="viewer",
            join_all_projects=True,
            must_be_absent=True,
        )
        await dao.transfer_ownership(
            organization_id=legacy.organization_id,
            new_owner_id=legacy.user_ids["m"],
            current_owner_id=legacy.owner_id,
        )
        await db_manager.set_default_project(str(legacy.project_ids[1]))
        await db_manager.admin_create_project(
            name="admin", org_id=legacy.organization_id, is_default=False
        )
        await admin.create_workspace(
            dto=AdminSimpleAccountsWorkspacesCreate(
                workspace=AdminWorkspaceCreate(
                    name="w",
                    organization_ref=EntityRef(id=str(legacy.organization_id)),
                )
            )
        )
        await admin.create_workspace_membership(
            dto=AdminSimpleAccountsWorkspacesMembershipsCreate(
                membership=AdminWorkspaceMembershipCreate(
                    workspace_ref=EntityRef(id=str(legacy.organization_id)),
                    user_ref=EntityRef(id=str(joiner)),
                    role="editor",
                )
            )
        )
        graph = await admin.create_accounts(
            dto=AdminAccountsCreate(
                organizations={
                    "org": AdminOrganizationCreate(
                        name="graph-org", owner_user_ref=EntityRef(id=str(joiner))
                    )
                },
                workspaces={
                    "wrk": AdminWorkspaceCreate(
                        name="graph-ws", organization_ref=EntityRef(ref="org")
                    )
                },
                projects={
                    "prj": AdminProjectCreate(
                        name="graph-prj",
                        organization_ref=EntityRef(ref="org"),
                        workspace_ref=EntityRef(ref="wrk"),
                        is_default=True,
                    )
                },
                organization_memberships={
                    "om": AdminOrganizationMembershipCreate(
                        organization_ref=EntityRef(ref="org"),
                        user_ref=EntityRef(id=str(joiner)),
                        role="owner",
                    )
                },
                workspace_memberships={
                    "wm": AdminWorkspaceMembershipCreate(
                        workspace_ref=EntityRef(ref="wrk"),
                        user_ref=EntityRef(id=str(joiner)),
                        role="owner",
                    )
                },
            )
        )
        graph_org = UUID(graph.accounts[0].organizations["org"].id)
        created.append(
            SeededOrganization(
                organization_id=graph_org,
                owner_id=joiner,
                project_ids=[],
                user_ids={},
            )
        )
        projects = await fetch_all(
            "SELECT is_default FROM projects WHERE organization_id = :o",
            {"o": graph_org},
        )
        assert [p["is_default"] for p in projects] == [True]
    finally:
        for seeded in created:
            await delete_seeded_organization(seeded)
        await delete_seeded_organization(legacy)


async def test_signup_creates_one_default_project():
    seeded = await _signup_organization()
    try:
        projects = await fetch_all(
            "SELECT is_default FROM projects WHERE organization_id = :o",
            {"o": seeded.organization_id},
        )
        assert [p["is_default"] for p in projects] == [True]
    finally:
        await delete_seeded_organization(seeded)


async def test_create_project_defaults_are_organization_wide():
    seeded = await _multi_default_organization()
    try:
        created = await _dao().create_project(
            organization_id=seeded.organization_id, name="new", is_default=True
        )
        assert await _committed_defaults(seeded.organization_id) == [
            created.scope.project_id
        ]
        assert created.scope.workspace_id == seeded.organization_id
        other = await _dao().create_project(
            organization_id=seeded.organization_id, name="other", is_default=False
        )
        assert other.scope.is_default is False
    finally:
        await delete_seeded_organization(seeded)


async def test_create_project_is_the_default_of_an_organization_without_one():
    seeded = await _no_default_organization()
    try:
        created = await _dao().create_project(
            organization_id=seeded.organization_id, name="new", is_default=False
        )
        assert created.scope.is_default is True
    finally:
        await delete_seeded_organization(seeded)


async def test_admin_graph_answers_the_organization_for_workspaces():
    legacy = await seed_organization(members={"owner": "owner"})
    try:
        response = await PlatformAdminAccountsService().create_workspace(
            dto=AdminSimpleAccountsWorkspacesCreate(
                workspace=AdminWorkspaceCreate(
                    name="w",
                    organization_ref=EntityRef(id=str(legacy.organization_id)),
                )
            )
        )
        workspace = response.accounts[0].workspaces["wrk"]
        assert workspace.id == workspace.organization_id == str(legacy.organization_id)
        projects = await fetch_all(
            "SELECT id FROM projects WHERE organization_id = :o",
            {"o": legacy.organization_id},
        )
        assert [p["id"] for p in projects] == legacy.project_ids  # no project made
    finally:
        await delete_seeded_organization(legacy)


async def test_admin_graph_workspace_membership_answers_the_organization_membership():
    legacy = await seed_organization(members={"m": "editor"})
    outsider = await create_user(label="outsider")
    legacy.extra_user_ids.append(outsider)
    service = PlatformAdminAccountsService()
    try:
        row = (
            await fetch_all(
                "SELECT id FROM organization_members WHERE user_id = :u",
                {"u": legacy.user_ids["m"]},
            )
        )[0]
        from oss.src.core.accounts.errors import AdminWorkspaceNotFoundError

        # An id that is not an organization id is unknown.
        with pytest.raises(AdminWorkspaceNotFoundError):
            await service.create_workspace_membership(
                dto=AdminSimpleAccountsWorkspacesMembershipsCreate(
                    membership=AdminWorkspaceMembershipCreate(
                        workspace_ref=EntityRef(id=str(uuid4())),
                        user_ref=EntityRef(id=str(legacy.user_ids["m"])),
                        role="viewer",
                    )
                )
            )
        for ref in (legacy.organization_id,):
            response = await service.create_workspace_membership(
                dto=AdminSimpleAccountsWorkspacesMembershipsCreate(
                    membership=AdminWorkspaceMembershipCreate(
                        workspace_ref=EntityRef(id=str(ref)),
                        user_ref=EntityRef(id=str(legacy.user_ids["m"])),
                        role="viewer",
                    )
                )
            )
            membership = response.accounts[0].workspace_memberships["mem"]
            assert membership.id == str(row["id"])
            assert membership.workspace_id == str(legacy.organization_id)
            assert membership.role == "editor"  # the organization role; nothing written
        from oss.src.core.accounts.errors import AdminMembershipNotFoundError

        with pytest.raises(AdminMembershipNotFoundError):
            await service.create_workspace_membership(
                dto=AdminSimpleAccountsWorkspacesMembershipsCreate(
                    membership=AdminWorkspaceMembershipCreate(
                        workspace_ref=EntityRef(id=str(legacy.organization_id)),
                        user_ref=EntityRef(id=str(outsider)),
                        role="viewer",
                    )
                )
            )
    finally:
        await delete_seeded_organization(legacy)


async def test_write_statement_counts_drop():
    legacy = await seed_organization(members={"m": "editor"}, projects=2)
    joiner = await create_user(label="joiner")
    legacy.extra_user_ids.append(joiner)
    created = []
    engine = get_transactions_engine()
    try:
        with count_statements(engine) as signup:
            created.append(await _signup_organization())
        with count_statements(engine) as joined:
            await _dao().set_member_role(
                organization_id=legacy.organization_id,
                user_id=joiner,
                role="editor",
                join_all_projects=True,
            )
        with count_statements(engine) as transferred:
            await _dao().transfer_ownership(
                organization_id=legacy.organization_id,
                new_owner_id=legacy.user_ids["m"],
                current_owner_id=legacy.owner_id,
            )
        with count_statements(engine) as made:
            await _dao().create_project(
                organization_id=legacy.organization_id, name="c", is_default=False
            )

        # Step 1 sent, per path: set_member_role(join_all) 8 (lock, owner, row, upsert,
        # update projects, insert projects, update and insert workspace rows) -> 6;
        # create_project 6 (lock, resolve workspace, has-default, unset, insert, seed,
        # owner = 7 with make_default) -> 4.
        assert signup and transferred
        assert len(joined) == 6
        assert len(made) == 4
    finally:
        for seeded in created:
            await delete_seeded_organization(seeded)
        await delete_seeded_organization(legacy)


# --- responses per D6, links, the admin notice, admin aliases -------------------- #

from types import SimpleNamespace  # noqa: E402


async def _two_project_organization():
    """Two projects with different members: the default (project 0) has a and b, the
    other only a."""

    seeded = await seed_organization(members={"a": "editor", "b": "viewer"}, projects=2)
    await execute(
        "DELETE FROM project_members WHERE project_id = :p AND user_id = :u",
        {"p": seeded.project_ids[1], "u": seeded.user_ids["b"]},
    )
    return seeded


async def _null_default_organization():
    """A default project and a project whose default flag is NULL."""

    seeded = await seed_organization(members={"a": "editor"})
    null_default = await _add_project(
        organization_id=seeded.organization_id, is_default=None
    )
    await execute(
        "INSERT INTO project_members (id, user_id, project_id, role, created_at, "
        "updated_at) VALUES (gen_random_uuid(), :u, :p, 'viewer', now(), now())",
        {"u": seeded.owner_id, "p": null_default},
    )
    return seeded


async def test_org_details_list_the_members_of_the_organization_default():
    fixtures = [
        await _two_project_organization(),
        await _null_default_organization(),
        await _no_default_organization(),
    ]
    try:
        engine = get_transactions_engine()
        for seeded in fixtures:
            organization_id = str(seeded.organization_id)
            with count_statements(engine) as statements:
                project = await db_manager.fetch_org_details_project(organization_id)
            assert len(statements) == 1
            # The project the member routes use (the organization default, else its
            # oldest project).
            expected = await fetch_all(
                "SELECT id FROM projects WHERE organization_id = :o "
                "ORDER BY is_default IS TRUE DESC, created_at ASC NULLS LAST, id ASC "
                "LIMIT 1",
                {"o": seeded.organization_id},
            )
            assert project.id == expected[0]["id"], organization_id
            details = await db_manager.get_org_details(
                await db_manager.get_organization(organization_id)
            )
            listed = {m["user"]["id"] for m in details["default_workspace"]["members"]}
            members = {
                str(row["user_id"])
                for row in await fetch_all(
                    "SELECT user_id FROM project_members WHERE project_id = :p",
                    {"p": project.id},
                )
            }
            # No invitation is pending in these fixtures: exactly the project's members.
            assert members == listed, organization_id
    finally:
        for seeded in fixtures:
            await delete_seeded_organization(seeded)


async def test_org_details_answer_the_organization():
    seeded = await seed_organization(members={"m": "editor"}, projects=2)
    try:
        organization = await db_manager.get_organization(str(seeded.organization_id))
        engine = get_transactions_engine()
        with count_statements(engine) as statements:
            details = await db_manager.get_org_details(organization)
        workspace = details["default_workspace"]
        assert details["workspaces"] == [str(seeded.organization_id)]
        assert workspace["id"] == str(seeded.organization_id)
        assert workspace["name"] == organization.name
        assert workspace["type"] == "default"
        roles = {
            m["user"]["id"]: m["roles"][0]["role_name"] for m in workspace["members"]
        }
        assert roles == {
            str(seeded.owner_id): "owner",
            str(seeded.user_ids["m"]): "editor",
        }
        # Step 1: 5 statements for a legacy organization (workspace, workspace project,
        # members, invitations, workspace list); now: project, invitations, members.
        assert len(statements) == 3
        empty = await seed_organization(members={"owner": "owner"}, projects=0)
        try:
            details = await db_manager.get_org_details(
                await db_manager.get_organization(str(empty.organization_id))
            )
            # Design D6: the organization alias, with no members.
            assert details["default_workspace"]["id"] == str(empty.organization_id)
            assert details["default_workspace"]["members"] == []
            assert details["workspaces"] == [str(empty.organization_id)]
        finally:
            await delete_seeded_organization(empty)
    finally:
        await delete_seeded_organization(seeded)


async def test_org_details_list_an_invitation_of_another_project():
    # An invitation stored in another project of the organization is listed although
    # the details list the default project's members.
    seeded = await seed_organization(members={"m": "editor"}, projects=2)
    try:
        moved = await _add_project(
            organization_id=seeded.organization_id, is_default=False
        )
        email = f"pending-{uuid4().hex[:10]}@test.agenta.ai"
        for project_id, used in ((moved, False), (seeded.project_ids[1], True)):
            await execute(
                "INSERT INTO project_invitations (id, token, email, used, role, "
                "project_id, expiration_date, created_at) VALUES (gen_random_uuid(), "
                ":t, :e, :u, 'viewer', :p, now() + interval '1 day', now())",
                {"t": uuid4().hex, "e": email, "u": used, "p": project_id},
            )
        organization = await db_manager.get_organization(str(seeded.organization_id))
        details = await db_manager.get_org_details(organization)
        pending = [
            m["user"]
            for m in details["default_workspace"]["members"]
            if m["user"]["email"] == email
        ]
        assert [user["status"] for user in pending] == ["pending"]
    finally:
        await delete_seeded_organization(seeded)


async def test_project_list_answers_the_organization():
    seeded = await seed_organization(members={"m": "editor"}, projects=2)
    try:
        name = (
            await fetch_all(
                "SELECT name FROM organizations WHERE id = :o",
                {"o": seeded.organization_id},
            )
        )[0]["name"]
        engine = get_transactions_engine()
        with count_statements(engine) as statements:
            rows = await _dao().list_membership_rows(user_id=seeded.user_ids["m"])
        mine = [r for r in rows if r.summary.organization_id == seeded.organization_id]
        assert len(mine) == 2 and len(statements) == 1
        for row in mine:
            assert row.summary.workspace_id == seeded.organization_id
            assert row.summary.workspace_name == name
        row = await _dao().fetch_membership_row(
            user_id=seeded.user_ids["m"], project_id=seeded.project_ids[1]
        )
        assert row.summary.workspace_id == seeded.organization_id
        listed = await _dao().list_projects(organization_ids=[seeded.organization_id])
        assert {project.workspace_id for project in listed} == {seeded.organization_id}
    finally:
        await delete_seeded_organization(seeded)


class _Mailer:
    def __init__(self):
        self.sent = []

    async def send_email(self, **kwargs):
        self.sent.append(kwargs)
        return True


async def test_accept_sends_the_admin_notice_to_organization_admins(monkeypatch):
    from oss.src.services import organization_service

    seeded = await seed_organization(
        members={"a1": "admin", "a2": "admin", "e": "editor"}
    )
    newcomer = await create_user(label="newcomer")
    seeded.extra_user_ids.append(newcomer)
    mailer = _Mailer()
    monkeypatch.setattr(organization_service, "emailing", mailer)
    try:
        await execute(
            "INSERT INTO organization_members (id, user_id, organization_id, role, "
            "created_at, updated_at) VALUES (gen_random_uuid(), :u, :o, 'viewer', now(), "
            "now())",
            {"u": newcomer, "o": seeded.organization_id},
        )
        user = await db_manager.get_user_with_id(user_id=str(newcomer))
        engine = get_transactions_engine()
        with count_statements(engine) as statements:
            await organization_service.notify_org_admin_invitation(
                organization_id=seeded.organization_id,
                project_id=seeded.project_ids[0],
                user=user,
            )
        emails = {
            (await fetch_all("SELECT email FROM users WHERE id = :u", {"u": u}))[0][
                "email"
            ]
            for u in (seeded.owner_id, seeded.user_ids["a1"], seeded.user_ids["a2"])
        }
        assert {m["to_email"] for m in mailer.sent} == emails
        assert len(mailer.sent) == 3 and len(statements) == 1
        link = f"/w/{seeded.organization_id}/p/{seeded.project_ids[0]}/settings?tab=workspace"
        assert all(link in m["call_to_action"] for m in mailer.sent)
    finally:
        await delete_seeded_organization(seeded)


async def test_admin_delete_of_a_workspace_alias_deletes_nothing():
    from oss.src.core.accounts.dtos import (
        AdminAccountsDelete,
        AdminAccountsDeleteTarget,
    )
    from oss.src.core.accounts.errors import AdminWorkspaceIsOrganizationError

    seeded = await seed_organization(members={"m": "editor"})
    service = PlatformAdminAccountsService()
    try:
        with pytest.raises(AdminWorkspaceIsOrganizationError):
            await service.delete_workspace(workspace_id=str(seeded.organization_id))
        with pytest.raises(AdminWorkspaceIsOrganizationError):
            await service.delete_accounts(
                dto=AdminAccountsDelete(
                    target=AdminAccountsDeleteTarget(
                        workspace_ids=[str(seeded.organization_id)]
                    ),
                    dry_run=False,
                )
            )
        assert await fetch_all(
            "SELECT 1 FROM organizations WHERE id = :o", {"o": seeded.organization_id}
        )
        projects = await fetch_all(
            "SELECT id FROM projects WHERE organization_id = :o",
            {"o": seeded.organization_id},
        )
        assert [p["id"] for p in projects] == seeded.project_ids
    finally:
        await delete_seeded_organization(seeded)


async def test_admin_delete_of_a_membership_alias_removes_the_member(monkeypatch):
    from oss.src.core.accounts.errors import AdminOwnerProtectedError
    from oss.src.core.accounts import service as accounts_module

    import oss.src.core.memberships.service as memberships_module
    from oss.src.core.memberships.dtos import MembershipPolicy
    from oss.src.core.memberships.service import MembershipsService

    monkeypatch.setattr(accounts_module, "is_ee", lambda: True)
    monkeypatch.setattr(
        memberships_module,
        "_memberships_service",
        MembershipsService(
            memberships_dao=_dao(), policy=MembershipPolicy.PROJECT_ROWS
        ),
    )
    seeded = await seed_organization(members={"m": "editor"})
    service = PlatformAdminAccountsService()
    try:
        rows = {
            row["user_id"]: row["id"]
            for row in await fetch_all(
                "SELECT id, user_id FROM organization_members WHERE organization_id = :o",
                {"o": seeded.organization_id},
            )
        }
        with pytest.raises(AdminOwnerProtectedError):
            await service.delete_workspace_membership(
                workspace_id=str(seeded.organization_id),
                membership_id=str(rows[seeded.owner_id]),
            )
        response = await service.delete_workspace_membership(
            workspace_id=str(seeded.organization_id),
            membership_id=str(rows[seeded.user_ids["m"]]),
        )
        assert response.deleted.workspace_memberships[0].id == str(
            rows[seeded.user_ids["m"]]
        )
        left = await fetch_all(
            "SELECT 1 FROM organization_members WHERE user_id = :u",
            {"u": seeded.user_ids["m"]},
        )
        assert left == []
    finally:
        await delete_seeded_organization(seeded)


def test_session_link_uses_the_organization_id():
    from oss.src.apis.fastapi.sessions.utils import current_session_response

    organization_id, project_id, session_id = uuid4(), uuid4(), str(uuid4())
    stream = SimpleNamespace(
        session_id=session_id,
        name="s",
        project_id=project_id,
        references=[SimpleNamespace(key="workflow", id=uuid4())],
    )
    # request.state.workspace_id is the organization id in every auth branch (S-7).
    response = current_session_response(
        stream=stream, workspace_id=organization_id, web_url="https://app.example.com"
    )
    assert (
        f"/m/w/{organization_id}/p/{project_id}/sessions/{session_id}" in response.url
    )
