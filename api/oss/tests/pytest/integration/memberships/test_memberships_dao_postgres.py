"""`MembershipsDAO` against Postgres: the single-statement readers and the four writers."""

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError, ProgrammingError

import oss.src.dbs.postgres.memberships.dao as dao_module
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.core.memberships.types import (
    MemberNotFound,
    OrganizationOwnerProtected,
)
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    create_user,
    delete_seeded_organization,
    delete_seeded_shapes,
    execute,
    fetch_all,
    seed_legacy_shapes,
    seed_organization,
    seed_stress_organization,
    user_email,
)
from oss.tests.pytest.utils.statements import count_statements


pytestmark = pytest.mark.integration


def _dao() -> MembershipsDAO:
    return MembershipsDAO(engine=get_transactions_engine())


async def _project_roles(project_ids, user_id) -> dict:
    rows = await fetch_all(
        "SELECT project_id, role FROM project_members "
        "WHERE project_id = ANY(CAST(:p AS uuid[])) AND user_id = :u",
        {"p": list(project_ids), "u": user_id},
    )
    found: dict = {}
    for row in rows:
        found.setdefault(row["project_id"], []).append(row["role"])
    return found


async def _organization_roles(organization_id, user_id) -> list:
    rows = await fetch_all(
        "SELECT role FROM organization_members "
        "WHERE organization_id = :o AND user_id = :u ORDER BY created_at, id",
        {"o": organization_id, "u": user_id},
    )
    return [row["role"] for row in rows]


async def _workspace_roles(workspace_ids, user_id) -> dict:
    rows = await fetch_all(
        "SELECT workspace_id, role FROM workspace_members "
        "WHERE workspace_id = ANY(CAST(:w AS uuid[])) AND user_id = :u",
        {"w": list(workspace_ids), "u": user_id},
    )
    return {row["workspace_id"]: row["role"] for row in rows}


async def _counts(seeded) -> dict:
    rows = await fetch_all(
        "SELECT "
        "(SELECT count(*) FROM organization_members WHERE organization_id = :o) AS o, "
        "(SELECT count(*) FROM workspace_members "
        " WHERE workspace_id = ANY(CAST(:w AS uuid[]))) AS w, "
        "(SELECT count(*) FROM project_members "
        " WHERE project_id = ANY(CAST(:p AS uuid[]))) AS p",
        {
            "o": seeded.organization_id,
            "w": seeded.workspace_ids,
            "p": seeded.project_ids,
        },
    )
    return dict(rows[0])


async def _add_invitation(project_id, email) -> None:
    await execute(
        "INSERT INTO project_invitations "
        "(id, token, email, used, role, project_id, created_at) "
        "VALUES (gen_random_uuid(), :token, :email, false, 'viewer', :p, now())",
        {"token": uuid4().hex, "email": email, "p": project_id},
    )


# -- unique index -------------------------------------------------------------------------


async def test_duplicate_insert_is_rejected_and_treated_as_existing():
    seeded = await seed_organization(members={"m": "viewer"})
    member, project = seeded.user_ids["m"], seeded.project_ids[0]
    try:
        with pytest.raises(IntegrityError):
            await execute(
                "INSERT INTO project_members (id, user_id, project_id, role) "
                "VALUES (gen_random_uuid(), :u, :p, 'admin')",
                {"u": member, "p": project},
            )

        await _dao().set_member_role(
            organization_id=seeded.organization_id,
            user_id=member,
            role="editor",
            join_project_ids=[project],
        )

        assert await _project_roles([project], member) == {project: ["editor"]}
    finally:
        await delete_seeded_organization(seeded)


# -- create_project -----------------------------------------------------------------------


async def test_create_project_seeds_every_organization_member():
    members = {"a": "admin", "e": "editor", "v": "viewer", "n": "annotator"}
    seeded = await seed_organization(members=members)
    try:
        created = await _dao().create_project(
            organization_id=seeded.organization_id,
            workspace_id=seeded.workspace_ids[0],
            name="P2",
            is_default=False,
        )

        assert created.seeded_count == 5
        project = created.scope.project_id
        for label, role in {"owner": "owner", **members}.items():
            assert await _project_roles([project], seeded.user_ids[label]) == {
                project: [role]
            }
    finally:
        await delete_seeded_organization(seeded)


async def test_create_project_leaves_nothing_when_seeding_fails(monkeypatch):
    seeded = await seed_organization(members={"m": "editor"})
    # The seeding statement is the last write; the earlier ones (unset the default,
    # insert the project) must roll back with it.
    monkeypatch.setattr(
        dao_module, "_SEED_PROJECT_MEMBERS_SQL", "SELECT no_such_column_for_seeding"
    )
    try:
        with pytest.raises(ProgrammingError, match="no_such_column_for_seeding"):
            await _dao().create_project(
                organization_id=seeded.organization_id,
                workspace_id=seeded.workspace_ids[0],
                name="P-fail",
                is_default=True,
            )

        rows = await fetch_all(
            "SELECT project_name, is_default FROM projects WHERE organization_id = :o",
            {"o": seeded.organization_id},
        )
        assert [(r["project_name"], r["is_default"]) for r in rows] == [
            ("project-0-0", True)
        ]
    finally:
        await delete_seeded_organization(seeded)


async def test_workspace_create_seeds_every_organization_member():
    seeded = await seed_organization(members={"a": "admin", "v": "viewer"})
    workspace = uuid4()
    try:
        await execute(
            "INSERT INTO workspaces (id, name, type, organization_id, created_at) "
            "VALUES (:id, 'second', 'default', :o, now())",
            {"id": workspace, "o": seeded.organization_id},
        )

        created = await _dao().create_project(
            organization_id=seeded.organization_id,
            workspace_id=workspace,
            name="Default",
            is_default=True,
        )

        assert created.scope.is_default is True
        assert created.seeded_count == 3
        rows = await fetch_all(
            "SELECT is_default FROM projects WHERE id = :p",
            {"p": created.scope.project_id},
        )
        assert rows[0]["is_default"] is True
        for label, role in {"owner": "owner", "a": "admin", "v": "viewer"}.items():
            assert await _project_roles(
                [created.scope.project_id], seeded.user_ids[label]
            ) == {created.scope.project_id: [role]}
    finally:
        await delete_seeded_organization(seeded)


async def test_create_project_seeds_2000_members_in_one_statement():
    seeded = await seed_stress_organization(members=1999, projects=1)
    try:
        with count_statements(get_transactions_engine()) as statements:
            created = await _dao().create_project(
                organization_id=seeded.organization_id,
                workspace_id=seeded.workspace_ids[0],
                name="Big",
                is_default=False,
            )

        member_inserts = [
            s
            for s in statements
            if s.lstrip().startswith("INSERT INTO project_members")
        ]
        assert len(member_inserts) == 1
        assert created.seeded_count == 2000
        rows = await fetch_all(
            "SELECT count(DISTINCT id) AS n FROM project_members WHERE project_id = :p",
            {"p": created.scope.project_id},
        )
        assert rows[0]["n"] == 2000
    finally:
        await delete_seeded_organization(seeded)


# -- set_member_role ----------------------------------------------------------------------


async def test_role_change_keeps_a_removed_row_removed():
    seeded = await seed_organization(members={"m": "viewer"}, projects_per_workspace=2)
    member = seeded.user_ids["m"]
    p1, p2 = seeded.project_ids
    try:
        await execute(
            "DELETE FROM project_members WHERE project_id = :p AND user_id = :u",
            {"p": p2, "u": member},
        )

        await _dao().set_member_role(
            organization_id=seeded.organization_id, user_id=member, role="editor"
        )

        assert await _project_roles(seeded.project_ids, member) == {p1: ["editor"]}
    finally:
        await delete_seeded_organization(seeded)


async def test_role_change_updates_existing_rows_and_creates_none():
    seeded = await seed_organization(members={"m": "viewer"}, projects_per_workspace=3)
    member = seeded.user_ids["m"]
    try:
        await execute(
            "DELETE FROM project_members WHERE project_id = :p AND user_id = :u",
            {"p": seeded.project_ids[2], "u": member},
        )

        result = await _dao().set_member_role(
            organization_id=seeded.organization_id, user_id=member, role="editor"
        )

        assert result.previous_role == "viewer"
        assert result.inserted_count == 0
        assert await _project_roles(seeded.project_ids, member) == {
            seeded.project_ids[0]: ["editor"],
            seeded.project_ids[1]: ["editor"],
        }
        assert await _organization_roles(seeded.organization_id, member) == ["editor"]
    finally:
        await delete_seeded_organization(seeded)


async def test_invite_accept_writes_every_row():
    seeded = await seed_organization(
        members={"owner": "owner"}, workspaces=2, projects_per_workspace=2
    )
    newcomer = await create_user(label="newcomer")
    seeded.extra_user_ids.append(newcomer)
    try:
        result = await _dao().set_member_role(
            organization_id=seeded.organization_id,
            user_id=newcomer,
            role="annotator",
            join_all_projects=True,
        )

        assert result.inserted_count == 4
        assert await _organization_roles(seeded.organization_id, newcomer) == [
            "annotator"
        ]
        assert await _workspace_roles(seeded.workspace_ids, newcomer) == {
            w: "annotator" for w in seeded.workspace_ids
        }
        assert await _project_roles(seeded.project_ids, newcomer) == {
            p: ["annotator"] for p in seeded.project_ids
        }
    finally:
        await delete_seeded_organization(seeded)


async def test_role_change_refuses_the_owner_and_must_exist():
    seeded = await seed_organization(members={"m": "viewer"})
    stranger = await create_user(label="stranger")
    seeded.extra_user_ids.append(stranger)
    try:
        before = await _counts(seeded)

        with pytest.raises(OrganizationOwnerProtected):
            await _dao().set_member_role(
                organization_id=seeded.organization_id,
                user_id=seeded.owner_id,
                role="viewer",
            )
        with pytest.raises(MemberNotFound):
            await _dao().set_member_role(
                organization_id=seeded.organization_id,
                user_id=stranger,
                role="viewer",
                must_exist=True,
            )

        assert await _counts(seeded) == before
        assert await _organization_roles(seeded.organization_id, seeded.owner_id) == [
            "owner"
        ]
    finally:
        await delete_seeded_organization(seeded)


async def test_must_be_absent_keeps_a_member_written_in_between():
    # Auto-join reads "not a member", then an invitation is accepted, then the
    # auto-join write runs: the invitation's role and rows stay.
    seeded = await seed_organization(
        members={"owner": "owner"}, projects_per_workspace=2
    )
    user = await create_user(label="invited")
    seeded.extra_user_ids.append(user)
    try:
        await _dao().set_member_role(
            organization_id=seeded.organization_id,
            user_id=user,
            role="editor",
            join_project_ids=[seeded.project_ids[0]],
        )

        result = await _dao().set_member_role(
            organization_id=seeded.organization_id,
            user_id=user,
            role="viewer",
            join_all_projects=True,
            must_be_absent=True,
        )

        assert result.user_id is None and result.inserted_count == 0
        assert await _organization_roles(seeded.organization_id, user) == ["editor"]
        assert await _project_roles(seeded.project_ids, user) == {
            seeded.project_ids[0]: ["editor"]
        }

        # A user who is still absent joins.
        newcomer = await create_user(label="newcomer")
        seeded.extra_user_ids.append(newcomer)
        joined = await _dao().set_member_role(
            organization_id=seeded.organization_id,
            user_id=newcomer,
            role="viewer",
            join_all_projects=True,
            must_be_absent=True,
        )
        assert joined.user_id == newcomer and joined.inserted_count == 2
        assert await _organization_roles(seeded.organization_id, newcomer) == ["viewer"]
    finally:
        await delete_seeded_organization(seeded)


async def test_concurrent_role_writes_leave_one_row_per_project():
    seeded = await seed_organization(
        members={"owner": "owner"}, projects_per_workspace=3
    )
    newcomer = await create_user(label="newcomer")
    seeded.extra_user_ids.append(newcomer)
    try:
        await asyncio.gather(
            *[
                _dao().set_member_role(
                    organization_id=seeded.organization_id,
                    user_id=newcomer,
                    role=role,
                    join_all_projects=True,
                )
                for role in ("viewer", "editor")
            ]
        )

        roles = await _project_roles(seeded.project_ids, newcomer)
        assert set(roles) == set(seeded.project_ids)
        assert all(len(r) == 1 for r in roles.values())
        flat = {r[0] for r in roles.values()}
        assert len(flat) == 1
        assert await _organization_roles(seeded.organization_id, newcomer) == list(flat)
    finally:
        await delete_seeded_organization(seeded)


# -- remove_member ------------------------------------------------------------------------


async def test_remove_member_refuses_the_organization_owner():
    seeded = await seed_organization(members={"m": "viewer"})
    try:
        before = await _counts(seeded)

        with pytest.raises(OrganizationOwnerProtected):
            await _dao().remove_member(
                organization_id=seeded.organization_id,
                email=await user_email(seeded.owner_id),
            )

        assert await _counts(seeded) == before
    finally:
        await delete_seeded_organization(seeded)


async def test_remove_member_clears_rows_and_invitations_in_the_organization():
    org_a = await seed_organization(members={"m": "editor"})
    org_b = await seed_organization(members={"owner": "owner"})
    member = org_a.user_ids["m"]
    try:
        # The member is also in organization B.
        await _dao().set_member_role(
            organization_id=org_b.organization_id,
            user_id=member,
            role="viewer",
            join_all_projects=True,
        )
        email = await user_email(member)
        await _add_invitation(org_a.project_ids[0], email)

        result = await _dao().remove_member(
            organization_id=org_a.organization_id, email=email
        )

        assert result.user_id == member
        assert result.deleted_invitation_count == 1
        assert await _organization_roles(org_a.organization_id, member) == []
        assert await _workspace_roles(org_a.workspace_ids, member) == {}
        assert await _project_roles(org_a.project_ids, member) == {}
        invitations = await fetch_all(
            "SELECT id FROM project_invitations WHERE project_id = :p",
            {"p": org_a.project_ids[0]},
        )
        assert invitations == []
        assert await _organization_roles(org_b.organization_id, member) == ["viewer"]
        assert await _project_roles(org_b.project_ids, member) == {
            org_b.project_ids[0]: ["viewer"]
        }
    finally:
        await delete_seeded_organization(org_a)
        await delete_seeded_organization(org_b)


async def test_remove_member_with_only_an_invitation():
    seeded = await seed_organization(members={"owner": "owner"})
    email = f"membership-invite-{uuid4().hex}@test.agenta.ai"
    try:
        await _add_invitation(seeded.project_ids[0], email)

        result = await _dao().remove_member(
            organization_id=seeded.organization_id, email=email
        )

        assert result.user_id is None
        assert result.deleted_invitation_count == 1
    finally:
        await delete_seeded_organization(seeded)


# -- transfer_ownership -------------------------------------------------------------------


async def test_transfer_ownership_seeds_the_new_owner_in_every_project():
    seeded = await seed_organization(members={"a": "admin"}, projects_per_workspace=2)
    new_owner = seeded.user_ids["a"]
    p1, p2 = seeded.project_ids
    try:
        await execute(
            "DELETE FROM project_members WHERE project_id = :p AND user_id = :u",
            {"p": p2, "u": new_owner},
        )

        result = await _dao().transfer_ownership(
            organization_id=seeded.organization_id,
            new_owner_id=new_owner,
            current_owner_id=seeded.owner_id,
        )

        owner = await fetch_all(
            "SELECT owner_id FROM organizations WHERE id = :o",
            {"o": seeded.organization_id},
        )
        assert owner[0]["owner_id"] == new_owner
        assert await _organization_roles(seeded.organization_id, new_owner) == ["owner"]
        assert await _organization_roles(seeded.organization_id, seeded.owner_id) == [
            "admin"
        ]
        assert await _workspace_roles(seeded.workspace_ids, new_owner) == {
            seeded.workspace_ids[0]: "owner"
        }
        assert await _project_roles(seeded.project_ids, new_owner) == {
            p1: ["admin"],
            p2: ["owner"],
        }
        assert result.inserted_count == 1
    finally:
        await delete_seeded_organization(seeded)


async def test_transfer_ownership_leaves_nothing_when_a_step_fails(monkeypatch):
    seeded = await seed_organization(members={"a": "admin"}, projects_per_workspace=2)
    new_owner = seeded.user_ids["a"]
    try:
        await execute(
            "DELETE FROM project_members WHERE project_id = :p AND user_id = :u",
            {"p": seeded.project_ids[1], "u": new_owner},
        )
        # The owner update is the last write; the role swaps and the seeded owner
        # row must roll back with it.
        monkeypatch.setattr(
            dao_module, "_SET_OWNER_SQL", "UPDATE no_such_table_for_transfer SET x = 1"
        )

        with pytest.raises(ProgrammingError, match="no_such_table_for_transfer"):
            await _dao().transfer_ownership(
                organization_id=seeded.organization_id,
                new_owner_id=new_owner,
                current_owner_id=seeded.owner_id,
            )

        owner = await fetch_all(
            "SELECT owner_id FROM organizations WHERE id = :o",
            {"o": seeded.organization_id},
        )
        assert owner[0]["owner_id"] == seeded.owner_id
        assert await _organization_roles(seeded.organization_id, new_owner) == ["admin"]
        assert await _organization_roles(seeded.organization_id, seeded.owner_id) == [
            "owner"
        ]
        assert await _project_roles(seeded.project_ids, new_owner) == {
            seeded.project_ids[0]: ["admin"]
        }
        assert await _workspace_roles(seeded.workspace_ids, new_owner) == {
            seeded.workspace_ids[0]: "admin"
        }
        assert await _workspace_roles(seeded.workspace_ids, seeded.owner_id) == {
            seeded.workspace_ids[0]: "owner"
        }
    finally:
        await delete_seeded_organization(seeded)


async def test_transfer_ownership_refuses_a_stale_current_owner():
    seeded = await seed_organization(members={"a": "admin", "b": "editor"})
    try:
        await _dao().transfer_ownership(
            organization_id=seeded.organization_id,
            new_owner_id=seeded.user_ids["a"],
            current_owner_id=seeded.owner_id,
        )

        # A second transfer authorized for the former owner is stale now.
        with pytest.raises(MemberNotFound):
            await _dao().transfer_ownership(
                organization_id=seeded.organization_id,
                new_owner_id=seeded.user_ids["b"],
                current_owner_id=seeded.owner_id,
            )

        owner = await fetch_all(
            "SELECT owner_id FROM organizations WHERE id = :o",
            {"o": seeded.organization_id},
        )
        assert owner[0]["owner_id"] == seeded.user_ids["a"]
        assert await _organization_roles(
            seeded.organization_id, seeded.user_ids["b"]
        ) == ["editor"]
    finally:
        await delete_seeded_organization(seeded)


async def test_invite_accept_never_adds_a_row_in_another_organization_workspace():
    shapes = await seed_legacy_shapes()
    cross = shapes["cross_org_workspace"]
    newcomer = await create_user(label="newcomer")
    cross.extra_user_ids.append(newcomer)
    try:
        await _dao().set_member_role(
            organization_id=cross.organization_id,
            user_id=newcomer,
            role="viewer",
            join_all_projects=True,
        )

        rows = await fetch_all(
            "SELECT w.organization_id FROM workspace_members wm "
            "JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = :u",
            {"u": newcomer},
        )
        assert {r["organization_id"] for r in rows} <= {cross.organization_id}
    finally:
        await delete_seeded_shapes(shapes)


# -- readers ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "policy", [MembershipPolicy.ORGANIZATION_WIDE, MembershipPolicy.PROJECT_ROWS]
)
async def test_workspace_row_deleted_does_not_change_resolve(policy):
    seeded = await seed_organization(members={"m": "editor"})
    member, project = seeded.user_ids["m"], seeded.project_ids[0]
    service = MembershipsService(memberships_dao=_dao(), policy=policy)
    try:
        before = await service.resolve(user_id=member, project_id=project)
        await execute("DELETE FROM workspace_members WHERE user_id = :u", {"u": member})
        after = await service.resolve(user_id=member, project_id=project)

        assert before is not None
        assert after == before
    finally:
        await delete_seeded_organization(seeded)


async def test_membership_row_reads_the_oldest_organization_row_in_one_statement():
    seeded = await seed_organization(members={"m": "editor"})
    member, project = seeded.user_ids["m"], seeded.project_ids[0]
    try:
        await execute(
            "UPDATE organization_members SET role = 'viewer', "
            "created_at = now() - interval '1 day' "
            "WHERE organization_id = :o AND user_id = :u",
            {"o": seeded.organization_id, "u": member},
        )
        await execute(
            "INSERT INTO organization_members "
            "(id, user_id, organization_id, role, created_at) "
            "VALUES (gen_random_uuid(), :u, :o, 'admin', now())",
            {"o": seeded.organization_id, "u": member},
        )
        dao = _dao()

        with count_statements(get_transactions_engine()) as statements:
            row = await dao.fetch_membership_row(user_id=member, project_id=project)

        assert len(statements) == 1
        assert row.organization_role == "viewer"
        assert row.project_role == "editor"
        assert row.has_organization_row is True
        assert row.has_project_row is True
        assert row.summary.project_name == "project-0-0"
        assert row.summary.workspace_name == "workspace-0"
        assert row.summary.organization_name.startswith("membership-seed-")
        assert row.summary.organization_owner_id == seeded.owner_id
    finally:
        await delete_seeded_organization(seeded)


async def test_membership_row_reports_a_null_role_row_as_present():
    seeded = await seed_organization(members={"m": "editor"}, projects_per_workspace=2)
    member = seeded.user_ids["m"]
    p1, p2 = seeded.project_ids
    try:
        await execute(
            "UPDATE project_members SET role = NULL WHERE project_id = :p AND user_id = :u",
            {"p": p1, "u": member},
        )
        await execute(
            "DELETE FROM project_members WHERE project_id = :p AND user_id = :u",
            {"p": p2, "u": member},
        )

        with_null = await _dao().fetch_membership_row(user_id=member, project_id=p1)
        without = await _dao().fetch_membership_row(user_id=member, project_id=p2)

        assert with_null.has_project_row is True
        assert with_null.project_role is None
        assert without.has_project_row is False
        assert (
            await _dao().fetch_membership_row(user_id=member, project_id=uuid4())
            is None
        )
    finally:
        await delete_seeded_organization(seeded)


async def test_membership_rows_list_every_project_of_the_user_organizations_in_one_statement():
    org_a = await seed_organization(
        members={"m": "editor"}, workspaces=2, projects_per_workspace=2
    )
    org_b = await seed_organization(members={"owner": "owner"})
    org_c = await seed_organization(members={"owner": "owner"})
    member = org_a.user_ids["m"]
    try:
        # Project rows in one of the four projects of A only.
        await execute(
            "DELETE FROM project_members WHERE user_id = :u AND project_id <> :keep",
            {"u": member, "keep": org_a.project_ids[0]},
        )
        await execute(
            "INSERT INTO organization_members (id, user_id, organization_id, role) "
            "VALUES (gen_random_uuid(), :u, :o, 'viewer')",
            {"u": member, "o": org_b.organization_id},
        )
        dao = _dao()

        with count_statements(get_transactions_engine()) as statements:
            rows = await dao.list_membership_rows(user_id=member)

        assert len(statements) == 1
        assert len(rows) == 5
        assert {r.summary.organization_id for r in rows} == {
            org_a.organization_id,
            org_b.organization_id,
        }
        with_row = {r.summary.project_id for r in rows if r.has_project_row}
        assert with_row == {org_a.project_ids[0]}
        organization_order = [r.summary.organization_id for r in rows]
        assert organization_order == sorted(organization_order)
        a_rows = [
            r.summary.project_id
            for r in rows
            if r.summary.organization_id == org_a.organization_id
        ]
        assert a_rows == org_a.project_ids
    finally:
        for seeded in (org_a, org_b, org_c):
            await delete_seeded_organization(seeded)


async def test_list_projects_and_fetch_organization_member():
    seeded = await seed_organization(members={"m": "editor"}, projects_per_workspace=2)
    try:
        scopes = await _dao().list_projects(organization_ids=[seeded.organization_id])
        assert [s.project_id for s in scopes] == seeded.project_ids
        assert all(s.organization_owner_id == seeded.owner_id for s in scopes)

        member = await _dao().fetch_organization_member(
            organization_id=seeded.organization_id, user_id=seeded.user_ids["m"]
        )
        assert member.role == "editor"
        assert (
            await _dao().fetch_organization_member(
                organization_id=seeded.organization_id, user_id=uuid4()
            )
            is None
        )
    finally:
        await delete_seeded_organization(seeded)
