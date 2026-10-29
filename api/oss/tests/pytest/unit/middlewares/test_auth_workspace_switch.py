"""Workspace removal step 2: the auth context, cached states and run credentials carry
the organization id where a workspace id was.

`request.state.workspace_id` always equals `request.state.organization_id`, which is the
project's organization in every branch. Cached states keep a `workspace_id` field (equal
to the organization id) for step-1 pods; a step-2 pod reads the cached
`organization_id`. The branches whose step-1 cached successes step 2 must not serve use
`"v": "m4b2"` keys. The access decision refuses a request whose organization is not its
project's.
"""

from types import SimpleNamespace
from uuid import uuid4

import jwt
import pytest
from fastapi import HTTPException

import oss.src.services.db_manager as db_manager_module
from oss.src.middlewares import auth
from oss.src.utils.context import AuthScope
from oss.src.utils.exceptions import UnauthorizedException
from oss.tests.pytest.unit.middlewares.test_auth_workspace_accept import (
    _bearer,
    _denied,
    _request,
)

from oss.tests.pytest.unit.middlewares import test_auth_workspace_accept as _accept

# The step-1 `world` fixture.
world = _accept.world


@pytest.fixture
def switch_world(world, monkeypatch):
    """`world` plus the joined project read of the project + workspace branch."""

    async def _fetch_project_with_workspace_organization(*, project_id):
        world.reads.append("fetch_project_with_workspace_organization")
        project = world.projects_by_id.get(str(project_id))
        if project is None:
            return None
        return db_manager_module.ProjectWithWorkspaceOrganization(
            project=project,
            workspace_organization_id=world.workspace_organizations.get(
                str(project.workspace_id)
            ),
        )

    projects = {}

    async def _get_project_by_id(project_id):
        world.reads.append("get_project_by_id")
        return projects.get(str(project_id))

    for summary, workspace_id in (
        (world.project, world.workspace_a),
        (world.no_workspace, None),
    ):
        projects[str(summary.project_id)] = SimpleNamespace(
            id=summary.project_id,
            workspace_id=workspace_id,
            organization_id=world.organization_id,
            organization=SimpleNamespace(name="Organization"),
        )
    world.projects_by_id = projects
    world.workspace_organizations = {
        str(world.workspace_a): world.organization_id,
        str(world.workspace_b): world.organization_id,
        str(world.foreign_workspace): world.other_organization_id,
    }
    monkeypatch.setattr(auth.db_manager, "get_project_by_id", _get_project_by_id)
    monkeypatch.setattr(
        auth.db_manager,
        "fetch_project_with_workspace_organization",
        _fetch_project_with_workspace_organization,
    )
    return world


def _cross_organization(world):
    """Project P of O1 in workspace W of O2 (the shape 053 repairs, written again after
    it by a step-1 admin call)."""

    world.projects_by_id[
        str(world.project.project_id)
    ].workspace_id = world.foreign_workspace
    world.defaults[str(world.foreign_workspace)] = db_manager_module.DefaultProjectRef(
        project_id=uuid4(),  # O2's own default project, never P
        project_organization_id=world.other_organization_id,
        project_workspace_id=world.foreign_workspace,
        ref_workspace_id=world.foreign_workspace,
        ref_organization_id=world.other_organization_id,
    )


def test_auth_scope_has_no_workspace():
    assert "workspace_id" not in AuthScope.model_fields


@pytest.mark.parametrize("branch", ["p", "p+w", "p+org", "w", "org", "none"])
async def test_every_bearer_branch_answers_the_organization_id(switch_world, branch):
    world = switch_world
    world.member()
    params = {
        "p": dict(project_id=world.project.project_id),
        "p+w": dict(
            project_id=world.project.project_id, workspace_id=world.workspace_a
        ),
        "p+org": dict(
            project_id=world.project.project_id, workspace_id=world.organization_id
        ),
        "w": dict(workspace_id=world.workspace_a),
        "org": dict(workspace_id=world.organization_id),
        "none": {},
    }[branch]
    state = await _bearer(world, **params)
    assert state.workspace_id == state.organization_id == str(world.organization_id)
    assert world.signed[-1]["organization_id"] == str(world.organization_id)


async def test_bearer_never_takes_the_workspace_organization(switch_world):
    world = switch_world
    world.member()
    _cross_organization(world)
    # ?workspace_id=W alone: O2's default, never P.
    try:
        state = await _bearer(world, workspace_id=world.foreign_workspace)
        assert state.project_id != str(world.project.project_id)
    except HTTPException:
        pass  # not a member of O2's project: refused, still never P
    # ?project_id=P&workspace_id=W: the workspace's organization is not P's.
    world.reads.clear()
    with pytest.raises(UnauthorizedException):
        await _bearer(
            world,
            project_id=world.project.project_id,
            workspace_id=world.foreign_workspace,
        )
    assert world.reads == ["fetch_project_with_workspace_organization"]
    assert _denied(world)


async def test_bearer_project_and_own_workspace_needs_one_read(switch_world):
    world = switch_world
    world.member()
    await _bearer(
        world, project_id=world.project.project_id, workspace_id=world.workspace_a
    )
    assert world.reads[0] == "fetch_project_with_workspace_organization"
    assert "get_workspace" not in world.reads
    assert "get_project_by_id" not in world.reads[:1]


def _old_key(world, *, project_id=None, workspace_id=None):
    return {
        "u_id": str(world.user)[-12:],
        "p_id": str(project_id)[-12:] if project_id else "",
        "w_id": str(workspace_id)[-12:] if workspace_id else "",
        "scope": "default",
    }


async def _put(world, key, *, project_id, value):
    await world.cache.set(
        namespace="verify_bearer_token",
        project_id=str(project_id) if project_id else None,
        user_id=str(world.user),
        key=key,
        value=value,
    )


def _step1_state(world, *, workspace_id, organization_id=None):
    return {
        "user_id": str(world.user),
        "project_id": str(world.project.project_id),
        "workspace_id": str(workspace_id),
        "organization_id": str(organization_id or world.organization_id),
        "credentials": "Secret old",
        "principal": {"kind": "human", "id": str(world.user)},
    }


async def test_bearer_state_cached_by_step1_answers_the_organization_id(switch_world):
    world = switch_world
    # A step-1 project-only state: same key, workspace field = the legacy workspace id.
    await _put(
        world,
        _old_key(world, project_id=world.project.project_id),
        project_id=world.project.project_id,
        value=_step1_state(world, workspace_id=world.workspace_a),
    )
    state = await _bearer(world, project_id=world.project.project_id)
    assert state.workspace_id == str(world.organization_id)
    assert world.reads == []


async def test_no_project_bearer_ignores_step1_states(switch_world):
    world = switch_world
    for workspace_id in (None, world.workspace_a):
        key = {**_old_key(world, workspace_id=workspace_id), "v": "m4b1"}
        await _put(
            world,
            key,
            project_id=None,
            value=_step1_state(world, workspace_id=world.workspace_a),
        )
    # Not a member: a step-1 entry would have let the request in.
    for params in ({}, {"workspace_id": world.workspace_a}):
        with pytest.raises(HTTPException) as error:
            await _bearer(world, **params)
        assert error.value.status_code == 401
    world.member()
    await _bearer(world)
    written = [k for k in world.cache.store if "verify_bearer_token" in k]
    assert any("v:m4b2" in k for k in written)


async def test_step1_cached_success_for_the_repaired_project_is_not_served(
    switch_world,
):
    world = switch_world
    world.member()
    _cross_organization(world)
    # Step 1 cached ?project_id=P&workspace_id=W (W of O2) with no version and no
    # organization check, before 053.
    await _put(
        world,
        _old_key(
            world,
            project_id=world.project.project_id,
            workspace_id=world.foreign_workspace,
        ),
        project_id=world.project.project_id,
        value=_step1_state(world, workspace_id=world.foreign_workspace),
    )
    with pytest.raises(UnauthorizedException):
        await _bearer(
            world,
            project_id=world.project.project_id,
            workspace_id=world.foreign_workspace,
        )


async def test_project_only_and_apikey_keys_are_unchanged(switch_world):
    world = switch_world
    world.member()
    await _bearer(world, project_id=world.project.project_id)
    keys = [k for k in world.cache.store if "verify_bearer_token" in k]
    assert keys and all("v:" not in k for k in keys)


async def test_cached_states_keep_a_workspace_field_for_step1_pods(switch_world):
    world = switch_world
    world.member()
    await _bearer(world, project_id=world.project.project_id)
    (written,) = [
        v
        for k, v in world.cache.store.items()
        if "verify_bearer_token" in k and isinstance(v, dict) and "principal" in v
    ]
    assert (
        written["workspace_id"]
        == written["organization_id"]
        == str(world.organization_id)
    )


async def _apikey(world, monkeypatch, *, cached=None):
    key_id = uuid4()

    async def _use_api_key(*, key):
        return SimpleNamespace(
            id=key_id,
            project_id=world.project.project_id,
            created_by_id=world.user,
            user=SimpleNamespace(email="member@test.agenta.ai"),
        )

    stored = {}

    async def _get(**kwargs):
        return cached

    async def _set(*, value, **kwargs):
        stored["value"] = value

    monkeypatch.setattr(auth.api_key_service, "use_api_key", _use_api_key)
    monkeypatch.setattr(auth, "get_cache", _get)
    monkeypatch.setattr(auth, "set_cache", _set)
    request = _request()
    await auth.verify_apikey_token(request=request, apikey_token="key")
    return request.state, stored.get("value")


async def test_apikey_state_cached_by_step1_answers_the_organization_id(
    switch_world, monkeypatch
):
    world = switch_world
    cached = {
        **_step1_state(world, workspace_id=world.workspace_a),
        "api_key_id": str(uuid4()),
        "principal": {"kind": "api_key", "id": str(uuid4())},
    }
    state, _ = await _apikey(world, monkeypatch, cached=cached)
    assert state.workspace_id == state.organization_id == str(world.organization_id)


async def test_apikey_state_written_carries_the_organization_id(
    switch_world, monkeypatch
):
    world = switch_world
    state, written = await _apikey(world, monkeypatch)
    assert state.workspace_id == str(world.organization_id)
    assert written["workspace_id"] == written["organization_id"]


async def test_auth_context_builds_without_a_workspace():
    request = _request()
    request.state.organization_id = str(uuid4())
    request.state.project_id = str(uuid4())
    request.state.user_id = str(uuid4())
    request.state.credentials = "ApiKey abc.def"
    context = auth._build_auth_context_from_state(request)
    assert context is not None
    assert str(context.scope.organization_id) == request.state.organization_id


# --- run credentials ---------------------------------------------------------- #


def _decode(token):
    return jwt.decode(
        token, auth._SECRET_KEY, algorithms=["HS256"], options={"verify_aud": False}
    )


async def test_sign_secret_token_claims_the_organization():
    import inspect

    from oss.tests.pytest.utils.principals import make_envelope

    assert "workspace_id" not in inspect.signature(auth.sign_secret_token).parameters
    organization_id, project_id = uuid4(), uuid4()
    token = await auth.sign_secret_token(
        user_id=str(uuid4()),
        project_id=str(project_id),
        organization_id=str(organization_id),
        envelope=make_envelope(organization_id=organization_id, project_id=project_id),
    )
    claims = _decode(token)
    assert claims["workspace_id"] == claims["organization_id"] == str(organization_id)


def test_every_run_credential_claims_the_organization():
    # No caller passes a workspace to the signer any more: it writes the claim itself.
    import re
    from pathlib import Path

    api = Path(__file__).resolve().parents[5]
    callers = [
        "oss/src/middlewares/auth.py",
        "oss/src/core/workflows/service.py",
        "oss/src/apis/fastapi/access/router.py",
        "oss/src/apis/fastapi/gateways/credentials_router.py",
        "oss/src/apis/fastapi/gateways/mcps/router.py",
    ]
    for relative in callers:
        source = (api / relative).read_text()
        for call in re.finditer(r"sign_secret_token\((.*?)\n\s*\)", source, re.S):
            assert "workspace_id" not in call.group(1), relative


async def test_verify_secret_token_takes_the_organization_claim(monkeypatch):
    from oss.tests.pytest.utils.principals import make_envelope

    organization_id, project_id, workspace_id = uuid4(), uuid4(), uuid4()
    # A step-1 token: the workspace claim is the legacy workspace id.
    envelope = make_envelope(organization_id=organization_id, project_id=project_id)
    claims = {
        "user_id": str(uuid4()),
        "project_id": str(project_id),
        "workspace_id": str(workspace_id),
        "organization_id": str(organization_id),
        "iat": 0,
        "exp": 2**31,
        **auth.envelope_to_claims(envelope=envelope),
    }
    token = jwt.encode(claims, auth._SECRET_KEY, algorithm="HS256")
    request = _request()
    await auth.verify_secret_token(request=request, secret_token=token)
    assert request.state.workspace_id == request.state.organization_id
    assert request.state.organization_id == str(organization_id)


# --- the access decision refuses a mismatched organization (S-28) --------------- #


async def test_decide_refuses_a_mismatched_organization():
    from oss.src.core.access.dtos import DecisionReason, PrincipalKind
    from oss.src.core.access.permissions.types import Permission
    from oss.src.core.access.service import AccessService
    from oss.src.core.memberships.dtos import MembershipPolicy
    from oss.src.core.memberships.service import MembershipsService
    from oss.tests.pytest.utils.memberships import (
        InMemoryMembershipsDAO,
        RecordingRbac,
        make_summary,
    )
    from oss.tests.pytest.utils.principals import (
        InMemoryPrincipalsDAO,
        make_envelope,
    )
    from oss.tests.pytest.utils.sharing import AllowAllResourcePolicy

    o1, o2, owner = uuid4(), uuid4(), uuid4()
    dao = InMemoryMembershipsDAO()
    project = dao.add_project(
        make_summary(organization_id=o1, organization_owner_id=owner)
    )
    dao.add_organization_member(organization_id=o1, user_id=owner, role="owner")
    dao.add_project_member(project_id=project.project_id, user_id=owner, role="owner")
    principals = InMemoryPrincipalsDAO()
    key = principals.api_key(project_id=project.project_id, created_by_id=owner)
    human = principals.human(owner)
    service = AccessService(
        memberships=MembershipsService(
            memberships_dao=dao, policy=MembershipPolicy.PROJECT_ROWS
        ),
        rbac=RecordingRbac(enforced=True),
        principals=principals,
        resource_policy=AllowAllResourcePolicy(),
    )
    for principal in (key, human):
        for organization_id, allowed in ((o1, True), (o2, False)):
            # A run credential minted by a step-1 pod before 053 for the cross-
            # organization shape names the workspace's organization (O2) and P.
            envelope = make_envelope(
                kind=principal.kind.value,
                principal_id=principal.id,
                organization_id=organization_id,
                project_id=project.project_id,
            )
            decision = await service.decide(
                authority=envelope.authority,
                principal=principal,
                action=Permission.VIEW_APPLICATIONS,
                project_id=project.project_id,
            )
            assert decision.allowed is allowed, (principal.kind, organization_id)
            if not allowed:
                assert decision.reason == DecisionReason.NOT_MEMBER
    assert PrincipalKind.API_KEY == key.kind
