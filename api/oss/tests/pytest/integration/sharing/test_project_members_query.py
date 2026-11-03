"""`MembershipsDAO.query_project_member_profiles` on the real database: the people the
share picker lists for a project.

OSS (`ORGANIZATION_WIDE`) lists the organization members with their organization role;
EE (`PROJECT_ROWS`) lists the project rows whose user also has an organization row,
with the project role. Workspace members are never listed. The policy is an argument of
the DAO, so both editions run in either license.
"""

from contextlib import asynccontextmanager
from typing import Dict
from uuid import UUID, uuid4

import pytest

from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.shared.dtos import Windowing
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    create_user,
    delete_seeded_organization,
    execute,
    seed_organization,
)


pytestmark = pytest.mark.integration


@asynccontextmanager
async def seeded(members: Dict[str, str], *, project_rows: bool):
    org = await seed_organization(members=members, project_rows=project_rows)
    try:
        yield org
    finally:
        await delete_seeded_organization(org)


def _dao() -> MembershipsDAO:
    return MembershipsDAO(engine=get_transactions_engine())


async def _name(user_id: UUID, *, email: str, name: str) -> None:
    await execute(
        "UPDATE users SET email = :email, username = :name WHERE id = :id",
        {"id": user_id, "email": email, "name": name},
    )


async def _project_row(project_id: UUID, user_id: UUID, role: str) -> None:
    await execute(
        "INSERT INTO project_members (id, user_id, project_id, role, created_at, "
        "updated_at) VALUES (gen_random_uuid(), :u, :p, :r, now(), now())",
        {"u": user_id, "p": project_id, "r": role},
    )


async def _workspace_only_user(org) -> UUID:
    """A user with a workspace row in the organization and nothing else."""

    user_id = await create_user(label="workspace-only")
    org.extra_user_ids.append(user_id)
    await execute(
        "INSERT INTO workspace_members (id, user_id, workspace_id, role, created_at, "
        "updated_at) VALUES (gen_random_uuid(), :u, :w, 'editor', now(), now())",
        {"u": user_id, "w": org.workspace_ids[0]},
    )
    return user_id


async def test_oss_lists_organization_members():
    async with seeded(
        {"owner": "owner", "alice": "editor", "bob": "viewer"}, project_rows=False
    ) as org:
        await _workspace_only_user(org)

        profiles = await _dao().query_project_member_profiles(
            project_id=org.project_ids[0],
            policy=MembershipPolicy.ORGANIZATION_WIDE,
        )

        assert {p.user_id: p.role for p in profiles} == {
            org.user_ids["owner"]: "owner",
            org.user_ids["alice"]: "editor",
            org.user_ids["bob"]: "viewer",
        }
        assert [p.email for p in profiles] == sorted(p.email for p in profiles)


async def test_ee_lists_project_rows():
    async with seeded(
        {"owner": "owner", "alice": "editor", "bob": "viewer"}, project_rows=False
    ) as org:
        project_id = org.project_ids[0]
        await _project_row(project_id, org.user_ids["alice"], "admin")
        await _project_row(project_id, org.user_ids["owner"], "owner")
        # A project row without an organization row is no membership.
        outsider = await create_user(label="outsider")
        org.extra_user_ids.append(outsider)
        await _project_row(project_id, outsider, "editor")
        await _workspace_only_user(org)

        profiles = await _dao().query_project_member_profiles(
            project_id=project_id,
            policy=MembershipPolicy.PROJECT_ROWS,
        )

        # The project role, not the organization role.
        assert {p.user_id: p.role for p in profiles} == {
            org.user_ids["alice"]: "admin",
            org.user_ids["owner"]: "owner",
        }


async def test_windowing_and_search():
    async with seeded(
        {"owner": "owner", "alice": "editor", "alan": "editor", "bob": "editor"},
        project_rows=True,
    ) as org:
        tag = org.organization_id.hex[:12]
        ids = org.user_ids
        await _name(ids["owner"], email=f"owner-{tag}@test.agenta.ai", name="Olga")
        await _name(ids["alice"], email=f"alice-{tag}@test.agenta.ai", name="Ally")
        # Matches by name only: the email does not start with "al".
        await _name(ids["alan"], email=f"zed-{tag}@test.agenta.ai", name="Alan")
        await _name(ids["bob"], email=f"bob-{tag}@test.agenta.ai", name="Bob")
        project_id = org.project_ids[0]

        for policy in MembershipPolicy:
            found = await _dao().query_project_member_profiles(
                project_id=project_id, policy=policy, search="AL"
            )
            assert [p.user_id for p in found] == [ids["alice"], ids["alan"]]
            assert found[1].name == "Alan"

            # A LIKE wildcard in the search is a literal character.
            assert (
                await _dao().query_project_member_profiles(
                    project_id=project_id, policy=policy, search="%"
                )
                == []
            )

            everyone = await _dao().query_project_member_profiles(
                project_id=project_id, policy=policy
            )
            assert [p.email for p in everyone] == sorted(p.email for p in everyone)
            assert len(everyone) == 4

            paged, cursor = [], None
            while True:
                page = await _dao().query_project_member_profiles(
                    project_id=project_id,
                    policy=policy,
                    windowing=Windowing(limit=1, next=cursor),
                )
                if not page:
                    break
                assert len(page) == 1
                paged.extend(page)
                cursor = page[-1].user_id
            assert paged == everyone

            # A search pages too.
            first = await _dao().query_project_member_profiles(
                project_id=project_id,
                policy=policy,
                search="al",
                windowing=Windowing(limit=1),
            )
            second = await _dao().query_project_member_profiles(
                project_id=project_id,
                policy=policy,
                search="al",
                windowing=Windowing(limit=1, next=first[0].user_id),
            )
            assert [p.user_id for p in first + second] == [ids["alice"], ids["alan"]]


async def test_unknown_project_lists_nobody():
    for policy in MembershipPolicy:
        assert (
            await _dao().query_project_member_profiles(
                project_id=uuid4(), policy=policy
            )
            == []
        )
