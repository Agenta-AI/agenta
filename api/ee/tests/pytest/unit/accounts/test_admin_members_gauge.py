"""The admin accounts graph moves the members gauge, as signup and invites do.

An organization the admin endpoint created had an owner and no gauge row, so the Usage
tab read "0" members, and an invite later read "1" for an owner and one member.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import ee.src.core.access.entitlements.service as entitlements_service
import oss.src.core.accounts.service as accounts_module
from ee.src.core.access.entitlements.types import Gauge
from oss.src.core.accounts.dtos import (
    AdminAccountCreateOptions,
    AdminAccountRead,
    AdminAccountsCreate,
    AdminOrganizationMembershipCreate,
    EntityRef,
)


def _service():
    return accounts_module.PlatformAdminAccountsService.__new__(
        accounts_module.PlatformAdminAccountsService
    )


@pytest.fixture
def gauge(monkeypatch):
    calls = []

    async def check_entitlements(*, key, delta, scope):
        calls.append((key, delta, scope.organization_id))
        return True, None, None

    monkeypatch.setattr(entitlements_service, "check_entitlements", check_entitlements)
    monkeypatch.setattr(accounts_module, "_invalidate_memberships", AsyncMock())
    return calls


@pytest.mark.asyncio
async def test_each_organization_membership_adds_one_member(monkeypatch, gauge):
    org_id = uuid4()
    users = {"owner": uuid4(), "member": uuid4()}

    async def resolve(ref, table, field, tracker):
        return org_id if table == "organizations" else users[ref.ref]

    monkeypatch.setattr(accounts_module, "_resolve_entity_ref_to_uuid", resolve)
    monkeypatch.setattr(
        accounts_module,
        "_create_org_membership_row",
        AsyncMock(side_effect=lambda **_: (uuid4(), None)),
    )
    dto = AdminAccountsCreate(
        organization_memberships={
            label: AdminOrganizationMembershipCreate(
                organization_ref=EntityRef(ref="org"),
                user_ref=EntityRef(ref=label),
                role="owner" if label == "owner" else "editor",
            )
            for label in users
        }
    )

    await _service()._create_memberships(
        dto, accounts_module._Tracker(), AdminAccountRead(), AdminAccountCreateOptions()
    )

    assert gauge == [(Gauge.USERS, 1, org_id), (Gauge.USERS, 1, org_id)]


@pytest.mark.asyncio
async def test_deleting_an_organization_membership_removes_one_member(
    monkeypatch, gauge
):
    org_id = uuid4()
    monkeypatch.setattr(
        accounts_module,
        "_membership_scope",
        AsyncMock(return_value=(uuid4(), org_id)),
    )
    monkeypatch.setattr(
        accounts_module, "_ee_delete_org_membership", AsyncMock(return_value=True)
    )

    await _service()._delete_ee_membership(
        membership_id=str(uuid4()), scope_type="organization"
    )

    assert gauge == [(Gauge.USERS, -1, org_id)]


@pytest.mark.asyncio
async def test_a_project_membership_leaves_the_gauge(monkeypatch, gauge):
    monkeypatch.setattr(
        accounts_module,
        "_membership_scope",
        AsyncMock(return_value=(uuid4(), uuid4())),
    )
    monkeypatch.setattr(
        accounts_module, "_ee_delete_project_membership", AsyncMock(return_value=True)
    )

    await _service()._delete_ee_membership(
        membership_id=str(uuid4()), scope_type="project"
    )

    assert gauge == []


@pytest.mark.asyncio
async def test_a_missing_subscription_does_not_fail_the_admin_write(monkeypatch):
    async def check_entitlements(**_):
        raise entitlements_service.EntitlementsException("no subscription")

    monkeypatch.setattr(entitlements_service, "check_entitlements", check_entitlements)

    await accounts_module._adjust_members_gauge(organization_id=uuid4(), delta=1)
