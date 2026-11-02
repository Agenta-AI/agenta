"""The `resolve_membership` cache in `MembershipsService.resolve`.

`FakeCache` keeps the bytes of the real serializer, so these tests also prove that a
cached membership and a cached absence read back as hits.
"""

from uuid import uuid4

import pytest

import oss.src.core.memberships.service as service_module
from oss.src.core.memberships.dtos import (
    CachedMembership,
    MembershipPolicy,
    MembershipWriteResult,
)
from oss.src.core.memberships.service import MembershipsService
from oss.src.utils import caching
from oss.src.utils.env import env
from oss.tests.pytest.utils.cache import FakeCache
from oss.tests.pytest.utils.memberships import InMemoryMembershipsDAO, make_summary


@pytest.fixture
def fake_cache(monkeypatch):
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    return FakeCache().install(monkeypatch, service_module)


class _World:
    def __init__(self, *, projects: int = 1, policy=MembershipPolicy.PROJECT_ROWS):
        self.dao = InMemoryMembershipsDAO()
        self.organization_id = uuid4()
        self.projects = [
            self.dao.add_project(make_summary(organization_id=self.organization_id))
            for _ in range(projects)
        ]
        self.service = MembershipsService(memberships_dao=self.dao, policy=policy)

    @property
    def project_id(self):
        return self.projects[0].project_id

    def add(self, user, role="editor"):
        self.dao.add_organization_member(
            organization_id=self.organization_id, user_id=user, role=role
        )
        for project in self.projects:
            self.dao.add_project_member(
                project_id=project.project_id, user_id=user, role=role
            )

    def drop(self, user):
        self.dao.organization_members = [
            m for m in self.dao.organization_members if m.user_id != user
        ]
        self.dao.project_members = [
            m for m in self.dao.project_members if m.user_id != user
        ]


async def test_resolve_hit_skips_the_dao(fake_cache):
    world = _World()
    user = uuid4()
    world.add(user)

    first = await world.service.resolve(user_id=user, project_id=world.project_id)
    second = await world.service.resolve(user_id=user, project_id=world.project_id)

    assert first is not None and first == second
    assert world.dao.reads == ["fetch_membership_row"]


async def test_absence_is_cached_as_a_tagged_entry(fake_cache):
    world = _World()
    user = uuid4()

    assert (
        await world.service.resolve(user_id=user, project_id=world.project_id) is None
    )
    assert (
        await world.service.resolve(user_id=user, project_id=world.project_id) is None
    )
    assert world.dao.reads == ["fetch_membership_row"]

    name = caching._pack(
        namespace="resolve_membership",
        key="membership",
        project_id=str(world.project_id),
        user_id=str(user),
    )
    stored = caching._deserialize(fake_cache.store[name], model=CachedMembership)
    assert stored == CachedMembership(membership=None)


async def test_membership_removal_is_seen_by_the_next_resolve_with_a_warm_cache(
    fake_cache,
):
    world = _World()
    user = uuid4()
    world.add(user)
    assert await world.service.resolve(user_id=user, project_id=world.project_id)

    world.drop(user)
    world.dao.write_results["remove_member"] = MembershipWriteResult(user_id=user)
    await world.service.remove_member(
        organization_id=world.organization_id, email="x@test.agenta.ai"
    )

    assert (
        await world.service.resolve(user_id=user, project_id=world.project_id) is None
    )
    assert world.dao.reads.count("fetch_membership_row") == 2


async def test_adding_a_member_clears_the_absent_entry(fake_cache):
    world = _World()
    user = uuid4()
    assert (
        await world.service.resolve(user_id=user, project_id=world.project_id) is None
    )

    world.add(user)
    await world.service.set_member_role(
        organization_id=world.organization_id,
        user_id=user,
        role="editor",
        join_project_ids=[world.project_id],
    )

    membership = await world.service.resolve(user_id=user, project_id=world.project_id)
    assert membership is not None and membership.role == "editor"


async def test_is_member_uses_the_cache(fake_cache):
    world = _World()
    user = uuid4()
    world.add(user)

    assert await world.service.is_member(user_id=user, project_id=world.project_id)
    assert await world.service.is_member(user_id=user, project_id=world.project_id)
    assert world.dao.reads == ["fetch_membership_row"]


async def test_membership_invalidation_is_one_user_scan(fake_cache):
    """M1 clears a user's entries in every project of the organization with one scan
    of that user's keys (not one pattern call per project and namespace)."""

    world = _World(projects=3)
    user = uuid4()
    world.add(user)
    for project in world.projects:
        await world.service.resolve(user_id=user, project_id=project.project_id)
    assert len(fake_cache.names("resolve_membership")) == 3

    fake_cache.reset_calls()
    world.dao.write_results["remove_member"] = MembershipWriteResult(user_id=user)
    await world.service.remove_member(
        organization_id=world.organization_id, email="x@test.agenta.ai"
    )

    assert fake_cache.names("resolve_membership") == []
    assert len(fake_cache.scans) == 1


async def test_project_wide_invalidation_is_one_scan_not_per_member(fake_cache):
    world = _World()
    project_id = world.project_id
    members = 17_008
    for _ in range(members):
        user = str(uuid4())
        fake_cache.store[
            caching._pack(
                namespace="resolve_membership",
                key="membership",
                project_id=str(project_id),
                user_id=user,
            )
        ] = caching._serialize(CachedMembership(membership=None))

    await service_module.invalidate_access_caches(user_ids=[], project_ids=[project_id])

    # One pattern call per namespace for the project; never one call per member.
    assert len(fake_cache.scans) == len(service_module.ACCESS_CACHE_NAMESPACES)
    assert fake_cache.deletes == []
    assert fake_cache.names("resolve_membership") == []


async def test_resolve_with_cache_errors_reads_the_dao(monkeypatch):
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    FakeCache(fail=True).install(monkeypatch, service_module)
    world = _World()
    user = uuid4()
    world.add(user)

    assert await world.service.resolve(user_id=user, project_id=world.project_id)
    assert await world.service.resolve(user_id=user, project_id=world.project_id)
    assert world.dao.reads == ["fetch_membership_row", "fetch_membership_row"]
