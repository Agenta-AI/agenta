"""`MembershipsService.query_project_members` applies the service's edition policy."""

from uuid import uuid4

import pytest

from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.tests.pytest.utils.memberships import InMemoryMembershipsDAO, make_summary


@pytest.mark.parametrize(
    "policy, expected",
    [
        (MembershipPolicy.ORGANIZATION_WIDE, {"alice": "editor", "bob": "viewer"}),
        (MembershipPolicy.PROJECT_ROWS, {"alice": "admin"}),
    ],
)
async def test_query_project_members_uses_the_service_policy(policy, expected):
    dao = InMemoryMembershipsDAO()
    summary = dao.add_project(make_summary())
    people = {}
    for label, role in (("alice", "editor"), ("bob", "viewer")):
        people[label] = dao.add_user(
            user_id=uuid4(), email=f"{label}@example.com", name=label.title()
        )
        dao.add_organization_member(
            organization_id=summary.organization_id,
            user_id=people[label],
            role=role,
        )
    dao.add_project_member(
        project_id=summary.project_id, user_id=people["alice"], role="admin"
    )

    service = MembershipsService(memberships_dao=dao, policy=policy)
    profiles = await service.query_project_members(project_id=summary.project_id)

    assert {p.user_id: p.role for p in profiles} == {
        people[label]: role for label, role in expected.items()
    }
    assert dao.reads == ["query_project_member_profiles"]
