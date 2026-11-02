"""The policy of a session that a channel turn creates (owner ruling 2026-10-26): private
to the agent's owner for a private agent, project-visible and ownerless otherwise."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

import oss.src.core.sharing.service as service_module
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    Visibility,
)
from oss.src.core.sharing.service import (
    channel_session_policy,
    created_session_access,
)
from oss.tests.pytest.utils.sharing import SharingWorld


pytestmark = pytest.mark.asyncio


def _private(owner) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)


@pytest.fixture
def world(monkeypatch) -> SharingWorld:
    world = SharingWorld()
    monkeypatch.setattr(service_module, "_sharing_service", world.service)
    return world


async def test_a_private_agent_gives_its_owner_a_private_channel_session(world):
    alice = world.add_member(uuid4())
    artifact_id = world.dao.add_agent(
        project_id=world.project_id, policy=_private(alice)
    )
    policy = await channel_session_policy(
        project_id=world.project_id, agent_artifact_id=artifact_id
    )
    assert policy == _private(alice)


async def test_a_project_agent_keeps_the_ownerless_project_policy(world):
    alice = world.add_member(uuid4())
    shared = world.dao.add_agent(
        project_id=world.project_id,
        policy=AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=alice),
    )
    no_row = world.dao.add_agent(project_id=world.project_id)
    for artifact_id in (shared, no_row, None):
        assert (
            await channel_session_policy(
                project_id=world.project_id, agent_artifact_id=artifact_id
            )
            == OWNERLESS_PROJECT_POLICY
        )


def test_the_channel_run_creates_its_session_with_its_policy():
    """The binding's own insert names its channel thread: its requested policy (the
    agent owner's private one) stays, and the entry records the channel session and its
    binding. Another creator's row names no thread, so it is no channel session."""

    owner, binding = uuid4(), uuid4()
    created = SimpleNamespace(has_channel_thread=True)
    assert created_session_access(
        created, requested=_private(owner), channel_binding_id=binding
    ) == (_private(owner), True, binding)
    plain = SimpleNamespace(has_channel_thread=False)
    assert created_session_access(
        plain, requested=_private(owner), channel_binding_id=None
    ) == (_private(owner), False, None)
    # A binding's run that names no thread creates no channel session.
    assert created_session_access(
        plain, requested=_private(owner), channel_binding_id=binding
    ) == (_private(owner), False, None)


async def test_a_failed_cache_write_adds_no_read(world, monkeypatch):
    """The admission read the agent's policy and the cache write failed: the channel
    session policy in the same request still makes no Postgres read and no Redis call."""
    from oss.src.core.access.prefetch import request_memo_scope

    alice = world.add_member(uuid4())
    artifact_id = world.dao.add_agent(
        project_id=world.project_id, policy=_private(alice)
    )
    redis_calls = []

    async def _get_cache(**kwargs):
        redis_calls.append("get")
        return None

    async def _set_cache(**kwargs):
        redis_calls.append("set")
        raise ConnectionError("redis is down")

    monkeypatch.setattr(service_module, "get_cache", _get_cache)
    monkeypatch.setattr(service_module, "set_cache", _set_cache)
    with request_memo_scope():
        await world.service.fetch_agent_policy_cached(
            project_id=world.project_id, artifact_id=artifact_id
        )
        reads, calls = list(world.dao.reads), list(redis_calls)
        policy = await channel_session_policy(
            project_id=world.project_id, agent_artifact_id=artifact_id
        )
    assert policy == _private(alice)
    assert world.dao.reads == reads
    assert redis_calls == calls
