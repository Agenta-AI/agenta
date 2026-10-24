"""The policy caches of `SharingService` (`sharing_agent_access`,
`sharing_session_access`, `sharing_user_grants`) and `invalidate_sharing_caches`.

`FakeCache` keeps the bytes of the real serializer, so a hit here is a hit in Redis.
"""

from datetime import datetime, timezone
from uuid import uuid4

import orjson
import pytest

import oss.src.core.memberships.service as memberships_module
import oss.src.core.sharing.service as sharing_module
from oss.src.core.access.dtos import (
    DecisionReason,
    PrincipalKind,
    PrincipalRef,
    ResourceKind,
    ResourceRef,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    CachedAgentAccess,
    CachedSessionAccess,
    CachedUserGrants,
    SessionGrant,
    SessionRole,
    UserSessionGrant,
    Visibility,
)
from oss.src.core.sharing.service import invalidate_sharing_caches
from oss.src.utils import caching
from oss.src.utils.env import env
from oss.tests.pytest.utils.cache import FakeCache
from oss.tests.pytest.utils.sharing import SharingWorld


ALICE = uuid4()
BOB = uuid4()


@pytest.fixture
def fake_cache(monkeypatch) -> FakeCache:
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    return FakeCache().install(monkeypatch, sharing_module, memberships_module)


@pytest.fixture
def warnings(monkeypatch):
    recorded = []

    class _Log:
        def warning(self, event, **fields):
            recorded.append((event, fields))

        def info(self, *args, **kwargs):
            pass

    monkeypatch.setattr(sharing_module, "log", _Log())
    return recorded


def _private(owner) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)


def _human(user_id) -> PrincipalRef:
    return PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)


def _world() -> SharingWorld:
    world = SharingWorld()
    world.add_member(ALICE)
    world.add_member(BOB)
    return world


async def _session(world, principal, session_id, action=Permission.VIEW_SESSIONS):
    return await world.service.evaluate(
        principal=principal,
        action=action,
        project_id=world.project_id,
        resource=ResourceRef(kind=ResourceKind.SESSION, id=session_id),
    )


async def _agent(world, principal, artifact_id):
    return await world.service.evaluate(
        principal=principal,
        action=Permission.VIEW_WORKFLOWS,
        project_id=world.project_id,
        resource=ResourceRef(kind=ResourceKind.AGENT, id=str(artifact_id)),
    )


async def test_warm_agent_and_session_decisions_read_no_postgres(fake_cache):
    world = _world()
    state = world.add_session(policy=_private(ALICE))
    world.add_grant(state=state, user_id=BOB, role=SessionRole.VIEWER)
    artifact_id = world.dao.add_agent(
        project_id=world.project_id, policy=_private(ALICE)
    )

    for _ in range(3):
        assert await _session(world, _human(BOB), state.session_id) is None
        assert await _agent(world, _human(ALICE), artifact_id) is None

    assert world.dao.reads == [
        "fetch_session_policy",
        "list_session_grants",
        "fetch_agent_policy",
    ]
    # The owner's membership is read once and cached too.
    assert world.memberships_dao.reads == ["fetch_membership_row"]


async def test_agent_without_row_is_cached(fake_cache):
    world = _world()
    artifact_id = world.dao.add_agent(project_id=world.project_id)

    first = await world.service.fetch_agent_policy_cached(
        project_id=world.project_id, artifact_id=artifact_id
    )
    second = await world.service.fetch_agent_policy_cached(
        project_id=world.project_id, artifact_id=artifact_id
    )

    assert first == second == CachedAgentAccess(policy=None)
    assert world.dao.reads == ["fetch_agent_policy"]
    assert len(fake_cache.names("sharing_agent_access")) == 1


async def test_missing_session_is_not_cached(fake_cache):
    world = _world()

    for _ in range(2):
        assert await _session(world, _human(BOB), "s-missing") is None

    assert world.dao.reads == ["fetch_session_policy"] * 2
    assert fake_cache.names("sharing_session_access") == []


async def test_legacy_session_is_cached_with_its_assigned_policy(fake_cache):
    world = _world()
    state = world.add_session(policy=_private(ALICE), legacy=True)

    assert await _session(world, _human(BOB), state.session_id) == (
        DecisionReason.RESOURCE_DENIED
    )
    assert await _session(world, _human(ALICE), state.session_id) is None

    assert world.dao.reads == [
        "fetch_session_policy",
        "assign_legacy_session_access",
        "list_session_grants",
    ]
    [name] = fake_cache.names("sharing_session_access")
    entry = caching._deserialize(fake_cache.store[name], model=CachedSessionAccess)
    assert entry.policy == _private(ALICE)


async def test_user_grants_cached_and_invalidated(fake_cache):
    world = _world()
    state = world.add_session(policy=_private(ALICE))
    world.add_grant(state=state, user_id=BOB, role=SessionRole.VIEWER)

    async def scope():
        return await world.service.session_read_scope(
            project_id=world.project_id, principal=_human(BOB)
        )

    assert (await scope()).granted_stream_ids == [state.stream_id]
    assert (await scope()).granted_stream_ids == [state.stream_id]
    assert world.dao.reads == ["list_user_grants"]

    await invalidate_sharing_caches(project_id=world.project_id, grant_user_ids=[BOB])
    await scope()
    assert world.dao.reads == ["list_user_grants"] * 2


async def test_empty_user_grants_are_cached(fake_cache):
    world = _world()
    for _ in range(2):
        scope = await world.service.session_read_scope(
            project_id=world.project_id, principal=_human(BOB)
        )
        assert scope.granted_stream_ids == []
    assert world.dao.reads == ["list_user_grants"]


async def test_invalidation_clears_agent_and_session_entries(fake_cache):
    world = _world()
    state = world.add_session(policy=_private(ALICE))
    artifact_id = world.dao.add_agent(
        project_id=world.project_id, policy=_private(ALICE)
    )
    await _session(world, _human(ALICE), state.session_id)
    await _agent(world, _human(ALICE), artifact_id)
    assert fake_cache.names("sharing_session_access")
    assert fake_cache.names("sharing_agent_access")

    await invalidate_sharing_caches(
        project_id=world.project_id,
        artifact_ids=[artifact_id],
        session_ids=[state.session_id],
    )

    assert fake_cache.names("sharing_session_access") == []
    assert fake_cache.names("sharing_agent_access") == []


@pytest.mark.parametrize("failure", ["raises", "returns_none"])
async def test_invalidation_failure_is_logged_not_raised(
    fake_cache, warnings, monkeypatch, failure
):
    async def _failing(**kwargs):
        if failure == "raises":
            raise ConnectionError("redis down")
        return None

    monkeypatch.setattr(sharing_module, "invalidate_cache", _failing)

    await invalidate_sharing_caches(project_id=uuid4(), session_ids=["s-1"])

    assert [event for event, _ in warnings] == ["[sharing] cache invalidation failed"]


async def test_cache_errors_read_the_dao_and_still_deny(fake_cache, monkeypatch):
    async def _raising(*args, **kwargs):
        raise ConnectionError("redis down")

    monkeypatch.setattr(sharing_module, "get_cache", _raising)
    monkeypatch.setattr(sharing_module, "set_cache", _raising)

    world = _world()
    state = world.add_session(policy=_private(ALICE))
    artifact_id = world.dao.add_agent(
        project_id=world.project_id, policy=_private(ALICE)
    )

    for _ in range(2):
        assert await _session(world, _human(BOB), state.session_id) == (
            DecisionReason.RESOURCE_DENIED
        )
        assert await _agent(world, _human(BOB), artifact_id) == (
            DecisionReason.RESOURCE_DENIED
        )

    assert (
        world.dao.reads
        == [
            "fetch_session_policy",
            "list_session_grants",
            "fetch_agent_policy",
        ]
        * 2
    )


@pytest.mark.parametrize(
    "entry",
    [
        CachedAgentAccess(policy=None),
        CachedAgentAccess(policy=OWNERLESS_PROJECT_POLICY),
        CachedAgentAccess(policy=_private(ALICE)),
        CachedSessionAccess(
            stream_id=uuid4(),
            policy=_private(ALICE),
            grants=[
                SessionGrant(
                    stream_id=uuid4(),
                    user_id=BOB,
                    role=SessionRole.VIEWER,
                    created_at=None,
                    created_by_id=None,
                ),
                SessionGrant(
                    stream_id=uuid4(),
                    user_id=uuid4(),
                    role=SessionRole.PARTICIPANT,
                    created_at=datetime(2026, 10, 23, tzinfo=timezone.utc),
                    created_by_id=ALICE,
                ),
            ],
        ),
        CachedSessionAccess(
            stream_id=uuid4(), policy=OWNERLESS_PROJECT_POLICY, grants=[]
        ),
        CachedUserGrants(
            grants=[
                UserSessionGrant(stream_id=uuid4(), owner_user_id=None),
                UserSessionGrant(stream_id=uuid4(), owner_user_id=ALICE),
            ]
        ),
        CachedUserGrants(grants=[]),
    ],
)
def test_cache_entries_round_trip_the_real_serializer(entry):
    raw = caching._serialize(entry)
    assert type(entry).model_validate(orjson.loads(raw)) == entry
    assert caching._deserialize(raw, model=type(entry)) == entry
