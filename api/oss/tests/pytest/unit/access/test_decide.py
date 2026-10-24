"""`AccessService.decide` and its entry points, over in-memory principals and
memberships and the fake cache with the real serializer."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

import oss.src.core.access.service as access_module
import oss.src.core.memberships.service as memberships_module
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.dtos import (
    AgentRef,
    DecisionReason,
    PrincipalKind,
    PrincipalRef,
    ResourceKind,
    ResourceRef,
    RoleRequirement,
    RunAuthority,
    RunRestrictions,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService
from oss.src.core.access.types import AccessDenied, DecisionInputMissing
from oss.src.core.memberships.dtos import MembershipPolicy, MembershipWriteResult
from oss.src.core.memberships.service import MembershipsService
from oss.src.utils.env import env
from oss.tests.pytest.utils.cache import FakeCache
from oss.tests.pytest.utils.memberships import (
    InMemoryMembershipsDAO,
    RecordingRbac,
    make_summary,
)
from oss.tests.pytest.utils.principals import (
    InMemoryPrincipalsDAO,
    make_envelope,
    make_request_access,
)


@pytest.fixture
def fake_cache(monkeypatch):
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    return FakeCache().install(monkeypatch, memberships_module)


class _World:
    def __init__(self, *, enforced: bool = True):
        self.memberships_dao = InMemoryMembershipsDAO()
        self.principals = InMemoryPrincipalsDAO()
        self.rbac = RecordingRbac(enforced=enforced)
        self.organization_id = uuid4()
        self.owner = uuid4()
        self.project = self.memberships_dao.add_project(
            make_summary(
                organization_id=self.organization_id, organization_owner_id=self.owner
            )
        )
        self.service = AccessService(
            memberships=MembershipsService(
                memberships_dao=self.memberships_dao,
                policy=MembershipPolicy.PROJECT_ROWS,
            ),
            rbac=self.rbac,
            principals=self.principals,
        )

    @property
    def project_id(self):
        return self.project.project_id

    def add_project(self, organization_id=None):
        return self.memberships_dao.add_project(
            make_summary(organization_id=organization_id or self.organization_id)
        )

    def member(self, user, role="editor", project=None):
        project = project or self.project
        self.memberships_dao.add_organization_member(
            organization_id=project.organization_id, user_id=user, role=role
        )
        self.memberships_dao.add_project_member(
            project_id=project.project_id, user_id=user, role=role
        )

    def drop(self, user):
        self.memberships_dao.organization_members = [
            m for m in self.memberships_dao.organization_members if m.user_id != user
        ]
        self.memberships_dao.project_members = [
            m for m in self.memberships_dao.project_members if m.user_id != user
        ]

    def set_role(self, user, role):
        for rows in (
            self.memberships_dao.organization_members,
            self.memberships_dao.project_members,
        ):
            for i, m in enumerate(rows):
                if m.user_id == user:
                    rows[i] = m.model_copy(update={"role": role})

    def authority(self, principal, *, project_id=None, linked_user_id=None, **kw):
        return RunAuthority(
            principal=principal,
            organization_id=self.organization_id,
            project_id=project_id or self.project_id,
            linked_user_id=linked_user_id,
            **kw,
        )


def _assert(decision, allowed, reason):
    assert (decision.allowed, decision.reason) == (allowed, reason)


async def test_deleted_api_key_is_principal_inactive(fake_cache):
    world = _World()
    creator = uuid4()
    world.member(creator)
    key = PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())  # no record
    decision = await world.service.decide(
        authority=world.authority(key),
        principal=key,
        action=Permission.VIEW_APPLICATIONS,
    )
    _assert(decision, False, DecisionReason.PRINCIPAL_INACTIVE)


async def test_expired_api_key_is_principal_inactive_on_a_warm_cache(
    fake_cache, monkeypatch
):
    world = _World()
    creator = uuid4()
    world.member(creator)
    now = datetime.now(timezone.utc)
    key = world.principals.api_key(
        project_id=world.project_id,
        created_by_id=creator,
        expires_at=now + timedelta(minutes=5),
    )
    authority = world.authority(key)
    decision = await world.service.decide(
        authority=authority, principal=key, action=Permission.VIEW_APPLICATIONS
    )
    _assert(decision, True, DecisionReason.ROLE)

    monkeypatch.setattr(access_module, "_now", lambda: now + timedelta(minutes=6))
    decision = await world.service.decide(
        authority=authority, principal=key, action=Permission.VIEW_APPLICATIONS
    )
    _assert(decision, False, DecisionReason.PRINCIPAL_INACTIVE)


async def test_run_credential_for_other_project_is_restricted(fake_cache):
    world = _World()
    user = uuid4()
    other = world.add_project()
    world.member(user)
    world.member(user, project=other)
    human = world.principals.human(user)
    decision = await world.service.decide(
        authority=world.authority(human),
        principal=human,
        action=Permission.VIEW_APPLICATIONS,
        project_id=other.project_id,
    )
    _assert(decision, False, DecisionReason.RESTRICTED_BY_AUTHORITY)


async def test_key_of_other_project_is_not_member(fake_cache):
    world = _World()
    creator = uuid4()
    other = world.add_project()
    world.member(creator)
    world.member(creator, project=other)
    key = world.principals.api_key(project_id=world.project_id, created_by_id=creator)
    decision = await world.service.decide(
        authority=None,
        principal=key,
        action=Permission.VIEW_APPLICATIONS,
        project_id=other.project_id,
    )
    _assert(decision, False, DecisionReason.NOT_MEMBER)


async def test_key_whose_creator_left_is_not_member(fake_cache):
    world = _World()
    creator = uuid4()  # not a member
    key = world.principals.api_key(project_id=world.project_id, created_by_id=creator)
    decision = await world.service.decide(
        authority=world.authority(key),
        principal=key,
        action=Permission.VIEW_APPLICATIONS,
    )
    _assert(decision, False, DecisionReason.NOT_MEMBER)


async def test_human_in_two_organizations_uses_requested_project(fake_cache):
    world = _World()
    user = uuid4()
    other = world.add_project(organization_id=uuid4())
    world.member(user, role="viewer")
    world.member(user, role="admin", project=other)
    human = world.principals.human(user)

    here = await world.service.decide(
        authority=None,
        principal=human,
        action=Permission.EDIT_WORKFLOWS,
        project_id=world.project_id,
    )
    there = await world.service.decide(
        authority=None,
        principal=human,
        action=Permission.EDIT_WORKFLOWS,
        project_id=other.project_id,
    )
    _assert(here, False, DecisionReason.MISSING_CAPABILITY)
    _assert(there, True, DecisionReason.ROLE)


async def test_role_requirement_under_key_uses_creator(fake_cache):
    world = _World()
    creator = uuid4()
    world.member(creator, role="admin")
    key = world.principals.api_key(project_id=world.project_id, created_by_id=creator)
    decision = await world.service.decide(
        authority=world.authority(key),
        principal=key,
        action=RoleRequirement(role="admin"),
    )
    _assert(decision, True, DecisionReason.ROLE)


async def test_first_denial_wins(fake_cache):
    world = _World()
    creator = uuid4()
    world.member(creator)
    key = world.principals.api_key(
        project_id=world.project_id, created_by_id=creator, is_active=False
    )
    decision = await world.service.decide(
        authority=world.authority(key, project_id=uuid4()),
        principal=key,
        action=Permission.VIEW_APPLICATIONS,
        project_id=world.project_id,
    )
    _assert(decision, False, DecisionReason.PRINCIPAL_INACTIVE)
    assert world.rbac.calls == []


async def test_installation_linked_user_role_is_used(fake_cache):
    world = _World()
    creator, linked = uuid4(), uuid4()
    world.member(creator, role="admin")
    world.member(linked, role="viewer")
    binding = world.principals.installation(
        project_id=world.project_id, created_by_id=creator
    )
    decision = await world.service.decide(
        authority=world.authority(binding, linked_user_id=linked),
        principal=binding,
        action=Permission.EDIT_WORKFLOWS,
    )
    _assert(decision, False, DecisionReason.MISSING_CAPABILITY)


async def test_installation_unlinked_uses_binding_creator(fake_cache):
    world = _World()
    creator = uuid4()
    world.member(creator, role="admin")
    binding = world.principals.installation(
        project_id=world.project_id, created_by_id=creator
    )
    decision = await world.service.decide(
        authority=world.authority(binding),
        principal=binding,
        action=Permission.EDIT_WORKFLOWS,
    )
    _assert(decision, True, DecisionReason.ROLE)


async def test_archived_binding_is_principal_inactive(fake_cache):
    world = _World()
    creator = uuid4()
    world.member(creator, role="admin")
    binding = world.principals.installation(
        project_id=world.project_id, created_by_id=creator, is_active=False
    )
    decision = await world.service.decide(
        authority=world.authority(binding),
        principal=binding,
        action=Permission.RUN_SESSIONS,
    )
    _assert(decision, False, DecisionReason.PRINCIPAL_INACTIVE)


async def test_any_agent_restriction_is_refused_in_m2(fake_cache):
    world = _World()
    user = uuid4()
    world.member(user, role="admin")
    human = world.principals.human(user)
    agent = uuid4()
    authority = world.authority(
        human, restrictions=RunRestrictions(agent=AgentRef(id=agent))
    )
    for resource in (
        ResourceRef(kind=ResourceKind.AGENT, id=str(agent)),
        ResourceRef(kind=ResourceKind.AGENT, id=str(uuid4())),
        None,
    ):
        decision = await world.service.decide(
            authority=authority,
            principal=human,
            action=Permission.RUN_WORKFLOWS,
            resource=resource,
        )
        _assert(decision, False, DecisionReason.RESTRICTED_BY_AUTHORITY)


async def test_authority_principal_mismatch_is_restricted(fake_cache):
    world = _World()
    alice, bob = uuid4(), uuid4()
    world.member(alice)
    world.member(bob)
    a = world.principals.human(alice)
    b = world.principals.human(bob)
    decision = await world.service.decide(
        authority=world.authority(a),
        principal=b,
        action=Permission.VIEW_APPLICATIONS,
    )
    _assert(decision, False, DecisionReason.RESTRICTED_BY_AUTHORITY)


async def test_membership_removed_denies_on_next_call(fake_cache):
    world = _World()
    user = uuid4()
    world.member(user)
    human = world.principals.human(user)
    kwargs = dict(
        authority=None,
        principal=human,
        action=Permission.VIEW_APPLICATIONS,
        project_id=world.project_id,
    )
    _assert(await world.service.decide(**kwargs), True, DecisionReason.ROLE)

    world.drop(user)
    world.memberships_dao.write_results["remove_member"] = MembershipWriteResult(
        user_id=user
    )
    await world.service.memberships.remove_member(
        organization_id=world.organization_id, email="x@test.agenta.ai"
    )
    _assert(await world.service.decide(**kwargs), False, DecisionReason.NOT_MEMBER)


async def test_role_change_applies_on_next_call(fake_cache):
    world = _World()
    user = uuid4()
    world.member(user, role="viewer")
    human = world.principals.human(user)
    kwargs = dict(
        authority=None,
        principal=human,
        action=Permission.EDIT_WORKFLOWS,
        project_id=world.project_id,
    )
    _assert(
        await world.service.decide(**kwargs), False, DecisionReason.MISSING_CAPABILITY
    )

    world.set_role(user, "editor")
    await world.service.memberships.set_member_role(
        organization_id=world.organization_id, user_id=user, role="editor"
    )
    _assert(await world.service.decide(**kwargs), True, DecisionReason.ROLE)


async def test_missing_project_raises(fake_cache):
    world = _World()
    human = world.principals.human(uuid4())
    with pytest.raises(DecisionInputMissing):
        await world.service.decide(
            authority=None, principal=human, action=Permission.VIEW_APPLICATIONS
        )


async def test_repeated_denied_requests_hit_redis_not_postgres(fake_cache):
    world = _World()
    outsider = world.principals.human(uuid4())
    for _ in range(3):
        decision = await world.service.decide(
            authority=None,
            principal=outsider,
            action=Permission.VIEW_APPLICATIONS,
            project_id=world.project_id,
        )
        _assert(decision, False, DecisionReason.NOT_MEMBER)
    assert world.memberships_dao.reads == ["fetch_membership_row"]


async def test_decide_with_cache_errors_reads_the_dao_and_still_denies(monkeypatch):
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    FakeCache(fail=True).install(monkeypatch, memberships_module)
    world = _World()
    member, outsider = uuid4(), uuid4()
    world.member(member)
    allowed = world.principals.human(member)
    denied = world.principals.human(outsider)
    for _ in range(2):
        _assert(
            await world.service.decide(
                authority=None,
                principal=denied,
                action=Permission.VIEW_APPLICATIONS,
                project_id=world.project_id,
            ),
            False,
            DecisionReason.NOT_MEMBER,
        )
        _assert(
            await world.service.decide(
                authority=None,
                principal=allowed,
                action=Permission.VIEW_APPLICATIONS,
                project_id=world.project_id,
            ),
            True,
            DecisionReason.ROLE,
        )
    assert world.memberships_dao.reads.count("fetch_membership_row") == 4


async def test_check_eligibility_skips_capability(fake_cache):
    world = _World()
    user = uuid4()
    world.member(user, role="viewer")
    human = world.principals.human(user)
    decision = await world.service.check_eligibility(
        authority=None, principal=human, project_id=world.project_id
    )
    _assert(decision, True, DecisionReason.ELIGIBLE)
    assert world.rbac.calls == []

    outsider = world.principals.human(uuid4())
    decision = await world.service.check_eligibility(
        authority=None, principal=outsider, project_id=world.project_id
    )
    _assert(decision, False, DecisionReason.NOT_MEMBER)


@pytest.mark.parametrize("kind", ["bearer_session", "api_key", "run_credential"])
async def test_check_request_uses_the_explicit_project(kind, fake_cache):
    world = _World()
    user = uuid4()
    other = world.add_project()
    world.member(user)
    world.member(user, project=other)
    if kind == "api_key":
        principal = world.principals.api_key(
            project_id=world.project_id, created_by_id=user
        )
    else:
        principal = world.principals.human(user)
    envelope = make_envelope(
        kind=principal.kind.value,
        principal_id=principal.id,
        project_id=world.project_id,
        organization_id=world.organization_id,
        origin="api" if kind == "api_key" else "web",
    )
    access = make_request_access(
        envelope=envelope, credential_kind=kind, acting_user_id=user
    )

    here = await world.service.check_request(
        access=access, action=Permission.VIEW_APPLICATIONS, project_id=world.project_id
    )
    _assert(here, True, DecisionReason.ROLE)

    there = await world.service.check_request(
        access=access,
        action=Permission.VIEW_APPLICATIONS,
        project_id=other.project_id,
    )
    if kind == "bearer_session":
        _assert(there, True, DecisionReason.ROLE)  # no authority: the browser user
    elif kind == "api_key":
        _assert(there, False, DecisionReason.NOT_MEMBER)  # the key's project
    else:
        _assert(there, False, DecisionReason.RESTRICTED_BY_AUTHORITY)


async def test_check_human_is_explicit(fake_cache):
    world = _World()
    user = uuid4()
    world.member(user)
    world.principals.human(user)
    decision = await world.service.check_human(
        user_id=user, project_id=world.project_id, action=Permission.VIEW_APPLICATIONS
    )
    _assert(decision, True, DecisionReason.ROLE)
    assert world.principals.reads == [PrincipalRef(kind=PrincipalKind.HUMAN, id=user)]


async def test_require_raises_access_denied(fake_cache):
    world = _World()
    user = uuid4()
    world.member(user, role="viewer")
    human = world.principals.human(user)
    envelope = make_envelope(
        principal_id=human.id,
        project_id=world.project_id,
        organization_id=world.organization_id,
    )
    await world.service.require(envelope=envelope, action=Permission.VIEW_APPLICATIONS)
    with pytest.raises(AccessDenied) as caught:
        await world.service.require(envelope=envelope, action=Permission.EDIT_WORKFLOWS)
    assert caught.value.decision.reason == DecisionReason.MISSING_CAPABILITY


async def test_deny_logs_ids_without_credentials(fake_cache, monkeypatch):
    events = []

    class _Log:
        def info(self, event, **fields):
            events.append((event, fields))

        def warning(self, *args, **kwargs):
            pass

        def debug(self, *args, **kwargs):
            pass

    monkeypatch.setattr(access_module, "log", _Log())
    world = _World()
    outsider = world.principals.human(uuid4())
    envelope = make_envelope(
        principal_id=outsider.id,
        project_id=world.project_id,
        organization_id=world.organization_id,
        run_id="turn-1",
    )
    token = set_request_access(
        make_request_access(envelope=envelope, credential_kind="run_credential")
    )
    try:
        decision = await world.service.check_request(
            access=make_request_access(
                envelope=envelope, credential_kind="run_credential"
            ),
            action=Permission.VIEW_APPLICATIONS,
            project_id=world.project_id,
        )
    finally:
        reset_request_access(token)

    _assert(decision, False, DecisionReason.NOT_MEMBER)
    assert [e for e, _ in events] == ["[access] denied"]
    fields = events[0][1]
    assert fields["reason"] == "not_member"
    assert fields["principal_kind"] == "human"
    assert fields["credential_kind"] == "run_credential"
    assert fields["run_id"] == "turn-1" and fields["origin"] == "web"
    # The role user is known on a membership denial and is logged.
    assert fields["role_user_id"] == str(outsider.id)
    assert fields["organization_id"] == str(world.organization_id)
    for value in fields.values():
        assert "Secret " not in str(value) and "ApiKey " not in str(value)
