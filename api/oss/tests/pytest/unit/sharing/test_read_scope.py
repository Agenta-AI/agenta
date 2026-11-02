"""The principal-derived read scopes (`agent_read_scope`, `session_read_scope`)."""

from uuid import uuid4

from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.sharing.dtos import (
    AccessPolicy,
    AgentReadScope,
    SessionReadScope,
    SessionRole,
    Visibility,
)
from oss.tests.pytest.utils.sharing import SharingWorld


def _private(owner) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)


async def test_scope_owner_from_principal_not_creator():
    world = SharingWorld()
    alice = world.add_member(uuid4())
    alice_key = PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())
    installation = PrincipalRef(kind=PrincipalKind.INSTALLATION, id=uuid4())

    assert await world.service.agent_read_scope(
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=alice)
    ) == AgentReadScope(owner_user_id=alice)
    for principal in (alice_key, installation):
        assert await world.service.agent_read_scope(
            principal=principal
        ) == AgentReadScope(owner_user_id=None)
        assert await world.service.session_read_scope(
            project_id=world.project_id, principal=principal
        ) == SessionReadScope(
            owner_user_id=None, include_project=True, granted_stream_ids=[]
        )
    # Neither scope reads anything for a non-human principal.
    assert world.dao.reads == []


async def test_grants_filtered_by_owner_membership():
    world = SharingWorld()
    alice = world.add_member(uuid4())
    erin = world.add_member(uuid4())
    bob = world.add_member(uuid4())

    alice_sessions = [world.add_session(policy=_private(alice)) for _ in range(2)]
    erin_session = world.add_session(policy=_private(erin))
    for state in alice_sessions + [erin_session]:
        world.add_grant(state=state, user_id=bob, role=SessionRole.VIEWER)
    world.remove_member(erin)

    scope = await world.service.session_read_scope(
        project_id=world.project_id,
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=bob),
    )

    assert scope.owner_user_id == bob
    assert scope.include_project is True
    assert sorted(scope.granted_stream_ids) == sorted(
        s.stream_id for s in alice_sessions
    )
    # One membership read per distinct owner, not per grant.
    assert world.memberships_dao.reads == ["fetch_membership_row"] * 2
