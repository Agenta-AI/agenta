"""`check_action_access` keeps its signature, messages and cache, and delegates."""

from uuid import uuid4

import pytest

import oss.src.core.access.permissions.service as wrapper_module
import oss.src.core.access.service as access_module
from oss.src.core.access.controls import get_controls_hash
from oss.src.core.access.dtos import Decision, DecisionReason, RoleRequirement
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission, RequiredRole
from oss.src.core.access.service import AccessService, register_access_service
from oss.src.core.access.types import AccessServiceNotRegistered
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.tests.pytest.utils.memberships import (
    InMemoryMembershipsDAO,
    RecordingRbac,
    make_summary,
)
from oss.tests.pytest.utils.principals import HumanPrincipalsDAO


class _RecordingAccess:
    def __init__(self, decision):
        self.decision = decision
        self.calls = []

    async def check_human(self, **kwargs):
        self.calls.append(kwargs)
        return self.decision


@pytest.fixture
def registered(monkeypatch):
    recording = _RecordingAccess(Decision(allowed=True, reason=DecisionReason.ROLE))
    monkeypatch.setattr(access_module, "_access_service", recording)
    return recording


async def test_role_check_passes_a_role_requirement(registered):
    user, project = uuid4(), uuid4()

    assert (
        await check_action_access(
            user_uid=str(user), project_id=str(project), role=RequiredRole.ADMIN
        )
        is True
    )
    assert registered.calls == [
        {
            "user_id": user,
            "project_id": project,
            "action": RoleRequirement(role="admin"),
        }
    ]


async def test_argument_validation_is_unchanged(registered):
    with pytest.raises(Exception, match="Either permission or role must be provided"):
        await check_action_access(user_uid=str(uuid4()), project_id=str(uuid4()))
    with pytest.raises(
        Exception, match="Only one of permission or role must be provided"
    ):
        await check_action_access(
            user_uid=str(uuid4()),
            project_id=str(uuid4()),
            permission=Permission.VIEW_APPLICATIONS,
            role=RequiredRole.ADMIN,
        )


async def test_cache_key_is_unchanged(registered, monkeypatch):
    gets, sets = [], []

    async def _get_cache(**kwargs):
        gets.append(kwargs)
        return None

    async def _set_cache(**kwargs):
        sets.append(kwargs)

    monkeypatch.setattr(wrapper_module, "get_cache", _get_cache)
    monkeypatch.setattr(wrapper_module, "set_cache", _set_cache)
    user, project = uuid4(), uuid4()

    await check_action_access(
        user_uid=str(user),
        project_id=str(project),
        permission=Permission.VIEW_APPLICATIONS,
    )

    expected = {
        "namespace": "check_action_access",
        "project_id": str(project),
        "user_id": str(user),
        "key": {
            "permission": "view_applications",
            "role": None,
            "controls": get_controls_hash(),
        },
    }
    assert gets == [expected]
    assert sets == [{**expected, "value": True}]
    assert isinstance(sets[0]["value"], bool)


async def test_call_without_registration_raises(monkeypatch):
    monkeypatch.setattr(access_module, "_access_service", None)

    async def _cached_allow(**kwargs):
        return True

    monkeypatch.setattr(wrapper_module, "get_cache", _cached_allow)

    with pytest.raises(AccessServiceNotRegistered):
        await check_action_access(
            user_uid=str(uuid4()),
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
    assert (
        await check_action_access(
            user_uid=str(uuid4()),
            project_id="not-a-uuid",
            permission=Permission.VIEW_APPLICATIONS,
        )
        is False
    )
    assert (
        await check_action_access(
            user_uid=str(uuid4()),
            project_id=str(uuid4()),
            permission=Permission.VIEW_APPLICATIONS,
        )
        is False
    )


async def test_missing_project_id_raises(registered):
    with pytest.raises(Exception, match="Project_ID is required"):
        await check_action_access(
            user_uid=str(uuid4()), permission=Permission.VIEW_APPLICATIONS
        )
