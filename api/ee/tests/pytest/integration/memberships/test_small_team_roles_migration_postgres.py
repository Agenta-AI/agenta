"""Revision `ee0000000008` (admin roles on Hobby and Pro, and on stray owner rows) on a
real Postgres.

Each case seeds its own organizations and runs the revision's statements on a connection
whose transaction is rolled back, over temp copies of the tables that hold only the
seeded organizations. So rows of the shared database never change.
"""

import functools
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text

from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    rolled_back_connection,
    seed_organization,
)


pytestmark = pytest.mark.integration


@functools.lru_cache(maxsize=1)
def _revision():
    import importlib.util

    path = (
        Path(__file__).resolve().parents[4]
        / "databases/postgres/migrations/core_ee/versions"
        / "ee0000000008_set_admin_roles_for_small_team_plans.py"
    )
    spec = importlib.util.spec_from_file_location("_revision_ee008", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_SHADOW_SQL = (
    """CREATE TEMP TABLE subscriptions
       (LIKE public.subscriptions INCLUDING DEFAULTS) ON COMMIT DROP""",
    """INSERT INTO pg_temp.subscriptions
       SELECT * FROM public.subscriptions
       WHERE organization_id = ANY(CAST(:orgs AS uuid[]))""",
    """CREATE TEMP TABLE project_invitations
       (LIKE public.project_invitations INCLUDING DEFAULTS) ON COMMIT DROP""",
    """INSERT INTO pg_temp.project_invitations
       SELECT * FROM public.project_invitations
       WHERE project_id IN (SELECT id FROM pg_temp.projects)""",
)

_ROLES = {
    "admin": "admin",
    "member": "member",
    "viewer": "viewer",
    "editor": "editor",
    "stray_owner": "owner",
}


async def _seed(plan):
    seeded = await seed_organization(members=dict(_ROLES))
    if plan is not None:
        await execute(
            "INSERT INTO subscriptions (organization_id, plan, active) "
            "VALUES (:organization_id, :plan, true)",
            {"organization_id": seeded.organization_id, "plan": plan},
        )
    project_id = seeded.project_ids[0]
    for role, used in (
        ("viewer", False),
        ("viewer", True),
        ("owner", False),
        ("member", False),
    ):
        await execute(
            "INSERT INTO project_invitations "
            "(id, token, email, used, role, project_id, created_at, updated_at) "
            "VALUES (:id, :token, :email, :used, :role, :project_id, now(), now())",
            {
                "id": uuid4(),
                "token": uuid4().hex,
                "email": f"invite-{uuid4().hex[:8]}@test.agenta.ai",
                "used": used,
                "role": role,
                "project_id": project_id,
            },
        )
    return seeded


async def _migrated(organizations):
    """Run the revision on shadow tables; return the roles it leaves, per organization:
    `{org_id: {"organization": {label: role}, "project": {...}, "invitations": [...]}}`."""
    result = {}
    async with rolled_back_connection(organizations=organizations) as connection:
        orgs = [seeded.organization_id for seeded in organizations]
        for statement in _SHADOW_SQL:
            await connection.execute(text(statement), {"orgs": orgs})

        await connection.run_sync(_revision().set_roles)
        # A rerun changes nothing.
        await connection.run_sync(_revision().set_roles)

        for seeded in organizations:
            labels = {user_id: label for label, user_id in seeded.user_ids.items()}
            organization_rows = await connection.execute(
                text(
                    "SELECT user_id, role FROM organization_members "
                    "WHERE organization_id = :id"
                ),
                {"id": seeded.organization_id},
            )
            project_rows = await connection.execute(
                text(
                    "SELECT user_id, role FROM project_members "
                    "WHERE project_id = ANY(CAST(:ids AS uuid[]))"
                ),
                {"ids": seeded.project_ids},
            )
            invitation_rows = await connection.execute(
                text(
                    "SELECT role, used FROM project_invitations "
                    "WHERE project_id = ANY(CAST(:ids AS uuid[])) ORDER BY created_at"
                ),
                {"ids": seeded.project_ids},
            )
            result[seeded.organization_id] = {
                "organization": {labels[u]: r for u, r in organization_rows},
                "project": {labels[u]: r for u, r in project_rows},
                "invitations": sorted((r, bool(used)) for r, used in invitation_rows),
            }
    return result


@pytest.fixture
async def organizations():
    seeded = {
        plan: await _seed(plan)
        for plan in ("cloud_v0_hobby", "cloud_v0_pro", "cloud_v0_business", None)
    }
    try:
        yield seeded
    finally:
        for organization in seeded.values():
            await delete_seeded_organization(organization)


@pytest.mark.parametrize("plan", ["cloud_v0_hobby", "cloud_v0_pro"])
async def test_small_team_plans_become_admins(organizations, plan):
    roles = (await _migrated(list(organizations.values())))[
        organizations[plan].organization_id
    ]
    expected = {
        "owner": "owner",
        "admin": "admin",
        "member": "member",
        "viewer": "admin",
        "editor": "admin",
        "stray_owner": "admin",
    }
    assert roles["organization"] == expected
    assert roles["project"] == expected
    assert roles["invitations"] == sorted(
        [("admin", False), ("viewer", True), ("admin", False), ("member", False)]
    )


@pytest.mark.parametrize("plan", ["cloud_v0_business", None])
async def test_other_plans_keep_roles_but_lose_stray_owners(organizations, plan):
    roles = (await _migrated(list(organizations.values())))[
        organizations[plan].organization_id
    ]
    expected = {
        "owner": "owner",
        "admin": "admin",
        "member": "member",
        "viewer": "viewer",
        "editor": "editor",
        "stray_owner": "admin",
    }
    assert roles["organization"] == expected
    assert roles["project"] == expected
    assert roles["invitations"] == sorted(
        [("viewer", False), ("viewer", True), ("admin", False), ("member", False)]
    )
