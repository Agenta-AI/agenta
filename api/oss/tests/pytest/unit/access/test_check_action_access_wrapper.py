"""`check_action_access` keeps its signature and messages, and decides for the request's
principal only (M2, interfaces 3.3). It stores no decision in a cache."""

from contextlib import contextmanager
from uuid import uuid4

import pytest

import oss.src.core.access.service as access_module
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.dtos import (
    Decision,
    DecisionReason,
    RequestCredentialKind,
    RoleRequirement,
)
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission, RequiredRole
from oss.src.core.access.service import AccessService, register_access_service
from oss.src.core.access.types import (
    AccessServiceNotRegistered,
    RequestAccessMismatch,
    RequestAccessMissing,
)
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.tests.pytest.utils.memberships import (
    InMemoryMembershipsDAO,
    RecordingRbac,
    make_summary,
)
from oss.tests.pytest.utils.principals import (
    HumanPrincipalsDAO,
    make_envelope,
    make_request_access,
)


class _RecordingAccess:
    def __init__(self, decision):
        self.decision = decision
        self.calls = []
        self.human_calls = []

    async def check_request(self, **kwargs):
        self.calls.append(kwargs)
        return self.decision

    async def check_human(self, **kwargs):
        self.human_calls.append(kwargs)
        return self.decision


@pytest.fixture
def registered(monkeypatch):
    recording = _RecordingAccess(Decision(allowed=True, reason=DecisionReason.ROLE))
    monkeypatch.setattr(access_module, "_access_service", recording)
    return recording


@contextmanager
def request_access(*, kind="human", credential_kind="bearer_session", **kwargs):
    access = make_request_access(
        envelope=make_envelope(kind=kind, **kwargs), credential_kind=credential_kind
    )
    token = set_request_access(access)
    try:
        yield access
    finally:
        reset_request_access(token)


async def test_wrapper_under_run_credential_passes_the_request_access(registered):
    project = uuid4()
    with request_access(
        kind="api_key", credential_kind="run_credential", project_id=project
    ) as access:
        assert (
            await check_action_access(
                user_uid=str(access.acting_user_id),
                project_id=str(project),
                permission=Permission.RUN_WORKFLOWS,
            )
            is True
        )
    assert registered.calls == [
        {
            "access": access,
            "action": Permission.RUN_WORKFLOWS,
            "project_id": project,
        }
    ]
    assert registered.calls[0]["access"].authority.project_id == project
    assert registered.human_calls == []


async def test_wrapper_bearer_passes_the_bearer_access(registered):
    with request_access() as access:
        await check_action_access(
            user_uid=str(access.acting_user_id),
            project_id=str(uuid4()),
            permission=Permission.VIEW_APPLICATIONS,
        )
    assert (
        registered.calls[0]["access"].credential_kind
        == RequestCredentialKind.BEARER_SESSION
    )


async def test_wrapper_bearer_session_decides_without_authority(monkeypatch):
    """Through the real service: a browser session checks another of the user's
    projects, so `check_request` passes no authority to `decide`."""

    seen = []

    async def _decide(self, **kwargs):
        seen.append(kwargs)
        return Decision(allowed=True, reason=DecisionReason.ROLE)

    service = AccessService.__new__(AccessService)
    monkeypatch.setattr(AccessService, "decide", _decide)
    monkeypatch.setattr(access_module, "_access_service", service)
    with request_access() as access:
        await check_action_access(
            user_uid=str(access.acting_user_id),
            project_id=str(uuid4()),
            permission=Permission.VIEW_APPLICATIONS,
        )
    assert seen[0]["authority"] is None
    assert seen[0]["principal"] == access.principal


async def test_wrapper_without_request_access_raises(registered):
    with pytest.raises(RequestAccessMissing):
        await check_action_access(
            user_uid=str(uuid4()),
            project_id=str(uuid4()),
            permission=Permission.VIEW_APPLICATIONS,
        )
    assert registered.calls == []


async def test_wrapper_with_other_user_raises(registered):
    with request_access():
        with pytest.raises(RequestAccessMismatch):
            await check_action_access(
                user_uid=str(uuid4()),
                project_id=str(uuid4()),
                permission=Permission.VIEW_APPLICATIONS,
            )
    assert registered.calls == []


async def test_role_check_passes_a_role_requirement(registered):
    project = uuid4()
    with request_access() as access:
        assert (
            await check_action_access(
                user_uid=str(access.acting_user_id),
                project_id=str(project),
                role=RequiredRole.ADMIN,
            )
            is True
        )
    assert registered.calls[0]["action"] == RoleRequirement(role="admin")


async def test_wrapper_keeps_m1_argument_rules(registered):
    with request_access() as access:
        user = str(access.acting_user_id)
        with pytest.raises(
            Exception, match="Either permission or role must be provided"
        ):
            await check_action_access(user_uid=user, project_id=str(uuid4()))
        with pytest.raises(
            Exception, match="Only one of permission or role must be provided"
        ):
            await check_action_access(
                user_uid=user,
                project_id=str(uuid4()),
                permission=Permission.VIEW_APPLICATIONS,
                role=RequiredRole.ADMIN,
            )
        with pytest.raises(Exception, match="Project_ID is required"):
            await check_action_access(
                user_uid=user, permission=Permission.VIEW_APPLICATIONS
            )


async def test_wrapper_writes_no_cache(registered, monkeypatch):
    import oss.src.utils.caching as caching  # noqa: PLC0415

    async def _forbidden(**kwargs):
        raise AssertionError("check_action_access must not use the cache")

    monkeypatch.setattr(caching, "get_cache", _forbidden)
    monkeypatch.setattr(caching, "set_cache", _forbidden)
    with request_access() as access:
        for _ in range(2):
            await check_action_access(
                user_uid=str(access.acting_user_id),
                project_id=str(uuid4()),
                permission=Permission.VIEW_APPLICATIONS,
            )
    assert len(registered.calls) == 2


async def test_call_without_registration_raises(monkeypatch):
    monkeypatch.setattr(access_module, "_access_service", None)
    with request_access() as access:
        with pytest.raises(AccessServiceNotRegistered):
            await check_action_access(
                user_uid=str(access.acting_user_id),
                project_id=str(uuid4()),
                permission=Permission.VIEW_APPLICATIONS,
            )


async def test_malformed_or_unknown_project_id_denies(monkeypatch):
    dao = InMemoryMembershipsDAO()
    dao.add_project(make_summary())
    # Recorded first, so teardown restores the real original registration.
    monkeypatch.setattr(access_module, "_access_service", None)
    register_access_service(
        access_service=AccessService(
            memberships=MembershipsService(
                memberships_dao=dao, policy=MembershipPolicy.ORGANIZATION_WIDE
            ),
            rbac=RecordingRbac(),
            principals=HumanPrincipalsDAO(),
        )
    )
    with request_access() as access:
        user = str(access.acting_user_id)
        assert (
            await check_action_access(
                user_uid=user,
                project_id="not-a-uuid",
                permission=Permission.VIEW_APPLICATIONS,
            )
            is False
        )
        assert (
            await check_action_access(
                user_uid=user,
                project_id=str(uuid4()),
                permission=Permission.VIEW_APPLICATIONS,
            )
            is False
        )


async def test_check_human_is_explicit(monkeypatch):
    """`check_human` needs no request access and names the human it checks."""

    seen = []

    async def _decide(self, **kwargs):
        seen.append(kwargs)
        return Decision(allowed=True, reason=DecisionReason.ROLE)

    monkeypatch.setattr(AccessService, "decide", _decide)
    service = AccessService.__new__(AccessService)
    user, project = uuid4(), uuid4()
    decision = await service.check_human(
        user_id=user, project_id=project, action=Permission.EDIT_MCP_ENDPOINTS
    )
    assert decision.allowed
    assert seen[0]["authority"] is None
    assert seen[0]["principal"].id == user
    assert seen[0]["project_id"] == project
