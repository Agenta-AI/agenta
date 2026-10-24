"""Codex review of the M3 gate fix round (out-m3-latency-r1.log): items 2, 4, 5 and 8.

- 2: a sharing write clears what the request read (its later decisions read the new state).
- 4: the entry an insert writes for an owned session says it is no channel session, so the
  chat's session read makes no SQL read for it.
- 5: an owner's membership resolved for a decision is kept for the request's later ones.
- 8: the owner's session read carries the grants (the Share button counts them).
"""

from uuid import uuid4

import pytest

import oss.src.core.memberships.service as memberships_module
import oss.src.core.sharing.service as sharing_module
from oss.src.core.access import prefetch
from oss.src.core.access.context import _request_memo
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.sharing.dtos import AccessPolicy, SessionRole, Visibility
from oss.src.core.sharing.service import (
    cache_created_session_access,
    invalidate_sharing_caches,
    session_access_entry,
)
from oss.src.utils.env import env
from oss.tests.pytest.utils.cache import FakeCache
from oss.tests.pytest.utils.sharing import SharingWorld


@pytest.fixture
def fake_cache(monkeypatch) -> FakeCache:
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    return FakeCache().install(monkeypatch, sharing_module, memberships_module)


@pytest.fixture
def memo():
    token = _request_memo.set({})
    yield
    _request_memo.reset(token)


def _human(user_id):
    return PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)


async def test_a_created_owned_session_needs_no_sql_read_for_the_chat(fake_cache):
    world = SharingWorld()
    alice = world.add_member(uuid4())
    policy = AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=alice)
    state = world.add_session(policy=policy)
    await cache_created_session_access(
        project_id=world.project_id,
        session_id=state.session_id,
        stream_id=state.stream_id,
        policy=policy,
    )
    world.dao.reads.clear()

    sharing = await world.service.cached_session_sharing(
        project_id=world.project_id,
        principal=_human(alice),
        session_id=state.session_id,
        references_agent=True,
    )

    assert sharing is not None and sharing.my_role.value == "owner"
    assert world.dao.reads == []


async def test_the_owner_s_session_read_carries_the_grants(fake_cache):
    world = SharingWorld()
    alice = world.add_member(uuid4())
    bob = world.add_member(uuid4())
    state = world.add_session(
        policy=AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=alice)
    )
    world.add_grant(state=state, user_id=bob, role=SessionRole.VIEWER)

    owner_view = await world.service.cached_session_sharing(
        project_id=world.project_id,
        principal=_human(alice),
        session_id=state.session_id,
        references_agent=True,
    )
    bob_view = await world.service.cached_session_sharing(
        project_id=world.project_id,
        principal=_human(bob),
        session_id=state.session_id,
        references_agent=True,
    )

    assert [g.user_id for g in owner_view.grants] == [bob]
    assert bob_view.grants == []


async def test_an_owner_membership_is_read_once_per_request(fake_cache, memo):
    world = SharingWorld()
    alice = world.add_member(uuid4())
    before = fake_cache.read_round_trips
    assert await world.service._is_active(user_id=alice, project_id=world.project_id)
    assert await world.service._is_active(user_id=alice, project_id=world.project_id)
    assert fake_cache.read_round_trips - before == 1


async def test_a_sharing_write_clears_what_the_request_read(fake_cache, memo):
    world = SharingWorld()
    entry = session_access_entry(world.project_id, "s-1")
    prefetch.remember(entry, {"stale": True})
    assert prefetch.lookup(entry)[0] is True

    await invalidate_sharing_caches(project_id=world.project_id, session_ids=["s-1"])

    assert prefetch.lookup(entry)[0] is False
