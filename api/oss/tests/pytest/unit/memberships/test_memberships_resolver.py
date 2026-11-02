from uuid import uuid4

import orjson
import pytest

from oss.src.core.memberships.dtos import (
    MembershipPolicy,
    MembershipSource,
    ProjectMembership,
)
from oss.src.core.memberships.service import MembershipsService
from oss.src.utils import caching
from oss.tests.pytest.utils.memberships import InMemoryMembershipsDAO, make_summary


BOTH = [MembershipPolicy.ORGANIZATION_WIDE, MembershipPolicy.PROJECT_ROWS]


def _service(dao, policy):
    return MembershipsService(memberships_dao=dao, policy=policy)


async def test_unknown_project_is_not_a_member():
    dao = InMemoryMembershipsDAO()
    service = _service(dao, MembershipPolicy.ORGANIZATION_WIDE)
    assert await service.resolve(user_id=uuid4(), project_id=uuid4()) is None


async def test_oss_member_without_a_project_row_resolves_with_the_organization_role():
    dao = InMemoryMembershipsDAO()
    project = dao.add_project(make_summary())
    user = uuid4()
    dao.add_organization_member(
        organization_id=project.organization_id, user_id=user, role="editor"
    )

    membership = await _service(dao, MembershipPolicy.ORGANIZATION_WIDE).resolve(
        user_id=user, project_id=project.project_id
    )

    assert membership.role == "editor"
    assert membership.source == MembershipSource.ORGANIZATION
    assert membership.is_organization_owner is False


async def test_oss_stale_project_role_resolves_to_the_organization_role():
    dao = InMemoryMembershipsDAO()
    project = dao.add_project(make_summary())
    user = uuid4()
    dao.add_organization_member(
        organization_id=project.organization_id, user_id=user, role="editor"
    )
    dao.add_project_member(project_id=project.project_id, user_id=user, role="viewer")

    membership = await _service(dao, MembershipPolicy.ORGANIZATION_WIDE).resolve(
        user_id=user, project_id=project.project_id
    )

    assert membership.role == "editor"


async def test_ee_member_without_a_row_is_not_a_member():
    dao = InMemoryMembershipsDAO()
    project = dao.add_project(make_summary())
    user = uuid4()
    dao.add_organization_member(
        organization_id=project.organization_id, user_id=user, role="editor"
    )

    assert (
        await _service(dao, MembershipPolicy.PROJECT_ROWS).resolve(
            user_id=user, project_id=project.project_id
        )
        is None
    )


@pytest.mark.parametrize("policy", BOTH)
async def test_project_row_without_organization_row_is_not_a_member(policy):
    dao = InMemoryMembershipsDAO()
    project = dao.add_project(make_summary())
    user = uuid4()
    dao.add_project_member(project_id=project.project_id, user_id=user, role="admin")

    assert (
        await _service(dao, policy).resolve(user_id=user, project_id=project.project_id)
        is None
    )


def _matrix():
    dao = InMemoryMembershipsDAO()
    user = uuid4()
    organizations = [uuid4(), uuid4()]
    projects = [
        dao.add_project(make_summary(organization_id=org))
        for org in organizations
        for _ in range(2)
    ]
    dao.add_organization_member(
        organization_id=organizations[0], user_id=user, role="admin"
    )
    dao.add_organization_member(
        organization_id=organizations[1], user_id=user, role="viewer"
    )
    dao.add_project_member(
        project_id=projects[0].project_id, user_id=user, role="editor"
    )
    dao.add_project_member(
        project_id=projects[2].project_id, user_id=user, role="viewer"
    )
    # A project of a third organization where the user has only a project row.
    stray = dao.add_project(make_summary())
    dao.add_project_member(project_id=stray.project_id, user_id=user, role="owner")
    return dao, user, [*projects, stray]


@pytest.mark.parametrize("policy", BOTH)
async def test_list_for_user_agrees_with_resolve(policy):
    dao, user, projects = _matrix()
    service = _service(dao, policy)

    listings = await service.list_for_user(user_id=user)

    resolved = {}
    for project in projects:
        membership = await service.resolve(user_id=user, project_id=project.project_id)
        if membership is not None:
            resolved[project.project_id] = membership.role
    assert {x.membership.project_id: x.membership.role for x in listings} == resolved


async def test_ee_to_oss_gives_every_team_project():
    dao = InMemoryMembershipsDAO()
    organization = uuid4()
    projects = [
        dao.add_project(make_summary(organization_id=organization)) for _ in range(3)
    ]
    user = uuid4()
    dao.add_organization_member(
        organization_id=organization, user_id=user, role="editor"
    )
    dao.add_project_member(
        project_id=projects[0].project_id, user_id=user, role="editor"
    )

    ee = await _service(dao, MembershipPolicy.PROJECT_ROWS).list_for_user(user_id=user)
    oss = await _service(dao, MembershipPolicy.ORGANIZATION_WIDE).list_for_user(
        user_id=user
    )

    assert len(ee) == 1
    assert len(oss) == 3


async def test_null_role_project_row_is_a_member_without_capabilities():
    dao = InMemoryMembershipsDAO()
    project = dao.add_project(make_summary())
    user = uuid4()
    dao.add_organization_member(
        organization_id=project.organization_id, user_id=user, role="editor"
    )
    dao.add_project_member(project_id=project.project_id, user_id=user, role=None)

    ee = await _service(dao, MembershipPolicy.PROJECT_ROWS).resolve(
        user_id=user, project_id=project.project_id
    )
    oss = await _service(dao, MembershipPolicy.ORGANIZATION_WIDE).resolve(
        user_id=user, project_id=project.project_id
    )

    assert ee is not None
    assert ee.role is None
    assert ee.source == MembershipSource.PROJECT
    assert oss.role == "editor"


async def test_resolve_reads_one_dao_row():
    dao, user, projects = _matrix()
    service = _service(dao, MembershipPolicy.PROJECT_ROWS)

    await service.resolve(user_id=user, project_id=projects[0].project_id)
    assert dao.reads == ["fetch_membership_row"]

    dao.reads.clear()
    await service.list_for_user(user_id=user)
    assert dao.reads == ["list_membership_rows"]

    dao.reads.clear()
    await service.fetch_for_user(user_id=user, project_id=projects[0].project_id)
    assert dao.reads == ["fetch_membership_row"]


async def test_is_member_goes_through_resolve(monkeypatch):
    service = _service(InMemoryMembershipsDAO(), MembershipPolicy.ORGANIZATION_WIDE)
    calls = []

    async def _resolve(**kwargs):
        calls.append(kwargs)
        return None

    monkeypatch.setattr(service, "resolve", _resolve)
    user, project = uuid4(), uuid4()

    assert await service.is_member(user_id=user, project_id=project) is False
    assert calls == [{"user_id": user, "project_id": project}]


@pytest.mark.parametrize("role", ["admin", None])
def test_project_membership_round_trips_through_the_cache_serializer(role):
    membership = ProjectMembership(
        project_id=uuid4(),
        user_id=uuid4(),
        organization_id=uuid4(),
        role=role,
        source=MembershipSource.PROJECT,
        is_organization_owner=True,
    )

    assert (
        ProjectMembership.model_validate(orjson.loads(caching._serialize(membership)))
        == membership
    )


async def test_organization_owner_flag_comes_from_the_project_scope():
    dao = InMemoryMembershipsDAO()
    user = uuid4()
    project = dao.add_project(make_summary(organization_owner_id=user))
    dao.add_organization_member(
        organization_id=project.organization_id, user_id=user, role="viewer"
    )

    membership = await _service(dao, MembershipPolicy.ORGANIZATION_WIDE).resolve(
        user_id=user, project_id=project.project_id
    )

    assert membership.is_organization_owner is True
