"""Bearer and API-key authentication take the organization id where a workspace id was.

Workspace removal step 2b: `?workspace_id=` must carry the project's organization id; a
legacy workspace id is an unknown id (refused); the workspace-only branch checks project
membership through the resolver; the no-parameter branch starts from the user's oldest
organization membership. No branch reads a workspace.
"""

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import oss.src.core.memberships.service as memberships_module
import oss.src.services.db_manager as db_manager_module
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.middlewares import auth
from oss.src.utils.caching import _pack
from oss.src.utils.exceptions import UnauthorizedException
from oss.tests.pytest.utils.memberships import InMemoryMembershipsDAO, make_summary


def _request(path: str = "/projects/") -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )


class _Cache:
    """`get_cache`/`set_cache` over a dict, keyed like the real cache (`_pack`)."""

    def __init__(self, user: UUID):
        self.user = user
        self.store = {}
        self.calls = []

    async def get(
        self, *, namespace=None, project_id=None, user_id=None, key=None, **_
    ):
        self.calls.append(("get", namespace))
        if namespace == "get_supertokens_user_by_id":
            return {"user_id": str(self.user), "user_email": "member@test.agenta.ai"}
        return self.store.get(
            _pack(namespace=namespace, project_id=project_id, user_id=user_id, key=key)
        )

    async def set(
        self,
        *,
        namespace=None,
        project_id=None,
        user_id=None,
        key=None,
        value=None,
        **_,
    ):
        self.calls.append(("set", namespace))
        self.store[
            _pack(namespace=namespace, project_id=project_id, user_id=user_id, key=key)
        ] = value

    def names(self):
        return [namespace for _, namespace in self.calls]


@pytest.fixture
def world(monkeypatch):
    user = uuid4()
    organization_id = uuid4()
    other_organization_id = uuid4()
    legacy_workspace = uuid4()
    dao = InMemoryMembershipsDAO()
    project = dao.add_project(
        make_summary(organization_id=organization_id, is_default=True)
    )
    no_workspace = dao.add_project(make_summary(organization_id=organization_id))
    service = MembershipsService(
        memberships_dao=dao, policy=MembershipPolicy.ORGANIZATION_WIDE
    )
    monkeypatch.setattr(memberships_module, "_memberships_service", service)

    cache = _Cache(user)
    reads = []
    signed = []
    projects = {
        str(project.project_id): SimpleNamespace(
            id=project.project_id,
            organization_id=organization_id,
            organization=SimpleNamespace(name="Organization"),
        ),
        str(no_workspace.project_id): SimpleNamespace(
            id=no_workspace.project_id,
            organization_id=organization_id,
            organization=SimpleNamespace(name="Organization"),
        ),
    }
    defaults = {
        str(organization_id): db_manager_module.DefaultProjectRef(
            project_id=project.project_id,
            project_organization_id=organization_id,
        ),
    }
    state = SimpleNamespace(oldest_organization=str(organization_id))

    async def _get_session(request):
        return SimpleNamespace(get_user_id=lambda: "supertokens-user")

    async def _get_project_by_id(project_id):
        reads.append("get_project_by_id")
        return projects.get(str(project_id))

    async def _fetch_default_project(*, organization_id):
        reads.append("fetch_default_project")
        return defaults.get(str(organization_id))

    async def _fetch_oldest_organization_id(*, user_id):
        reads.append("fetch_oldest_organization_id")
        return state.oldest_organization

    async def _sign_secret_token(**claims):
        signed.append(claims)
        return "secret"

    monkeypatch.setattr(auth, "get_session", _get_session)
    monkeypatch.setattr(auth, "get_cache", cache.get)
    monkeypatch.setattr(auth, "set_cache", cache.set)
    monkeypatch.setattr(memberships_module, "get_cache", cache.get)
    monkeypatch.setattr(memberships_module, "set_cache", cache.set)
    monkeypatch.setattr(auth, "sign_secret_token", _sign_secret_token)
    monkeypatch.setattr(auth.db_manager, "get_project_by_id", _get_project_by_id)
    monkeypatch.setattr(
        auth.db_manager, "fetch_default_project", _fetch_default_project
    )
    monkeypatch.setattr(
        auth.db_manager, "fetch_oldest_organization_id", _fetch_oldest_organization_id
    )

    def member(project_id=None):
        dao.add_organization_member(
            organization_id=organization_id, user_id=user, role="editor"
        )

    return SimpleNamespace(
        user=user,
        dao=dao,
        service=service,
        cache=cache,
        reads=reads,
        signed=signed,
        project=project,
        no_workspace=no_workspace,
        organization_id=organization_id,
        other_organization_id=other_organization_id,
        legacy_workspace=legacy_workspace,
        defaults=defaults,
        state=state,
        member=member,
    )


async def _bearer(world, *, project_id=None, workspace_id=None, path="/projects/"):
    request = _request(path)
    await auth.verify_bearer_token(
        request=request,
        bearer_token="token",
        query_project_id=str(project_id) if project_id else None,
        query_workspace_id=str(workspace_id) if workspace_id else None,
    )
    return request.state


def _denied(world) -> bool:
    return any(value == {"deny": True} for value in world.cache.store.values())


# --- project_id + workspace_id ------------------------------------------------ #


async def test_bearer_accepts_the_organization_id_with_a_project(world):
    world.member()
    state = await _bearer(
        world, project_id=world.project.project_id, workspace_id=world.organization_id
    )
    assert state.workspace_id == str(world.organization_id)
    assert state.organization_id == str(world.organization_id)
    # The project read (the second one is the organization-name lookup, as today).
    assert world.reads == ["get_project_by_id", "get_project_by_id"]


async def test_bearer_refuses_a_legacy_workspace_id_with_a_project(world):
    world.member()
    with pytest.raises(UnauthorizedException):
        await _bearer(
            world,
            project_id=world.project.project_id,
            workspace_id=world.legacy_workspace,
        )
    assert _denied(world)
    assert world.reads == ["get_project_by_id"]


async def test_bearer_refuses_another_organization_id(world):
    world.member()
    with pytest.raises(UnauthorizedException):
        await _bearer(
            world,
            project_id=world.project.project_id,
            workspace_id=world.other_organization_id,
        )
    assert _denied(world)


# --- workspace_id only ------------------------------------------------------- #


async def test_bearer_workspace_only_accepts_the_organization_id(world):
    world.member()
    state = await _bearer(world, workspace_id=world.organization_id)
    assert state.project_id == str(world.project.project_id)
    assert state.workspace_id == str(world.organization_id)
    assert world.reads.count("fetch_default_project") == 1
    assert world.dao.reads == ["fetch_membership_row"]


async def test_bearer_workspace_only_refuses_a_legacy_workspace_id(world):
    world.member()
    with pytest.raises(UnauthorizedException):
        await _bearer(world, workspace_id=world.legacy_workspace)
    assert _denied(world)


async def test_bearer_workspace_only_makes_no_membership_cache_call(world):
    world.member()
    await _bearer(world, workspace_id=world.organization_id)
    assert "resolve_membership" not in world.cache.names()
    assert world.cache.names().count("verify_bearer_token") == 2  # one GET, one SET


async def test_bearer_workspace_only_refuses_a_non_member(world):
    with pytest.raises(HTTPException) as error:
        await _bearer(world, workspace_id=world.organization_id)
    assert error.value.status_code == 401
    assert not _denied(world)


async def test_bearer_workspace_only_refuses_an_unknown_id(world):
    world.member()
    with pytest.raises(UnauthorizedException):
        await _bearer(world, workspace_id=uuid4())
    assert _denied(world)


async def test_bearer_ignores_a_workspace_only_state_cached_by_old_code(world):
    # A v0.124.0 pod cached success after a workspace-row check; this user is not a
    # member of the default project.
    old_key = {
        "u_id": str(world.user)[-12:],
        "p_id": "",
        "w_id": str(world.organization_id)[-12:],
        "scope": "default",
    }
    await world.cache.set(
        namespace="verify_bearer_token",
        project_id=None,
        user_id=str(world.user),
        key=old_key,
        value={
            "user_id": str(world.user),
            "project_id": str(world.project.project_id),
            "workspace_id": str(world.organization_id),
            "organization_id": str(world.organization_id),
            "principal": {"kind": "human", "id": str(world.user)},
        },
    )
    with pytest.raises(HTTPException) as error:
        await _bearer(world, workspace_id=world.organization_id)
    assert error.value.status_code == 401


async def test_bearer_project_state_cached_by_old_code_still_serves(world):
    old_key = {
        "u_id": str(world.user)[-12:],
        "p_id": str(world.project.project_id)[-12:],
        "w_id": "",
        "scope": "default",
    }
    await world.cache.set(
        namespace="verify_bearer_token",
        project_id=str(world.project.project_id),
        user_id=str(world.user),
        key=old_key,
        value={
            "user_id": str(world.user),
            "project_id": str(world.project.project_id),
            "workspace_id": str(world.organization_id),
            "organization_id": str(world.organization_id),
            "principal": {"kind": "human", "id": str(world.user)},
        },
    )
    state = await _bearer(world, project_id=world.project.project_id)
    assert state.project_id == str(world.project.project_id)
    assert world.reads == []
    assert world.dao.reads == []


# --- project without a workspace --------------------------------------------- #


async def test_bearer_project_without_workspace_answers_the_organization_id(world):
    world.member()
    state = await _bearer(world, project_id=world.no_workspace.project_id)
    assert state.workspace_id == str(world.organization_id)
    # Step 2: the signer writes the workspace claim itself (the organization id).
    assert "workspace_id" not in world.signed[-1]


# --- no parameters ----------------------------------------------------------- #


async def test_bearer_without_parameters_starts_from_the_oldest_organization(world):
    world.member()
    state = await _bearer(world)
    assert state.project_id == str(world.project.project_id)
    assert state.workspace_id == str(world.organization_id)
    # (`get_project_by_id` after these is the organization-name lookup, as today.)
    assert world.reads[:2] == ["fetch_oldest_organization_id", "fetch_default_project"]
    assert world.dao.reads == ["fetch_membership_row"]  # the resolver decides


async def test_bearer_without_parameters_refuses_an_organization_without_membership(
    world,
):
    # The resolver says not a member of the default project.
    with pytest.raises(HTTPException) as error:
        await _bearer(world)
    assert error.value.status_code == 401
    # Refused on the default project, then no other project to open.
    assert world.dao.reads == ["fetch_membership_row", "list_membership_rows"]
    assert not _denied(world)


async def test_bearer_without_parameters_ignores_a_state_cached_by_old_code(world):
    old_key = {
        "u_id": str(world.user)[-12:],
        "p_id": "",
        "w_id": "",
        "scope": "default",
    }
    await world.cache.set(
        namespace="verify_bearer_token",
        project_id=None,
        user_id=str(world.user),
        key=old_key,
        value={
            "user_id": str(world.user),
            "project_id": str(world.project.project_id),
            "workspace_id": str(world.organization_id),
            "organization_id": str(world.organization_id),
            "principal": {"kind": "human", "id": str(world.user)},
        },
    )
    with pytest.raises(HTTPException) as error:
        await _bearer(world)
    assert error.value.status_code == 401


async def test_bearer_without_parameters_and_no_membership_at_all_is_refused(world):
    world.state.oldest_organization = None
    with pytest.raises(UnauthorizedException):
        await _bearer(world)


# --- API key ----------------------------------------------------------------- #


async def test_apikey_project_without_workspace_answers_the_organization_id(
    world, monkeypatch
):
    key_id = uuid4()

    async def _use_api_key(*, key):
        return SimpleNamespace(
            id=key_id,
            project_id=world.no_workspace.project_id,
            created_by_id=world.user,
            user=SimpleNamespace(email="member@test.agenta.ai"),
        )

    async def _no_cache(**kwargs):
        return None

    monkeypatch.setattr(auth.api_key_service, "use_api_key", _use_api_key)
    monkeypatch.setattr(auth, "get_cache", _no_cache)
    request = _request()
    await auth.verify_apikey_token(request=request, apikey_token="key")
    assert request.state.workspace_id == str(world.organization_id)
    assert request.state.organization_id == str(world.organization_id)


async def test_bearer_without_parameters_refuses_on_ee_without_a_project_row(
    world, monkeypatch
):
    # EE policy: an organization row alone is not membership; a project row is needed.
    monkeypatch.setattr(world.service, "_policy", MembershipPolicy.PROJECT_ROWS)
    world.member()  # organization row only
    with pytest.raises(HTTPException) as error:
        await _bearer(world)
    assert error.value.status_code == 401
    assert not _denied(world)


async def test_bearer_without_parameters_refuses_the_fallback_for_a_non_member(world):
    with pytest.raises(HTTPException) as error:
        await _bearer(world)
    assert error.value.status_code == 401
    # Refused on the default project, then no other project to open.
    assert world.dao.reads == ["fetch_membership_row", "list_membership_rows"]
    assert not _denied(world)


async def test_bearer_without_parameters_on_the_invite_accept_route_checks_membership(
    world,
):
    path = "/organizations/x/workspaces/y/invite/accept"
    # A member passes; the invite route state is not cached.
    world.member()
    state = await _bearer(world, path=path)
    assert state.project_id == str(world.project.project_id)
    assert world.dao.reads == ["fetch_membership_row"]


# --- a project the user may open, when the organization default is not one -------- #


def _ee_member_of_the_secondary_project_only(world, monkeypatch):
    """EE policy; the user has a project row on the second project of the organization,
    not on its default project (after the 053 consolidation)."""

    monkeypatch.setattr(world.service, "_policy", MembershipPolicy.PROJECT_ROWS)
    world.member()
    world.dao.add_project_member(
        project_id=world.no_workspace.project_id, user_id=world.user, role="editor"
    )
    picked = []

    async def _pick_fallback_project(*, project_ids):
        picked.append(list(project_ids))
        return project_ids[0] if project_ids else None

    monkeypatch.setattr(
        auth.db_manager, "pick_fallback_project", _pick_fallback_project
    )
    return picked


async def test_bearer_without_parameters_lands_on_a_project_the_member_may_open(
    world, monkeypatch
):
    picked = _ee_member_of_the_secondary_project_only(world, monkeypatch)
    state = await _bearer(world)
    assert state.project_id == str(world.no_workspace.project_id)
    assert state.organization_id == str(world.organization_id)
    assert picked == [[world.no_workspace.project_id]]


async def test_bearer_workspace_only_lands_on_a_project_the_member_may_open(
    world, monkeypatch
):
    picked = _ee_member_of_the_secondary_project_only(world, monkeypatch)
    state = await _bearer(world, workspace_id=world.organization_id)
    assert state.project_id == str(world.no_workspace.project_id)
    assert picked == [[world.no_workspace.project_id]]


async def test_bearer_without_parameters_reads_nothing_more_for_a_default_member(
    world, monkeypatch
):
    # The usual path: the user may open the default project; no fallback read.
    picked = _ee_member_of_the_secondary_project_only(world, monkeypatch)
    world.dao.add_project_member(
        project_id=world.project.project_id, user_id=world.user, role="editor"
    )
    state = await _bearer(world)
    assert state.project_id == str(world.project.project_id)
    assert world.dao.reads == ["fetch_membership_row"]
    assert picked == []
