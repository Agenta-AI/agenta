"""The memberships preflight reads the RBAC entitlement like the hot path does.

An organization with no subscription, or with a plan the entitlements do not define,
makes the hot path raise `EntitlementsException`: it never counts as an organization
without RBAC. The preflight must not stop on it either. It skips the organization
for P2b and lists it as undecided.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import ee.src.core.access.entitlements.service as entitlements_service
from ee.src.core.access.entitlements.service import EntitlementsException
from ee.src.core.access.entitlements.types import DefaultPlan
from ee.src.core.access.rbac import EntitlementsRbacEnforcement
from entrypoints import memberships_check

HOBBY = DefaultPlan.CLOUD_V0_HOBBY.value
BUSINESS = DefaultPlan.CLOUD_V0_BUSINESS.value
UNKNOWN_PLAN = "cloud_v0_custom_plan_not_in_entitlements"


def _wire_subscriptions(monkeypatch, plans: dict):
    """`plans` maps an organization id to its plan slug, or to None for no
    subscription row."""

    async def read(*, organization_id):
        plan = plans[organization_id]
        if plan is None:
            return None
        return SimpleNamespace(plan=plan, anchor=None)

    service = SimpleNamespace(read=AsyncMock(side_effect=read))
    monkeypatch.setattr(entitlements_service, "_subscriptions_service", lambda: service)


@pytest.mark.asyncio
@pytest.mark.parametrize("plan", [None, UNKNOWN_PLAN])
async def test_hot_path_never_treats_an_undecided_plan_as_without_rbac(
    monkeypatch, plan
):
    organization_id = uuid4()
    _wire_subscriptions(monkeypatch, {str(organization_id): plan})

    with pytest.raises(EntitlementsException):
        await EntitlementsRbacEnforcement().is_enforced(organization_id=organization_id)


@pytest.mark.asyncio
@pytest.mark.parametrize("plan", [None, UNKNOWN_PLAN])
async def test_preflight_reads_an_undecided_plan_as_none(monkeypatch, plan):
    organization_id = uuid4()
    _wire_subscriptions(monkeypatch, {str(organization_id): plan})

    assert await memberships_check._rbac_enforced(organization_id) is None


@pytest.mark.asyncio
async def test_preflight_skips_undecided_organizations_and_lists_them(monkeypatch):
    free = uuid4()
    paid = uuid4()
    missing = uuid4()
    unknown = uuid4()
    _wire_subscriptions(
        monkeypatch,
        {
            str(free): HOBBY,
            str(paid): BUSINESS,
            str(missing): None,
            str(unknown): UNKNOWN_PLAN,
        },
    )
    undecided = []

    result = await memberships_check._no_rbac_organizations(
        [free, paid, missing, unknown], undecided
    )

    assert result == [free]
    assert undecided == [missing, unknown]


@pytest.mark.asyncio
async def test_preflight_still_stops_on_a_read_error(monkeypatch):
    """A Redis or database error is not an undecided plan: the job stops."""

    service = SimpleNamespace(read=AsyncMock(side_effect=ConnectionError("db down")))
    monkeypatch.setattr(entitlements_service, "_subscriptions_service", lambda: service)

    with pytest.raises(ConnectionError):
        await memberships_check._no_rbac_organizations([uuid4()], [])
