"""Trace privacy (M9): the trace read scope, its cost, and the trace filter clause.

A reader's scope names the session ids of the project whose traces it may not read:
private sessions it does not own and is not granted, and tombstones of private sessions
it did not own. With the filter flag off, building a scope reads nothing.
"""

from uuid import uuid4

import pytest

import oss.src.core.memberships.service as memberships_module
import oss.src.core.sharing.service as sharing_module
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef, RunAuthority
from oss.src.core.sharing.dtos import AccessPolicy, SessionRole, Visibility
from oss.src.core.tracing.access import (
    MaintenanceOperation,
    SpanReadScope,
    TraceScopeError,
    TraceAccessService,
    require_scope,
)
from oss.src.dbs.postgres.tracing.utils import read_scope_clause
from oss.src.utils.env import env
from oss.tests.pytest.utils.cache import FakeCache
from oss.tests.pytest.utils.sharing import SharingWorld


@pytest.fixture
def fake_cache(monkeypatch) -> FakeCache:
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    return FakeCache().install(monkeypatch, sharing_module, memberships_module)


@pytest.fixture
def filter_on(monkeypatch):
    monkeypatch.setattr(env.agenta.api.tracing, "session_filter_enabled", True)


@pytest.fixture
def filter_off(monkeypatch):
    monkeypatch.setattr(env.agenta.api.tracing, "session_filter_enabled", False)


def _human(user_id):
    return PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)


def _private(owner):
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)


def _world():
    world = SharingWorld()
    alice = world.add_member(uuid4())
    bob = world.add_member(uuid4())
    return world, alice, bob


async def _scope(world, principal, authority=None):
    return await TraceAccessService(sharing_service=world.service).read_scope(
        authority=authority, principal=principal, project_id=world.project_id
    )


# --- the rule -------------------------------------------------------------------------


async def test_another_user_s_private_session_is_denied(fake_cache, filter_on):
    world, alice, bob = _world()
    private = world.add_session(policy=_private(alice), session_id="s-alice")
    world.add_session(
        policy=AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=alice),
        session_id="s-project",
    )

    bob_scope = await _scope(world, _human(bob))
    alice_scope = await _scope(world, _human(alice))

    assert bob_scope.denied_session_ids == (private.session_id,)
    assert bob_scope.restricted is True
    assert alice_scope.denied_session_ids == ()
    assert alice_scope.restricted is False


async def test_a_grant_opens_the_session_and_its_removal_closes_it(
    fake_cache, filter_on
):
    world, alice, bob = _world()
    state = world.add_session(policy=_private(alice), session_id="s-alice")
    world.add_grant(state=state, user_id=bob, role=SessionRole.VIEWER)

    assert (await _scope(world, _human(bob))).denied_session_ids == ()

    world.dao.grants.clear()
    await sharing_module.invalidate_sharing_caches(
        project_id=world.project_id, session_ids=["s-alice"], grant_user_ids=[bob]
    )
    assert (await _scope(world, _human(bob))).denied_session_ids == ("s-alice",)


async def test_a_grant_of_an_owner_who_left_does_not_open_the_session(
    fake_cache, filter_on
):
    world, alice, bob = _world()
    state = world.add_session(policy=_private(alice), session_id="s-alice")
    world.add_grant(state=state, user_id=bob, role=SessionRole.VIEWER)
    world.remove_member(alice)

    assert (await _scope(world, _human(bob))).denied_session_ids == ("s-alice",)


async def test_a_tombstone_is_readable_only_by_its_former_owner(fake_cache, filter_on):
    world, alice, bob = _world()
    world.dao.tombstones[(world.project_id, "s-deleted")] = alice

    assert (await _scope(world, _human(bob))).denied_session_ids == ("s-deleted",)
    assert (await _scope(world, _human(alice))).denied_session_ids == ()


async def test_an_api_key_reads_no_private_session(fake_cache, filter_on):
    world, alice, _ = _world()
    world.add_session(policy=_private(alice), session_id="s-alice")
    key = PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())

    assert (await _scope(world, key)).denied_session_ids == ("s-alice",)


async def test_the_run_authority_s_principal_wins(fake_cache, filter_on):
    world, alice, bob = _world()
    world.add_session(policy=_private(alice), session_id="s-alice")
    authority = RunAuthority(
        principal=_human(alice),
        organization_id=world.organization_id,
        project_id=world.project_id,
    )

    scope = await _scope(world, _human(bob), authority=authority)

    assert scope.principal == _human(alice)
    assert scope.denied_session_ids == ()


async def test_an_authority_of_another_project_fails(fake_cache, filter_on):
    world, alice, _ = _world()
    authority = RunAuthority(
        principal=_human(alice), organization_id=uuid4(), project_id=uuid4()
    )

    with pytest.raises(TraceScopeError):
        await _scope(world, _human(alice), authority=authority)


# --- fail closed ----------------------------------------------------------------------


async def test_a_scope_that_cannot_be_computed_fails(fake_cache, filter_on):
    world, _, bob = _world()

    async def broken(**_):
        raise ConnectionError("core database down")

    world.dao.list_unreadable_session_ids = broken

    with pytest.raises(TraceScopeError):
        await _scope(world, _human(bob))


def test_every_dao_read_needs_a_scope_of_its_project():
    project_id = uuid4()
    with pytest.raises(TraceScopeError):
        require_scope(None, project_id=project_id)
    with pytest.raises(TraceScopeError):
        require_scope(
            SpanReadScope(project_id=uuid4(), principal=_human(uuid4())),
            project_id=project_id,
        )
    with pytest.raises(TraceScopeError):
        require_scope(SpanReadScope(project_id=project_id), project_id=project_id)

    scope = TraceAccessService.maintenance(
        project_id=project_id, operation=MaintenanceOperation.INGEST
    )
    assert require_scope(scope, project_id=project_id) is scope


# --- cost -----------------------------------------------------------------------------


async def test_with_the_flag_off_a_scope_reads_nothing(fake_cache, filter_off):
    world, alice, bob = _world()
    world.add_session(policy=_private(alice), session_id="s-alice")
    reads_before = fake_cache.read_round_trips

    scope = await _scope(world, _human(bob))

    assert scope.restricted is False and scope.denied_session_ids == ()
    assert world.dao.reads == []
    assert fake_cache.read_round_trips == reads_before


async def test_with_the_flag_on_a_warm_scope_costs_one_statement_and_one_cache_read(
    fake_cache, filter_on
):
    world, alice, bob = _world()
    world.add_session(policy=_private(alice), session_id="s-alice")
    await _scope(world, _human(bob))  # warms the user grants entry
    world.dao.reads.clear()
    reads_before = fake_cache.read_round_trips

    await _scope(world, _human(bob))

    assert world.dao.reads == ["list_unreadable_session_ids"]
    assert fake_cache.read_round_trips - reads_before == 1


# --- the filter clause ----------------------------------------------------------------


def test_an_empty_scope_leaves_the_query_unchanged():
    scope = SpanReadScope(project_id=uuid4(), principal=_human(uuid4()))
    assert read_scope_clause(scope) is None


def test_a_deny_list_hides_whole_traces():
    scope = SpanReadScope(
        project_id=uuid4(),
        principal=_human(uuid4()),
        denied_session_ids=("s-1", "s-2"),
    )
    sql = str(read_scope_clause(scope).compile())

    assert "spans.trace_id NOT IN" in sql
    assert "denied_spans.session_id = ANY" in sql
