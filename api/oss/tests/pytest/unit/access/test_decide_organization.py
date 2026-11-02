"""The organization access decision (M5, Task 6, P3)."""

from uuid import uuid4

import pytest

import oss.src.core.access.organizations as organizations_module
from oss.src.core.access.dtos import DecisionReason, RequestAccess
from oss.src.core.access.organizations import OrganizationAction, decide_organization
from oss.src.core.memberships.dtos import OrganizationMember
from oss.tests.pytest.utils.principals import make_envelope, make_request_access

ACTION = OrganizationAction.MANAGE_ORGANIZATION_SECRETS


class _Memberships:
    def __init__(self, roles=None):
        self.roles = dict(roles or {})
        self.calls = []

    async def fetch_organization_member(self, *, organization_id, user_id):
        self.calls.append((organization_id, user_id))
        role = self.roles.get((organization_id, user_id))
        if role is None:
            return None
        return OrganizationMember(
            organization_id=organization_id, user_id=user_id, role=role
        )


@pytest.fixture
def memberships(monkeypatch):
    service = _Memberships()
    monkeypatch.setattr(
        organizations_module, "get_memberships_service", lambda: service
    )
    return service


def _bearer(user_id) -> RequestAccess:
    return make_request_access(
        envelope=make_envelope(kind="human", principal_id=user_id),
        credential_kind="bearer_session",
    )


@pytest.mark.parametrize("role", ["owner", "admin"])
async def test_owner_and_admin_in_a_browser_session_are_allowed(memberships, role):
    organization_id, user_id = uuid4(), uuid4()
    memberships.roles[(organization_id, user_id)] = role
    decision = await decide_organization(
        access=_bearer(user_id), organization_id=organization_id, action=ACTION
    )
    assert decision.allowed and decision.reason == DecisionReason.ROLE
    assert memberships.calls == [(organization_id, user_id)]


@pytest.mark.parametrize("role", ["editor", "viewer", "deployment_manager", ""])
async def test_editor_and_viewer_are_refused(memberships, role):
    organization_id, user_id = uuid4(), uuid4()
    memberships.roles[(organization_id, user_id)] = role
    decision = await decide_organization(
        access=_bearer(user_id), organization_id=organization_id, action=ACTION
    )
    assert not decision.allowed
    assert decision.reason == DecisionReason.MISSING_CAPABILITY


async def test_non_member_is_refused(memberships):
    organization_id, user_id = uuid4(), uuid4()
    memberships.roles[(uuid4(), user_id)] = "owner"  # an owner elsewhere
    decision = await decide_organization(
        access=_bearer(user_id), organization_id=organization_id, action=ACTION
    )
    assert not decision.allowed and decision.reason == DecisionReason.NOT_MEMBER


async def test_api_key_of_owner_is_refused(memberships):
    organization_id, owner = uuid4(), uuid4()
    memberships.roles[(organization_id, owner)] = "owner"
    for kind in ("api_key", "human"):  # a project key, and an M6 personal key
        access = make_request_access(
            envelope=make_envelope(
                kind=kind, principal_id=owner if kind == "human" else uuid4()
            ),
            credential_kind="api_key",
            acting_user_id=owner,
        )
        decision = await decide_organization(
            access=access, organization_id=organization_id, action=ACTION
        )
        assert not decision.allowed
        assert decision.reason == DecisionReason.MISSING_CAPABILITY
    assert memberships.calls == []


async def test_run_credential_of_owner_is_refused(memberships):
    organization_id, owner = uuid4(), uuid4()
    memberships.roles[(organization_id, owner)] = "owner"
    access = make_request_access(
        envelope=make_envelope(kind="human", principal_id=owner),
        credential_kind="run_credential",
    )
    decision = await decide_organization(
        access=access, organization_id=organization_id, action=ACTION
    )
    assert not decision.allowed and decision.reason == DecisionReason.MISSING_CAPABILITY
    assert memberships.calls == []


async def test_bearer_with_an_envelope_is_refused(memberships):
    organization_id, owner = uuid4(), uuid4()
    memberships.roles[(organization_id, owner)] = "owner"
    access = _bearer(owner).model_copy(
        update={"envelope": make_envelope(kind="human", principal_id=owner)}
    )
    decision = await decide_organization(
        access=access, organization_id=organization_id, action=ACTION
    )
    assert not decision.allowed and decision.reason == DecisionReason.MISSING_CAPABILITY


async def test_non_human_principal_or_other_acting_user_is_refused(memberships):
    organization_id, owner = uuid4(), uuid4()
    memberships.roles[(organization_id, owner)] = "owner"
    installation = make_request_access(
        envelope=make_envelope(kind="installation"),
        credential_kind="bearer_session",
        acting_user_id=owner,
    )
    other_acting = _bearer(uuid4()).model_copy(update={"acting_user_id": owner})
    for access in (installation, other_acting):
        decision = await decide_organization(
            access=access, organization_id=organization_id, action=ACTION
        )
        assert not decision.allowed
        assert decision.reason == DecisionReason.MISSING_CAPABILITY
    assert memberships.calls == []


async def test_missing_access_or_unknown_credential_kind_is_refused(memberships):
    decision = await decide_organization(
        access=None, organization_id=uuid4(), action=ACTION
    )
    assert not decision.allowed and decision.reason == DecisionReason.MISSING_CAPABILITY
    assert memberships.calls == []


async def test_decision_reads_no_entitlement_and_no_project(memberships, monkeypatch):
    """Only the member row: no RBAC entitlement, no project, no access service."""
    import oss.src.core.access.service as access_service_module

    def _forbidden(*args, **kwargs):
        raise AssertionError("the organization decision must not read this")

    monkeypatch.setattr(access_service_module, "get_access_service", _forbidden)
    organization_id, user_id = uuid4(), uuid4()
    memberships.roles[(organization_id, user_id)] = "admin"
    decision = await decide_organization(
        access=_bearer(user_id), organization_id=organization_id, action=ACTION
    )
    assert decision.allowed
    assert memberships.calls == [(organization_id, user_id)]


async def test_a_denial_logs_ids_and_reason_only(memberships, caplog):
    organization_id, user_id = uuid4(), uuid4()
    with caplog.at_level("INFO"):
        await decide_organization(
            access=_bearer(user_id), organization_id=organization_id, action=ACTION
        )
    messages = [r.getMessage() for r in caplog.records]
    assert any("organization decision denied" in m for m in messages)
