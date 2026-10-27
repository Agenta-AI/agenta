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
    """The installation's own insert names a channel thread: its requested policy (the
    agent owner's private one) stays, and the entry says it is a channel session. No
    other creator inserts a row a thread names, so their row is no channel session."""

    owner = uuid4()
    created = SimpleNamespace(has_channel_thread=True)
    assert created_session_access(
        created, requested=_private(owner), by_installation=True
    ) == (_private(owner), True)
    plain = SimpleNamespace(has_channel_thread=False)
    assert created_session_access(
        plain, requested=_private(owner), by_installation=False
    ) == (_private(owner), False)
