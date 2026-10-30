"""The resource rules A1, A2, S1 to S4 (`SharingService.evaluate`, interfaces 3.1)."""

from contextlib import contextmanager
from uuid import uuid4

import pytest

from oss.src.core.access.dtos import (
    DecisionReason,
    PrincipalKind,
    PrincipalRecord,
    PrincipalRef,
    ResourceKind,
    ResourceRef,
    RoleRequirement,
    RunContext,
    RunOrigin,
)
from oss.src.core.access.context import get_request_memo
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.prefetch import request_memo_scope
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    SessionRole,
    Visibility,
)
from oss.src.core.access.service import AccessService
from oss.tests.pytest.utils.memberships import RecordingRbac
from oss.tests.pytest.utils.principals import InMemoryPrincipalsDAO
from oss.tests.pytest.utils.sharing import AllowAllResourcePolicy, SharingWorld


DENIED = DecisionReason.RESOURCE_DENIED
READ_ACTIONS = (Permission.VIEW_SESSIONS, Permission.USE_MOUNTS, Permission.VIEW_MOUNTS)


def _human(user_id) -> PrincipalRef:
    return PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)


def _api_key() -> PrincipalRef:
    return PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())


def _installation() -> PrincipalRef:
    return PrincipalRef(kind=PrincipalKind.INSTALLATION, id=uuid4())


@contextmanager
def _bound_by(principal: PrincipalRef, creator):
    """The request memo holds the binding's principal record, as `decide` leaves it
    before the resource rules run: its acting user is the binding's creator."""
    with request_memo_scope():
        get_request_memo()[("principal", principal)] = PrincipalRecord(
            principal=principal, acting_user_id=creator, is_active=True
        )
        yield


def _private(owner) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)


def _project(owner=None) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=owner)


class _People:
    def __init__(self) -> None:
        self.world = SharingWorld()
        self.alice = self.world.add_member(uuid4())
        self.bob = self.world.add_member(uuid4())
        self.carol = self.world.add_member(uuid4())
        self.dana = self.world.add_member(uuid4())

    async def agent(
        self, principal, artifact_id, action=Permission.VIEW_WORKFLOWS, context=None
    ):
        return await self.world.service.evaluate(
            principal=principal,
            action=action,
            project_id=self.world.project_id,
            resource=ResourceRef(kind=ResourceKind.AGENT, id=str(artifact_id)),
            context=context,
        )

    async def session(self, principal, state, action, context=None):
        return await self.world.service.evaluate(
            principal=principal,
            action=action,
            project_id=self.world.project_id,
            resource=ResourceRef(kind=ResourceKind.SESSION, id=state.session_id),
            context=context,
        )

    def shared_session(self, policy):
        """A session with a viewer grant for Bob and a participant grant for Carol."""

        state = self.world.add_session(policy=policy)
        self.world.add_grant(state=state, user_id=self.bob, role=SessionRole.VIEWER)
        self.world.add_grant(
            state=state, user_id=self.carol, role=SessionRole.PARTICIPANT
        )
        return state


@pytest.fixture
def people() -> _People:
    return _People()


# -- agents ---------------------------------------------------------------------------


async def test_a1_agent_without_row_or_project_allows_everyone(people):
    world = people.world
    no_row = world.dao.add_agent(project_id=world.project_id)
    project = world.dao.add_agent(
        project_id=world.project_id, policy=_project(people.alice)
    )
    for artifact_id in (no_row, project):
        for principal in (_human(people.bob), _api_key(), _installation()):
            for action in (Permission.VIEW_WORKFLOWS, Permission.RUN_WORKFLOWS):
                assert await people.agent(principal, artifact_id, action) is None


async def test_a2_private_agent_only_human_owner(people):
    world = people.world
    artifact_id = world.dao.add_agent(
        project_id=world.project_id, policy=_private(people.alice)
    )

    assert await people.agent(_human(people.alice), artifact_id) is None
    assert await people.agent(_human(people.bob), artifact_id) == DENIED
    # Alice's API key is an api_key principal, never Alice.
    alice_key = PrincipalRef(kind=PrincipalKind.API_KEY, id=people.alice)
    assert await people.agent(alice_key, artifact_id) == DENIED
    assert await people.agent(_api_key(), artifact_id) == DENIED
    assert await people.agent(_installation(), artifact_id) == DENIED


@pytest.mark.parametrize(
    "origin, allowed",
    [
        (RunOrigin.INSTALLATION, True),
        (RunOrigin.CHILD, False),
        (RunOrigin.WEB, False),
        (None, False),
    ],
)
async def test_a2_a_private_agent_answers_its_channel(people, origin, allowed):
    """A channel binding that the agent's owner created runs the private agent on its
    own channel turn (a resumed or queued turn keeps that origin). A child run of the
    turn, the binding without the turn's run context, a binding someone else created,
    and a binding whose record this decision did not read, do not."""
    world = people.world
    artifact_id = world.dao.add_agent(
        project_id=world.project_id, policy=_private(people.alice)
    )
    context = None if origin is None else RunContext(origin=origin)
    binding = _installation()
    with _bound_by(binding, people.alice):
        answer = await people.agent(
            binding, artifact_id, Permission.RUN_WORKFLOWS, context
        )
    assert (answer is None) is allowed

    channel_turn = RunContext(origin=RunOrigin.INSTALLATION)
    # Only the run: the owner's binding does not read or edit the private agent.
    with _bound_by(binding, people.alice):
        for action in (Permission.VIEW_WORKFLOWS, Permission.EDIT_WORKFLOWS):
            assert (
                await people.agent(binding, artifact_id, action, channel_turn) == DENIED
            )
    with _bound_by(binding, people.bob):
        assert (
            await people.agent(
                binding, artifact_id, Permission.RUN_WORKFLOWS, channel_turn
            )
            == DENIED
        )
    assert (
        await people.agent(binding, artifact_id, Permission.RUN_WORKFLOWS, channel_turn)
        == DENIED
    )
    # A person never borrows the origin.
    assert (
        await people.agent(
            _human(people.bob),
            artifact_id,
            Permission.RUN_WORKFLOWS,
            channel_turn,
        )
        == DENIED
    )


# -- sessions -------------------------------------------------------------------------


async def test_s1_private_session_readers(people):
    state = people.shared_session(_private(people.alice))
    for action in READ_ACTIONS:
        for user in (people.alice, people.bob, people.carol):
            assert await people.session(_human(user), state, action) is None
        assert await people.session(_human(people.dana), state, action) == DENIED
        assert await people.session(_api_key(), state, action) == DENIED


async def test_s1_project_session_readable_by_everyone(people):
    state = people.shared_session(_project(people.alice))
    for action in READ_ACTIONS:
        for principal in (_human(people.dana), _api_key(), _installation()):
            assert await people.session(principal, state, action) is None


async def test_s2_run_sessions(people):
    run = Permission.RUN_SESSIONS
    private = people.shared_session(_private(people.alice))
    assert await people.session(_human(people.alice), private, run) is None
    assert await people.session(_human(people.carol), private, run) is None
    assert await people.session(_human(people.bob), private, run) == DENIED
    assert await people.session(_human(people.dana), private, run) == DENIED
    # A private session runs only for its human owner and participants.
    assert await people.session(_api_key(), private, run) == DENIED

    # Project visibility gives every member Participant: everyone with the capability
    # sends, a Viewer grant included, and an API key of the project too.
    project = people.shared_session(_project(people.alice))
    for principal in (
        _human(people.alice),
        _human(people.bob),
        _human(people.carol),
        _human(people.dana),
        _api_key(),
    ):
        assert await people.session(principal, project, run) is None

    ownerless = people.world.add_session(policy=OWNERLESS_PROJECT_POLICY)
    assert await people.session(_api_key(), ownerless, run) is None
    assert await people.session(_installation(), ownerless, run) is None


async def test_s2_members_send_in_a_channel_session(people):
    """A project-visible channel session (Slack, Telegram) is like any project session:
    every member sends and reads (the owner's 2026-10-26 ruling)."""
    ownerless = people.world.add_session(
        policy=OWNERLESS_PROJECT_POLICY, is_channel=True
    )
    for user in (people.alice, people.bob, people.carol):
        assert (
            await people.session(_human(user), ownerless, Permission.RUN_SESSIONS)
            is None
        )
        assert (
            await people.session(_human(user), ownerless, Permission.VIEW_SESSIONS)
            is None
        )


@pytest.mark.parametrize(
    "action",
    [Permission.VIEW_SESSIONS, Permission.RUN_SESSIONS, Permission.EDIT_SESSIONS],
)
async def test_a_binding_acts_in_a_private_channel_session(people, action):
    """The channel session of a private agent is private to the agent's owner. Its own
    channel binding, created by that owner, reads, runs and edits it. Another binding
    does not, also one the same owner created, nor a binding someone else created, nor
    another member. The owner does."""
    binding = _installation()
    state = people.world.add_session(
        policy=_private(people.alice), channel_binding_id=binding.id
    )
    with _bound_by(binding, people.alice):
        assert await people.session(binding, state, action) is None
    other = _installation()
    with _bound_by(other, people.alice):
        assert await people.session(other, state, action) == DENIED
    with _bound_by(binding, people.bob):
        assert await people.session(binding, state, action) == DENIED
    assert await people.session(_human(people.bob), state, action) == DENIED
    assert await people.session(_human(people.alice), state, action) is None


@pytest.mark.parametrize(
    "origin", [RunOrigin.SUBSCRIPTION, RunOrigin.CHILD, RunOrigin.EVALUATION]
)
async def test_s2_a_server_run_opens_no_owned_session(people, origin):
    """The origin opens ownerless sessions only: Dana's server run is refused in a
    private session Alice owns."""
    for policy in (_private(people.alice),):
        state = people.shared_session(policy)
        assert (
            await people.session(
                _human(people.dana),
                state,
                Permission.RUN_SESSIONS,
                RunContext(origin=origin),
            )
            == DENIED
        )


async def test_s2_members_send_in_an_ownerless_project_session(people):
    """An ownerless project session that is no channel session (an API key's, a
    subscription's, a child's, an evaluation's): every member sends and answers."""
    ownerless = people.world.add_session(policy=OWNERLESS_PROJECT_POLICY)
    for user in (people.alice, people.bob, people.dana):
        assert (
            await people.session(_human(user), ownerless, Permission.RUN_SESSIONS)
            is None
        )


async def test_s4_edit_sessions(people):
    edit = Permission.EDIT_SESSIONS
    for policy in (_private(people.alice), _project(people.alice)):
        state = people.shared_session(policy)
        assert await people.session(_human(people.alice), state, edit) is None
        for principal in (
            _human(people.bob),
            _human(people.carol),
            _human(people.dana),
            _api_key(),
        ):
            assert await people.session(principal, state, edit) == DENIED

    people.world.remove_member(people.alice)
    state = people.world.add_session(policy=_project(people.alice))
    assert await people.session(_human(people.alice), state, edit) == DENIED


async def test_ownerless_session_edit_any_principal(people):
    state = people.world.add_session(policy=OWNERLESS_PROJECT_POLICY)
    for principal in (_human(people.bob), _api_key(), _installation()):
        assert await people.session(principal, state, Permission.EDIT_SESSIONS) is None


async def test_owner_left_locks_private_and_blocks_sends(people):
    private = people.shared_session(_private(people.alice))
    project = people.shared_session(_project(people.alice))
    people.world.remove_member(people.alice)

    # Private: nobody reads, grants are inert. `evaluate` has no admin shortcut, so
    # an admin is denied too (the admin shortcuts stay in decide step 3).
    for user in (people.alice, people.bob, people.carol, people.dana):
        for action in READ_ACTIONS + (Permission.RUN_SESSIONS,):
            assert await people.session(_human(user), private, action) == DENIED

    # Project: members still read, and send (project visibility gives Participant),
    # so a pending approval can still be answered after the owner left.
    assert (
        await people.session(_human(people.dana), project, Permission.VIEW_SESSIONS)
        is None
    )
    assert (
        await people.session(_human(people.carol), project, Permission.RUN_SESSIONS)
        is None
    )
    assert (
        await people.session(_human(people.dana), project, Permission.RUN_SESSIONS)
        is None
    )
    # Rename, archive and delete stay with the owner, who left: nobody (S4).
    assert (
        await people.session(_human(people.dana), project, Permission.EDIT_SESSIONS)
        == DENIED
    )


async def test_viewer_cannot_send_or_approve(people):
    state = people.shared_session(_private(people.alice))
    assert (
        await people.session(_human(people.bob), state, Permission.RUN_SESSIONS)
        == DENIED
    )
    assert (
        await people.session(_human(people.bob), state, Permission.EDIT_SESSIONS)
        == DENIED
    )


async def test_grant_of_removed_member_is_inert_and_returns_on_rejoin(people):
    # A removed grantee is denied by decide step 1 (not a member), not here. Here: the
    # owner leaves, so every grant is inert; the owner returns, and the same grant row
    # works again without a new invitation.
    state = people.shared_session(_private(people.alice))
    view = Permission.VIEW_SESSIONS

    assert await people.session(_human(people.bob), state, view) is None

    people.world.remove_member(people.alice)
    assert await people.session(_human(people.bob), state, view) == DENIED
    assert (
        await people.session(_human(people.carol), state, Permission.RUN_SESSIONS)
        == DENIED
    )

    people.world.add_member(people.alice)
    assert await people.session(_human(people.bob), state, view) is None
    assert (
        await people.session(_human(people.carol), state, Permission.RUN_SESSIONS)
        is None
    )
    assert len(people.world.dao.grants[(people.world.project_id, state.stream_id)]) == 2


async def test_first_access_by_a_write_assigns_the_legacy_owner_first(people):
    # A legacy row (visibility NULL, created by Alice): the owner rule gives private,
    # Alice. The first new-pod access is Bob renaming it.
    world = people.world
    state = world.add_session(policy=_private(people.alice), legacy=True)
    key = (world.project_id, state.session_id)
    assert key not in world.dao.sessions

    reason = await people.session(_human(people.bob), state, Permission.EDIT_SESSIONS)

    assert reason == DENIED
    assert world.dao.sessions[key].policy == _private(people.alice)
    assert world.dao.reads[:2] == [
        "fetch_session_policy",
        "assign_legacy_session_access",
    ]
    assert (
        await people.session(_human(people.alice), state, Permission.EDIT_SESSIONS)
        is None
    )


async def test_missing_row_returns_none(people):
    world = people.world
    missing = world.dao.add_session(
        project_id=uuid4(), policy=_private(people.alice)
    )  # another project
    for action in READ_ACTIONS + (Permission.RUN_SESSIONS, Permission.EDIT_SESSIONS):
        assert await people.session(_human(people.bob), missing, action) is None
    assert await people.agent(_human(people.bob), uuid4()) is None
    assert await people.agent(_human(people.bob), "not-a-uuid") is None


async def test_other_actions_return_none_for_sessions(people):
    state = people.shared_session(_private(people.alice))
    for action in (RoleRequirement(role="admin"), Permission.VIEW_WORKFLOWS):
        assert await people.session(_human(people.dana), state, action) is None
    assert people.world.dao.reads == []


async def test_other_resource_kinds_return_none(people):
    resource = ResourceRef.model_construct(kind="trace", id=str(uuid4()))
    reason = await people.world.service.evaluate(
        principal=_human(people.bob),
        action=Permission.VIEW_SESSIONS,
        project_id=people.world.project_id,
        resource=resource,
    )
    assert reason is None
    assert people.world.dao.reads == []


def test_registry(monkeypatch):
    import oss.src.core.sharing.service as service_module
    from oss.src.core.sharing.types import SharingServiceNotRegistered

    monkeypatch.setattr(service_module, "_sharing_service", None)
    with pytest.raises(SharingServiceNotRegistered):
        service_module.get_sharing_service()

    service = SharingWorld().service
    service_module.register_sharing_service(sharing_service=service)
    assert service_module.get_sharing_service() is service


# -- step 4 of decide -----------------------------------------------------------------


class _RecordingPolicy(AllowAllResourcePolicy):
    """Wraps the real `SharingService` and records each call."""

    def __init__(self, service) -> None:
        super().__init__()
        self._service = service

    async def evaluate(self, **kwargs):
        await super().evaluate(**kwargs)
        return await self._service.evaluate(**kwargs)


class _DecideWorld:
    """`AccessService` over the `SharingWorld` memberships, with the real
    `SharingService` as its resource policy. The project's organization owner is
    `owner`; Alice owns a private session; Bob is a member with `bob_role`."""

    def __init__(self, *, bob_role: str = "editor") -> None:
        self.world = SharingWorld()
        self.owner = uuid4()
        summary = self.world.memberships_dao.projects[self.world.project_id]
        self.world.memberships_dao.projects[self.world.project_id] = summary.model_copy(
            update={"organization_owner_id": self.owner}
        )
        self.alice = self.world.add_member(uuid4())
        self.bob = self.world.add_member(uuid4(), role=bob_role)
        self.world.add_member(self.owner, role="viewer")
        self.principals = InMemoryPrincipalsDAO()
        for user in (self.alice, self.bob, self.owner):
            self.principals.human(user)
        self.policy = _RecordingPolicy(self.world.service)
        self.service = AccessService(
            memberships=self.world.service._memberships,
            rbac=RecordingRbac(),
            principals=self.principals,
            resource_policy=self.policy,
        )
        self.session = self.world.add_session(policy=_private(self.alice))

    @property
    def session_ref(self) -> ResourceRef:
        return ResourceRef(kind=ResourceKind.SESSION, id=self.session.session_id)

    async def decide(self, user, action, resource=None):
        return await self.service.decide(
            authority=None,
            principal=_human(user),
            action=action,
            project_id=self.world.project_id,
            resource=resource,
        )


async def test_shortcuts_do_not_open_private():
    # The organization owner (ORGANIZATION_OWNER shortcut).
    world = _DecideWorld()
    decision = await world.decide(
        world.owner, Permission.VIEW_SESSIONS, world.session_ref
    )
    assert (decision.allowed, decision.reason) == (False, DENIED)

    # The project owner role (PROJECT_OWNER shortcut).
    world = _DecideWorld(bob_role="owner")
    decision = await world.decide(
        world.bob, Permission.VIEW_SESSIONS, world.session_ref
    )
    assert (decision.allowed, decision.reason) == (False, DENIED)
    unchecked = await world.decide(world.bob, Permission.VIEW_SESSIONS)
    assert unchecked.reason == DecisionReason.PROJECT_OWNER

    # The owner herself passes.
    decision = await world.decide(
        world.alice, Permission.VIEW_SESSIONS, world.session_ref
    )
    assert decision.allowed


async def test_step_four_runs_only_after_capability():
    world = _DecideWorld(bob_role="viewer")
    decision = await world.decide(
        world.bob, Permission.EDIT_SESSIONS, world.session_ref
    )
    assert (decision.allowed, decision.reason) == (
        False,
        DecisionReason.MISSING_CAPABILITY,
    )
    assert world.policy.calls == []

    # A principal that fails eligibility never reaches step 4 either.
    stranger = uuid4()
    decision = await world.decide(stranger, Permission.VIEW_SESSIONS, world.session_ref)
    assert decision.reason == DecisionReason.PRINCIPAL_INACTIVE
    assert world.policy.calls == []


async def test_no_resource_skips_step_four():
    world = _DecideWorld()
    decision = await world.decide(world.bob, Permission.VIEW_SESSIONS)
    assert (decision.allowed, decision.reason) == (True, DecisionReason.ROLE)
    assert world.policy.calls == []


async def test_resource_denied_is_logged_with_ids_and_kinds(monkeypatch):
    import oss.src.core.access.service as access_module

    logged = []
    monkeypatch.setattr(
        access_module.log,
        "info",
        lambda event, **fields: logged.append((event, fields)),
    )
    world = _DecideWorld()
    decision = await world.decide(
        world.bob, Permission.VIEW_SESSIONS, world.session_ref
    )
    assert decision.reason == DENIED
    assert world.policy.calls[0]["resource"] == world.session_ref

    events = [
        fields for event, fields in logged if event == "[sharing] resource denied"
    ]
    assert len(events) == 1
    fields = events[0]
    assert fields["principal_kind"] == "human"
    assert fields["principal_id"] == str(world.bob)
    assert fields["acting_user_id"] == str(world.bob)
    assert fields["project_id"] == str(world.world.project_id)
    assert fields["action"] == "permission:view_sessions"
    assert fields["resource_kind"] == "session"
    assert fields["resource_id"] == world.session.session_id
    assert fields["reason"] == "resource_denied"
    assert set(fields) == {
        "principal_kind",
        "principal_id",
        "acting_user_id",
        "project_id",
        "action",
        "resource_kind",
        "resource_id",
        "reason",
        "run_id",
    }


async def test_manage_agent_ownership_is_admin_only():
    assert Permission.MANAGE_AGENT_OWNERSHIP.value == "manage_agent_ownership"
    for role, allowed in (("admin", True), ("editor", False), ("developer", False)):
        world = _DecideWorld(bob_role=role)
        decision = await world.decide(world.bob, Permission.MANAGE_AGENT_OWNERSHIP)
        expected = DecisionReason.ROLE if allowed else DecisionReason.MISSING_CAPABILITY
        assert (decision.allowed, decision.reason) == (allowed, expected), role


def test_a_turn_admission_admits_only_the_same_principal_and_origin():
    from oss.src.dbs.redis.sessions.locks import (  # noqa: PLC0415
        TurnAdmission,
        _admission_value,
        _parse_admission_value,
    )

    alice = PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())
    record = TurnAdmission(principal=alice, origin="subscription")
    assert _parse_admission_value(_admission_value(record)) == record
    assert record.admits(principal=alice, origin=RunOrigin.SUBSCRIPTION)
    assert not record.admits(principal=alice, origin=RunOrigin.WEB)
    assert not record.admits(principal=alice, origin=None)
    bob = PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())
    assert not record.admits(principal=bob, origin=RunOrigin.SUBSCRIPTION)
    # A record an earlier build wrote has no origin: no shortcut, the beat is checked.
    old = _parse_admission_value(f"human:{alice.id}".encode())
    assert old == TurnAdmission(principal=alice, origin=None)
    assert not old.admits(principal=alice, origin=RunOrigin.WEB)
