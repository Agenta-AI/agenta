"""The sharing writes of `SharingService` (interfaces 3.1, technical design 4.6 and 4.7)
and the channel activation guard of `ChannelsService` (interfaces 3.8)."""

from typing import List, Optional
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

import oss.src.core.access.service as access_module
import oss.src.core.events.utils as events_utils
import oss.src.core.memberships.service as memberships_module
import oss.src.core.sharing.service as sharing_module
import oss.src.dbs.postgres.access.dao as principals_dao_module
from oss.src.core.access.dtos import (
    DecisionReason,
    PrincipalKind,
    PrincipalRecord,
    PrincipalRef,
    RunAuthority,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService
from oss.src.core.access.types import AccessDenied
from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelAgentEdit,
    ChannelAgentFlags,
    channel_agent_references,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.events.types import EventType
from oss.src.core.shared.dtos import Reference
from oss.src.core.sharing.dtos import (
    AccessPolicy,
    EffectiveRole,
    SessionGrantInput,
    SessionRole,
    SessionSharingChange,
    Visibility,
)
from oss.src.core.sharing.service import SharingService
from oss.src.core.sharing.types import (
    InvalidGrantee,
    InvalidTransferTarget,
    OwnerStillActive,
    SessionNotShareable,
    SharedItemNotFound,
    SharingConflict,
)
from oss.src.core.workflows.types import AgentReferenceUnresolved
from oss.src.dbs.postgres.access.dao import PrincipalsDAO
from oss.src.utils.env import env
from oss.tests.pytest.utils.cache import FakeCache
from oss.tests.pytest.utils.memberships import RecordingRbac
from oss.tests.pytest.utils.principals import make_envelope, make_request_access
from oss.tests.pytest.utils.sharing import SharingWorld


def _private(owner) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)


def _project(owner=None) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=owner)


def _human(user_id) -> PrincipalRef:
    return PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)


class _Recorder:
    def __init__(self) -> None:
        self.calls: List[dict] = []

    async def __call__(self, **kwargs) -> None:
        self.calls.append(kwargs)


class _People:
    """Alice, Bob, Carol, Dana are members; Erin left the project."""

    def __init__(self, monkeypatch) -> None:
        self.world = SharingWorld()
        self.alice = self.world.add_member(uuid4())
        self.bob = self.world.add_member(uuid4())
        self.carol = self.world.add_member(uuid4())
        self.dana = self.world.add_member(uuid4())
        self.erin = uuid4()  # never a member (a departed user)
        self.invalidations = _Recorder()
        self.events = _Recorder()
        monkeypatch.setattr(
            sharing_module, "invalidate_sharing_caches", self.invalidations
        )
        monkeypatch.setattr(sharing_module, "publish_sharing_event", self.events)

    @property
    def service(self) -> SharingService:
        return self.world.service

    @property
    def project_id(self) -> UUID:
        return self.world.project_id

    def access(self, user_id: UUID, *, kind: str = "human"):
        envelope = make_envelope(
            kind=kind,
            principal_id=user_id,
            project_id=self.world.project_id,
            organization_id=self.world.organization_id,
        )
        return make_request_access(
            envelope=envelope,
            credential_kind="bearer_session" if kind == "human" else "api_key",
        )

    def agent(self, policy: Optional[AccessPolicy]) -> UUID:
        return self.world.dao.add_agent(project_id=self.project_id, policy=policy)

    def stored(self, artifact_id: UUID) -> Optional[AccessPolicy]:
        return self.world.dao.agents.get((self.project_id, artifact_id))

    def write_kwargs(self, user_id: UUID, *, kind: str = "human") -> dict:
        return {
            "organization_id": self.world.organization_id,
            "project_id": self.project_id,
            "access": self.access(user_id, kind=kind),
        }


@pytest.fixture
def people(monkeypatch) -> _People:
    return _People(monkeypatch)


# -- agents ---------------------------------------------------------------------------


async def test_only_active_owner_changes_agent_visibility(people):
    artifact_id = people.agent(_project(people.alice))

    state = await people.service.set_agent_visibility(
        **people.write_kwargs(people.alice),
        artifact_id=artifact_id,
        visibility=Visibility.PRIVATE,
    )
    assert state.policy == _private(people.alice)
    assert state.my_role == EffectiveRole.OWNER
    assert people.stored(artifact_id) == _private(people.alice)

    # Bob cannot see a private agent: the same answer as an unknown one.
    with pytest.raises(SharedItemNotFound):
        await people.service.set_agent_visibility(
            **people.write_kwargs(people.bob),
            artifact_id=artifact_id,
            visibility=Visibility.PROJECT,
        )

    # On a project agent, Bob can read but not change it.
    shared = people.agent(_project(people.alice))
    with pytest.raises(AccessDenied) as denied:
        await people.service.set_agent_visibility(
            **people.write_kwargs(people.bob),
            artifact_id=shared,
            visibility=Visibility.PRIVATE,
        )
    assert denied.value.decision.reason == DecisionReason.RESOURCE_DENIED

    # Alice's API key is not Alice.
    with pytest.raises(AccessDenied):
        await people.service.set_agent_visibility(
            **people.write_kwargs(people.alice, kind="api_key"),
            artifact_id=shared,
            visibility=Visibility.PRIVATE,
        )

    # An ownerless agent (no row) has no owner who could change it.
    ownerless = people.agent(None)
    with pytest.raises(AccessDenied):
        await people.service.set_agent_visibility(
            **people.write_kwargs(people.alice),
            artifact_id=ownerless,
            visibility=Visibility.PRIVATE,
        )

    # A departed owner cannot change it either.
    departed = people.agent(_project(people.erin))
    with pytest.raises(AccessDenied):
        await people.service.set_agent_visibility(
            **people.write_kwargs(people.erin),
            artifact_id=departed,
            visibility=Visibility.PRIVATE,
        )
    assert people.stored(shared) == _project(people.alice)


async def test_transfer_needs_active_human_member(people):
    artifact_id = people.agent(_project(people.alice))

    for target in (uuid4(), people.erin, people.alice):  # api_key id, departed, owner
        with pytest.raises(InvalidTransferTarget):
            await people.service.transfer_agent(
                **people.write_kwargs(people.alice),
                artifact_id=artifact_id,
                new_owner_user_id=target,
            )

    state = await people.service.transfer_agent(
        **people.write_kwargs(people.alice),
        artifact_id=artifact_id,
        new_owner_user_id=people.bob,
    )
    assert state.policy == _project(people.bob)
    assert state.my_role == EffectiveRole.VIEWER  # Alice, who no longer owns it

    # Only the owner transfers.
    with pytest.raises(AccessDenied):
        await people.service.transfer_agent(
            **people.write_kwargs(people.alice),
            artifact_id=artifact_id,
            new_owner_user_id=people.carol,
        )

    # A private agent keeps its visibility through a transfer.
    private = people.agent(_private(people.alice))
    state = await people.service.transfer_agent(
        **people.write_kwargs(people.alice),
        artifact_id=private,
        new_owner_user_id=people.bob,
    )
    assert state.policy == _private(people.bob)


async def test_take_ownership_rules(people):
    # Private with a departed owner: hidden from Dana.
    private = people.agent(_private(people.erin))
    with pytest.raises(SharedItemNotFound):
        await people.service.take_agent_ownership(
            **people.write_kwargs(people.dana), artifact_id=private
        )

    # Project with an active owner.
    active = people.agent(_project(people.alice))
    with pytest.raises(OwnerStillActive):
        await people.service.take_agent_ownership(
            **people.write_kwargs(people.dana), artifact_id=active
        )

    # Project with a departed owner.
    departed = people.agent(_project(people.erin))
    before = await people.service.fetch_agent_sharing(
        project_id=people.project_id,
        principal=_human(people.dana),
        artifact_id=departed,
    )
    assert before.can_take_ownership is True
    assert before.owner_is_active is False
    assert before.my_role == EffectiveRole.VIEWER

    state = await people.service.take_agent_ownership(
        **people.write_kwargs(people.dana), artifact_id=departed
    )
    assert state.policy == _project(people.dana)
    assert state.my_role == EffectiveRole.OWNER
    assert state.can_take_ownership is False
    assert people.stored(departed) == _project(people.dana)

    # An ownerless agent (no row) can be taken too.
    ownerless = people.agent(None)
    state = await people.service.take_agent_ownership(
        **people.write_kwargs(people.carol), artifact_id=ownerless
    )
    assert state.policy == _project(people.carol)

    # Not by an API key.
    other = people.agent(_project(people.erin))
    with pytest.raises(AccessDenied):
        await people.service.take_agent_ownership(
            **people.write_kwargs(people.dana, kind="api_key"), artifact_id=other
        )


async def test_fetch_agent_sharing_roles(people):
    private = people.agent(_private(people.alice))
    state = await people.service.fetch_agent_sharing(
        project_id=people.project_id,
        principal=_human(people.alice),
        artifact_id=private,
    )
    assert state.my_role == EffectiveRole.OWNER
    assert state.owner_is_active is True
    assert state.can_take_ownership is False

    with pytest.raises(SharedItemNotFound):
        await people.service.fetch_agent_sharing(
            project_id=people.project_id,
            principal=_human(people.bob),
            artifact_id=private,
        )

    ownerless = people.agent(None)
    state = await people.service.fetch_agent_sharing(
        project_id=people.project_id,
        principal=_human(people.bob),
        artifact_id=ownerless,
    )
    assert state.policy == _project(None)
    assert state.my_role == EffectiveRole.VIEWER
    assert state.can_take_ownership is True

    # Only a human can take ownership.
    state = await people.service.fetch_agent_sharing(
        project_id=people.project_id,
        principal=PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4()),
        artifact_id=ownerless,
    )
    assert state.can_take_ownership is False


async def test_conflict_is_decided_again_once(people, monkeypatch):
    artifact_id = people.agent(_project(people.alice))
    dao = people.world.dao
    real = dao.set_agent_policy
    calls = []

    async def _conflict_then(times):
        async def _set(**kwargs):
            calls.append(kwargs)
            if len(calls) <= times:
                # Another writer committed the same state in between.
                raise SharingConflict(
                    current=dao.agents[(people.project_id, artifact_id)]
                )
            return await real(**kwargs)

        monkeypatch.setattr(dao, "set_agent_policy", _set)

    await _conflict_then(1)
    state = await people.service.set_agent_visibility(
        **people.write_kwargs(people.alice),
        artifact_id=artifact_id,
        visibility=Visibility.PRIVATE,
    )
    assert state.policy == _private(people.alice)
    assert len(calls) == 2
    assert calls[1]["expected"] == _project(people.alice)

    calls.clear()
    await _conflict_then(2)
    with pytest.raises(SharingConflict):
        await people.service.set_agent_visibility(
            **people.write_kwargs(people.alice),
            artifact_id=artifact_id,
            visibility=Visibility.PROJECT,
        )
    assert len(calls) == 2


async def test_conflict_redecides_on_the_current_policy(people, monkeypatch):
    """Two take-ownership calls: the second sees an active owner."""

    artifact_id = people.agent(_project(people.erin))
    dao = people.world.dao
    real = dao.set_agent_policy
    raced = []

    async def _set(**kwargs):
        if not raced:
            raced.append(True)
            # Carol took it first.
            dao.agents[(people.project_id, artifact_id)] = _project(people.carol)
            raise SharingConflict(current=_project(people.carol))
        return await real(**kwargs)

    monkeypatch.setattr(dao, "set_agent_policy", _set)
    with pytest.raises(OwnerStillActive):
        await people.service.take_agent_ownership(
            **people.write_kwargs(people.dana), artifact_id=artifact_id
        )
    assert people.stored(artifact_id) == _project(people.carol)


# -- sessions -------------------------------------------------------------------------


def _session(people, policy, **kwargs):
    return people.world.add_session(policy=policy, **kwargs)


def _invite(*grants) -> SessionSharingChange:
    return SessionSharingChange(
        upsert_grants=[SessionGrantInput(user_id=u, role=r) for u, r in grants]
    )


async def test_session_not_shareable_reasons(people):
    cases = [
        (_session(people, _project(None), is_channel=True), "channel"),
        (_session(people, _project(None)), "ownerless"),
        (_session(people, _project(people.alice), references_agent=False), "no_agent"),
    ]
    for state, reason in cases:
        with pytest.raises(SessionNotShareable) as error:
            await people.service.set_session_sharing(
                **people.write_kwargs(people.alice),
                session_id=state.session_id,
                change=_invite((people.bob, SessionRole.VIEWER)),
            )
        assert error.value.reason == reason

        sharing = await people.service.fetch_session_sharing(
            project_id=people.project_id,
            principal=_human(people.alice),
            session_id=state.session_id,
        )
        assert sharing.shareable is False
        assert sharing.not_shareable_reason == reason

    with pytest.raises(SharedItemNotFound):
        await people.service.set_session_sharing(
            **people.write_kwargs(people.alice),
            session_id="s-unknown",
            change=_invite((people.bob, SessionRole.VIEWER)),
        )


async def test_invalid_grantees(people):
    state = _session(people, _private(people.alice))
    api_key_id = uuid4()
    cases = [
        (_invite((people.alice, SessionRole.VIEWER)), people.alice, "owner"),
        (_invite((people.erin, SessionRole.VIEWER)), people.erin, "not_member"),
        (_invite((api_key_id, SessionRole.VIEWER)), api_key_id, "not_member"),
        (
            _invite(
                (people.bob, SessionRole.VIEWER), (people.bob, SessionRole.PARTICIPANT)
            ),
            people.bob,
            "duplicate",
        ),
        (
            SessionSharingChange(
                upsert_grants=[
                    SessionGrantInput(user_id=people.bob, role=SessionRole.VIEWER)
                ],
                remove_user_ids=[people.bob],
            ),
            people.bob,
            "duplicate",
        ),
    ]
    for change, user_id, reason in cases:
        with pytest.raises(InvalidGrantee) as error:
            await people.service.set_session_sharing(
                **people.write_kwargs(people.alice),
                session_id=state.session_id,
                change=change,
            )
        assert (error.value.user_id, error.value.reason) == (user_id, reason)
    assert people.world.dao.grants.get((people.project_id, state.stream_id)) is None

    # Only the owner shares; Bob, who holds a grant, cannot.
    people.world.add_grant(state=state, user_id=people.bob, role=SessionRole.VIEWER)
    with pytest.raises(AccessDenied):
        await people.service.set_session_sharing(
            **people.write_kwargs(people.bob),
            session_id=state.session_id,
            change=_invite((people.carol, SessionRole.VIEWER)),
        )
    # Carol cannot see it at all.
    with pytest.raises(SharedItemNotFound):
        await people.service.set_session_sharing(
            **people.write_kwargs(people.carol),
            session_id=state.session_id,
            change=_invite((people.dana, SessionRole.VIEWER)),
        )


async def test_only_me_removes_every_grant_and_sets_private(people):
    state = _session(people, _project(people.alice))
    people.world.add_grant(state=state, user_id=people.bob, role=SessionRole.VIEWER)
    people.world.add_grant(
        state=state, user_id=people.carol, role=SessionRole.PARTICIPANT
    )

    result = await people.service.set_session_sharing(
        **people.write_kwargs(people.alice),
        session_id=state.session_id,
        change=SessionSharingChange(
            visibility=Visibility.PRIVATE, remove_all_grants=True
        ),
    )

    assert result.policy == _private(people.alice)
    assert result.grants == []
    assert result.my_role == EffectiveRole.OWNER
    assert people.world.dao.grants[(people.project_id, state.stream_id)] == []
    assert set(people.invalidations.calls[0]["grant_user_ids"]) == {
        people.bob,
        people.carol,
    }


async def test_fetch_session_sharing_roles_and_grants(people):
    state = _session(people, _private(people.alice))
    people.world.add_grant(state=state, user_id=people.bob, role=SessionRole.VIEWER)
    people.world.add_grant(
        state=state, user_id=people.carol, role=SessionRole.PARTICIPANT
    )

    async def _fetch(principal):
        return await people.service.fetch_session_sharing(
            project_id=people.project_id,
            principal=principal,
            session_id=state.session_id,
        )

    owner = await _fetch(_human(people.alice))
    assert owner.my_role == EffectiveRole.OWNER
    assert {g.user_id for g in owner.grants} == {people.bob, people.carol}
    assert (owner.can_send, owner.shareable, owner.owner_is_active) == (
        True,
        True,
        True,
    )
    assert owner.not_shareable_reason is None

    viewer = await _fetch(_human(people.bob))
    assert (viewer.my_role, viewer.can_send, viewer.grants) == (
        EffectiveRole.VIEWER,
        False,
        [],
    )

    participant = await _fetch(_human(people.carol))
    assert (participant.my_role, participant.can_send, participant.grants) == (
        EffectiveRole.PARTICIPANT,
        True,
        [],
    )

    with pytest.raises(SharedItemNotFound):
        await _fetch(_human(people.dana))

    # A project session: project visibility gives Dana Participant: she reads and sends.
    shared = _session(people, _project(people.alice))
    dana = await people.service.fetch_session_sharing(
        project_id=people.project_id,
        principal=_human(people.dana),
        session_id=shared.session_id,
    )
    assert (dana.my_role, dana.can_send, dana.grants) == (
        EffectiveRole.PARTICIPANT,
        True,
        [],
    )
    # A Viewer grant on a project session: project access wins, he is a Participant.
    people.world.add_grant(state=shared, user_id=people.bob, role=SessionRole.VIEWER)
    bob = await people.service.fetch_session_sharing(
        project_id=people.project_id,
        principal=_human(people.bob),
        session_id=shared.session_id,
    )
    assert (bob.my_role, bob.can_send) == (EffectiveRole.PARTICIPANT, True)

    # An ownerless session that is no channel session: members send too.
    ownerless = _session(people, _project(None))
    human = await people.service.fetch_session_sharing(
        project_id=people.project_id,
        principal=_human(people.dana),
        session_id=ownerless.session_id,
    )
    assert human.can_send is True

    # A channel (Slack) session keeps its rule: humans read only (S3).
    channel_state = people.world.add_session(policy=_project(None), is_channel=True)
    in_channel = await people.service.fetch_session_sharing(
        project_id=people.project_id,
        principal=_human(people.dana),
        session_id=channel_state.session_id,
    )
    assert (in_channel.my_role, in_channel.can_send) == (EffectiveRole.VIEWER, False)
    key = await people.service.fetch_session_sharing(
        project_id=people.project_id,
        principal=PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4()),
        session_id=ownerless.session_id,
    )
    assert key.can_send is True


async def test_writes_invalidate_and_publish(people):
    artifact_id = people.agent(_project(people.alice))
    await people.service.set_agent_visibility(
        **people.write_kwargs(people.alice),
        artifact_id=artifact_id,
        visibility=Visibility.PRIVATE,
    )
    assert people.invalidations.calls == [
        {"project_id": people.project_id, "artifact_ids": [artifact_id]}
    ]
    (event,) = people.events.calls
    assert event["resource"].id == str(artifact_id)
    assert (event["before"], event["after"]) == (
        _project(people.alice),
        _private(people.alice),
    )
    assert event["organization_id"] == people.world.organization_id
    assert event["access"].principal == _human(people.alice)

    # A write that changes nothing writes nothing and publishes nothing.
    await people.service.set_agent_visibility(
        **people.write_kwargs(people.alice),
        artifact_id=artifact_id,
        visibility=Visibility.PRIVATE,
    )
    assert len(people.events.calls) == 1

    people.invalidations.calls.clear()
    people.events.calls.clear()
    state = _session(people, _private(people.alice))
    people.world.add_grant(state=state, user_id=people.dana, role=SessionRole.VIEWER)
    await people.service.set_session_sharing(
        **people.write_kwargs(people.alice),
        session_id=state.session_id,
        change=SessionSharingChange(
            visibility=Visibility.PROJECT,
            upsert_grants=[
                SessionGrantInput(user_id=people.bob, role=SessionRole.VIEWER),
                SessionGrantInput(user_id=people.carol, role=SessionRole.PARTICIPANT),
            ],
            remove_user_ids=[people.dana],
        ),
    )
    (invalidation,) = people.invalidations.calls
    assert invalidation["session_ids"] == [state.session_id]
    assert set(invalidation["grant_user_ids"]) == {
        people.bob,
        people.carol,
        people.dana,
    }
    (event,) = people.events.calls
    assert event["resource"].id == state.session_id
    assert (event["before"], event["after"]) == (
        _private(people.alice),
        _project(people.alice),
    )
    assert {(g.user_id, g.role) for g in event["grants_added"]} == {
        (people.bob, SessionRole.VIEWER),
        (people.carol, SessionRole.PARTICIPANT),
    }
    assert event["grants_removed"] == [people.dana]


async def test_publish_failure_does_not_undo_the_write(people, monkeypatch):
    # The real audit function, with a publish that fails.
    from oss.src.core.sharing.audit import publish_sharing_event

    monkeypatch.setattr(sharing_module, "publish_sharing_event", publish_sharing_event)
    monkeypatch.setattr(
        events_utils, "publish_event", AsyncMock(side_effect=RuntimeError("down"))
    )
    artifact_id = people.agent(_project(people.alice))

    state = await people.service.set_agent_visibility(
        **people.write_kwargs(people.alice),
        artifact_id=artifact_id,
        visibility=Visibility.PRIVATE,
    )

    assert state.policy == _private(people.alice)
    assert people.stored(artifact_id) == _private(people.alice)


async def test_audit_event_attributes(monkeypatch):
    from oss.src.core.access.dtos import ResourceKind, ResourceRef
    from oss.src.core.sharing.audit import publish_sharing_event

    publish = AsyncMock()
    monkeypatch.setattr(events_utils, "publish_event", publish)
    alice, bob = uuid4(), uuid4()
    envelope = make_envelope(principal_id=alice, run_id="run-1")
    access = make_request_access(envelope=envelope, credential_kind="run_credential")

    await publish_sharing_event(
        organization_id=envelope.authority.organization_id,
        project_id=envelope.authority.project_id,
        access=access,
        resource=ResourceRef(kind=ResourceKind.SESSION, id="s-1"),
        before=_private(alice),
        after=_project(alice),
        grants_added=[SessionGrantInput(user_id=bob, role=SessionRole.VIEWER)],
        grants_removed=[bob],
    )

    event = publish.await_args.kwargs["event"]
    assert event.event_type == EventType.SESSIONS_SHARING_CHANGED
    assert event.attributes == {
        "resource": {"kind": "session", "id": "s-1"},
        "before": {"visibility": "private", "owner_user_id": str(alice)},
        "after": {"visibility": "project", "owner_user_id": str(alice)},
        "grants_added": [{"user_id": str(bob), "role": "viewer"}],
        "grants_removed": [str(bob)],
        "principal": {"kind": "human", "id": str(alice)},
        "credential": "run_credential",
        "acting_user_id": str(alice),
        "run_id": "run-1",
    }
    assert publish.await_args.kwargs["project_id"] == envelope.authority.project_id

    publish.reset_mock()
    await publish_sharing_event(
        organization_id=envelope.authority.organization_id,
        project_id=envelope.authority.project_id,
        access=access,
        resource=ResourceRef(kind=ResourceKind.AGENT, id=str(uuid4())),
        before=None,
        after=_project(bob),
    )
    event = publish.await_args.kwargs["event"]
    assert event.event_type == EventType.AGENTS_SHARING_CHANGED
    assert event.attributes["before"] is None
    assert event.attributes["grants_added"] == []


async def test_make_private_invalidates_installation_principals(people, monkeypatch):
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    FakeCache().install(
        monkeypatch, principals_dao_module, access_module, memberships_module
    )
    binding_id = uuid4()
    installation = PrincipalRef(kind=PrincipalKind.INSTALLATION, id=binding_id)
    records = {
        installation: PrincipalRecord(
            principal=installation,
            project_id=people.project_id,
            acting_user_id=people.alice,
            is_active=True,
        )
    }
    principals = PrincipalsDAO(engine=None)

    async def _read(*, principal):
        return records.get(principal)

    monkeypatch.setattr(principals, "_read", _read)
    people.world.service._principals_dao = principals
    access_service = AccessService(
        memberships=people.world.service._memberships,
        rbac=RecordingRbac(),
        principals=principals,
        resource_policy=people.world.service,
    )
    authority = RunAuthority(
        principal=installation,
        organization_id=people.world.organization_id,
        project_id=people.project_id,
    )

    async def _decide():
        return await access_service.decide(
            authority=authority,
            principal=installation,
            action=Permission.RUN_SESSIONS,
            project_id=people.project_id,
        )

    assert (await _decide()).allowed  # the active record is now cached

    artifact_id = people.agent(_project(people.alice))
    people.world.dao.channel_agents[(people.project_id, artifact_id)] = [binding_id]
    # The DAO deactivates the binding in the same transaction as the policy.
    records[installation] = records[installation].model_copy(
        update={"is_active": False}
    )

    await people.service.set_agent_visibility(
        **people.write_kwargs(people.alice),
        artifact_id=artifact_id,
        visibility=Visibility.PRIVATE,
    )

    decision = await _decide()
    assert decision.allowed is False
    assert decision.reason == DecisionReason.PRINCIPAL_INACTIVE


# -- channel activation ---------------------------------------------------------------


class _Workflows:
    """`resolve_agent_artifact_id` over a dict: reference key -> artifact id."""

    def __init__(self, resolved=None, error=None):
        self.resolved = resolved
        self.error = error
        self.calls = []

    async def resolve_agent_artifact_id(self, *, project_id, references):
        self.calls.append(references)
        if self.error is not None:
            raise self.error
        return self.resolved


def _channels(world: SharingWorld, workflows: _Workflows):
    """A `ChannelsService` whose DAO applies the guard like the Postgres DAO: a
    private agent named by `guard_artifact_id` is refused before the write."""

    dao = MagicMock()
    dao.writes = []
    dao.fetch_connection = AsyncMock(return_value=MagicMock())

    def _guard(project_id, guard_artifact_id):
        dao.writes.append(guard_artifact_id)
        if guard_artifact_id is None:
            return
        policy = world.dao.agents.get((project_id, guard_artifact_id))
        if policy is not None and policy.visibility == Visibility.PRIVATE:
            raise SharedItemNotFound()

    async def _create(*, project_id, user_id, agent, guard_artifact_id=None):
        _guard(project_id, guard_artifact_id)
        return ChannelAgent(
            id=uuid4(),
            slug=agent.slug,
            connection_id=agent.connection_id,
            data=agent.data,
            flags=agent.flags,
        )

    async def _edit(*, project_id, user_id, agent, guard_artifact_id=None):
        _guard(project_id, guard_artifact_id)
        return MagicMock()

    dao.create_agent = AsyncMock(side_effect=_create)
    dao.edit_agent = AsyncMock(side_effect=_edit)
    return (
        ChannelsService(
            channels_dao=dao,
            adapter_registry=MagicMock(),
            workflows_service=workflows,
        ),
        dao,
    )


def _create(references, *, is_active=True) -> ChannelAgentCreate:
    return ChannelAgentCreate(
        connection_id=uuid4(),
        slug="bot",
        data=ChannelAgentData(references=references),
        flags=ChannelAgentFlags(is_active=is_active),
    )


async def test_activate_private_agent_rejected(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.channels.service.invalidate_principals_after_write",
        AsyncMock(),
    )
    world = SharingWorld()
    alice = world.add_member(uuid4())
    private = world.dao.add_agent(project_id=world.project_id, policy=_private(alice))
    shared = world.dao.add_agent(project_id=world.project_id, policy=_project(alice))
    references = {"workflow": Reference(id=private)}

    service, dao = _channels(world, _Workflows(resolved=private))
    with pytest.raises(SharedItemNotFound):
        await service.create_agent(
            project_id=world.project_id, user_id=alice, agent=_create(references)
        )
    assert dao.writes == [private]

    # An inactive binding is not an activation: no guard, written.
    dao.writes.clear()
    await service.create_agent(
        project_id=world.project_id,
        user_id=alice,
        agent=_create(references, is_active=False),
    )
    assert dao.writes == [None]

    # A project agent is guarded and written.
    service, dao = _channels(world, _Workflows(resolved=shared))
    await service.create_agent(
        project_id=world.project_id,
        user_id=alice,
        agent=_create({"workflow": Reference(id=shared)}),
    )
    assert dao.writes == [shared]

    # Edit: the result of the edit decides. Reactivating a binding of a private agent
    # is refused.
    service, dao = _channels(world, _Workflows(resolved=private))
    existing = ChannelAgent(
        id=uuid4(),
        slug="bot",
        connection_id=uuid4(),
        data=ChannelAgentData(references=references),
        flags=ChannelAgentFlags(is_active=False),
    )
    dao.fetch_agent = AsyncMock(return_value=existing)
    with pytest.raises(SharedItemNotFound):
        await service.edit_agent(
            project_id=world.project_id,
            user_id=alice,
            agent=ChannelAgentEdit(
                id=existing.id, flags=ChannelAgentFlags(is_active=True)
            ),
        )
    # Keeping it inactive is fine.
    await service.edit_agent(
        project_id=world.project_id,
        user_id=alice,
        agent=ChannelAgentEdit(id=existing.id, name="renamed"),
    )
    assert dao.writes == [private, None]


def _stored_binding(references, *, is_active, is_default=False) -> ChannelAgent:
    return ChannelAgent(
        id=uuid4(),
        slug="bot",
        connection_id=uuid4(),
        data=ChannelAgentData(references=references),
        flags=ChannelAgentFlags(is_active=is_active, is_default=is_default),
    )


async def test_every_binding_write_left_active_is_guarded():
    """A binding write that sends no references (only flags, or nothing) is guarded
    with the stored references when its result is active, and it writes exactly the
    references it guarded. No write path skips the guard."""

    world = SharingWorld()
    alice = world.add_member(uuid4())
    private = world.dao.add_agent(project_id=world.project_id, policy=_private(alice))
    shared = world.dao.add_agent(project_id=world.project_id, policy=_project(alice))

    # A flags-only reactivation of a private agent's binding is refused.
    service, dao = _channels(world, _Workflows(resolved=private))
    stored = _stored_binding({"workflow": Reference(id=private)}, is_active=False)
    dao.fetch_agent = AsyncMock(return_value=stored)
    for edit in (
        ChannelAgentEdit(id=stored.id, flags=ChannelAgentFlags(is_active=True)),
        ChannelAgentEdit(id=stored.id, name="renamed", flags=ChannelAgentFlags()),
    ):
        with pytest.raises(SharedItemNotFound):
            await service._edit_agent_row(
                project_id=world.project_id, user_id=alice, agent=edit
            )
    assert dao.writes == [private, private]

    # An edit that sends no flags keeps the stored (inactive) flags: not guarded.
    dao.writes.clear()
    await service._edit_agent_row(
        project_id=world.project_id,
        user_id=alice,
        agent=ChannelAgentEdit(id=stored.id, name="renamed"),
    )
    assert dao.writes == [None]

    # A project agent's flags-only reactivation is guarded and written, with the
    # stored references in the write.
    service, dao = _channels(world, _Workflows(resolved=shared))
    stored = _stored_binding({"workflow": Reference(id=shared)}, is_active=False)
    dao.fetch_agent = AsyncMock(return_value=stored)
    await service._edit_agent_row(
        project_id=world.project_id,
        user_id=alice,
        agent=ChannelAgentEdit(id=stored.id, flags=ChannelAgentFlags(is_active=True)),
    )
    assert dao.writes == [shared]
    written = dao.edit_agent.await_args.kwargs["agent"]
    assert written.data.references == {"workflow": Reference(id=shared)}
    assert written.flags.is_active is True

    # An unknown binding writes nothing.
    service, dao = _channels(world, _Workflows(resolved=shared))
    dao.fetch_agent = AsyncMock(return_value=None)
    assert (
        await service._edit_agent_row(
            project_id=world.project_id,
            user_id=alice,
            agent=ChannelAgentEdit(id=uuid4(), flags=ChannelAgentFlags()),
        )
        is None
    )
    assert dao.writes == []


async def test_set_agent_default_guards_the_active_binding():
    """`set_agent_default` writes the promoted binding with its stored flags: an
    active one is guarded, an inactive one (a private agent's) stays inactive."""

    world = SharingWorld()
    alice = world.add_member(uuid4())
    private = world.dao.add_agent(project_id=world.project_id, policy=_private(alice))
    shared = world.dao.add_agent(project_id=world.project_id, policy=_project(alice))

    service, dao = _channels(world, _Workflows(resolved=shared))
    stored = _stored_binding({"workflow": Reference(id=shared)}, is_active=True)
    dao.fetch_agent = AsyncMock(return_value=stored)
    dao.fetch_default_agent = AsyncMock(return_value=None)
    await service.set_agent_default(
        project_id=world.project_id, user_id=alice, agent_id=stored.id
    )
    assert dao.writes == [shared]

    service, dao = _channels(world, _Workflows(resolved=private))
    stored = _stored_binding({"workflow": Reference(id=private)}, is_active=False)
    dao.fetch_agent = AsyncMock(return_value=stored)
    dao.fetch_default_agent = AsyncMock(return_value=None)
    await service.set_agent_default(
        project_id=world.project_id, user_id=alice, agent_id=stored.id
    )
    assert dao.writes == [None]
    assert dao.edit_agent.await_args.kwargs["agent"].flags.is_active is False


async def test_unresolved_or_missing_agent_reference_is_refused():
    world = SharingWorld()
    for workflows in (
        _Workflows(error=AgentReferenceUnresolved()),
        _Workflows(resolved=None),  # no agent key at all
    ):
        service, dao = _channels(world, workflows)
        with pytest.raises(SharedItemNotFound):
            await service.create_agent(
                project_id=world.project_id,
                user_id=uuid4(),
                agent=_create({"workflow": Reference(slug="gone")}),
            )
        assert dao.writes == []


async def test_activation_without_workflows_service_fails_closed():
    from oss.src.core.channels.types import ChannelsError

    service = ChannelsService(channels_dao=MagicMock(), adapter_registry=MagicMock())
    service.channels_dao.fetch_connection = AsyncMock(return_value=MagicMock())
    with pytest.raises(ChannelsError):
        await service.create_agent(
            project_id=uuid4(),
            user_id=uuid4(),
            agent=_create({"workflow": Reference(id=uuid4())}),
        )


def test_channel_references_cover_both_families():
    variant, revision = uuid4(), uuid4()
    workflow = channel_agent_references(
        {"workflow_variant": Reference(id=variant), "workflow": Reference(slug="w")}
    )
    assert {(r.key, r.id, r.slug) for r in workflow} == {
        ("workflow_variant", variant, None),
        ("workflow", None, "w"),
    }
    application = channel_agent_references(
        {"application_revision": Reference(id=revision, version="3")}
    )
    assert [(r.key, r.id, r.version) for r in application] == [
        ("application_revision", revision, "3")
    ]
    # A binding that names no agent key names no agent: it is refused, never read as
    # "no agent".
    with pytest.raises(SharedItemNotFound):
        channel_agent_references({})


async def test_channel_references_reach_the_resolver():
    world = SharingWorld()
    artifact_id = world.dao.add_agent(project_id=world.project_id)
    revision = uuid4()
    workflows = _Workflows(resolved=artifact_id)
    service, dao = _channels(world, workflows)

    await service.create_agent(
        project_id=world.project_id,
        user_id=uuid4(),
        agent=_create({"application_revision": Reference(id=revision)}),
    )

    (references,) = workflows.calls
    assert [(r.key, r.id) for r in references] == [("application_revision", revision)]
    assert dao.writes == [artifact_id]


@pytest.mark.parametrize(
    "route", ["create_channel_agent", "edit_channel_agent", "set_channel_agent_default"]
)
async def test_channel_routes_answer_a_private_agent_as_not_found(route):
    from unittest.mock import patch

    from fastapi import FastAPI, HTTPException, Request

    from oss.src.apis.fastapi.channels.models import (
        ChannelAgentCreateRequest,
        ChannelAgentEditRequest,
    )
    from oss.src.apis.fastapi.channels.router import ChannelsRouter
    from oss.src.apis.fastapi.sharing.utils import NOT_FOUND_ERROR

    service = AsyncMock()
    for method in ("create_agent", "edit_agent", "set_agent_default"):
        getattr(service, method).side_effect = SharedItemNotFound()
    router = ChannelsRouter(
        channels_service=service,
        adapter_registry=AsyncMock(keys=lambda: ["slack"]),
    )
    request = Request(
        {"type": "http", "method": "POST", "path": "/", "headers": [], "app": FastAPI()}
    )
    request.state.project_id = str(uuid4())
    request.state.user_id = str(uuid4())
    agent_id = uuid4()
    calls = {
        "create_channel_agent": lambda: router.create_channel_agent(
            request,
            body=ChannelAgentCreateRequest(
                agent=_create({"workflow": Reference(id=uuid4())})
            ),
        ),
        "edit_channel_agent": lambda: router.edit_channel_agent(
            request,
            agent_id=agent_id,
            body=ChannelAgentEditRequest(agent=ChannelAgentEdit(id=agent_id)),
        ),
        "set_channel_agent_default": lambda: router.set_channel_agent_default(
            request, agent_id=agent_id
        ),
    }

    with patch(
        "oss.src.apis.fastapi.channels.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        with pytest.raises(HTTPException) as error:
            await calls[route]()

    assert error.value.status_code == 404
    assert error.value.detail == NOT_FOUND_ERROR.model_dump(exclude_none=True)
