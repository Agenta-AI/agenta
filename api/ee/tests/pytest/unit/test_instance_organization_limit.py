from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

import ee.src.core.access.entitlements.service as entitlements_service
import ee.src.core.organizations.service as organizations_service
import oss.src.routers.organization_router as organization_router
from ee.src.core.access.entitlements.types import (
    DefaultPlan,
    InstanceOrganizationLimitReachedError,
)
from oss.src.core.auth.service import AuthService
from oss.src.services import commoners
from oss.src.utils import emailing

COMMUNITY = DefaultPlan.SELF_HOSTED_COMMUNITY.value
REGISTERED = DefaultPlan.SELF_HOSTED_REGISTERED.value
ENTERPRISE = DefaultPlan.SELF_HOSTED_ENTERPRISE.value

LIMIT_MESSAGE = (
    "This instance allows 1 organization(s). Ask for an invitation to an existing "
    "organization, or add a paid license key."
)


@pytest.fixture
def instance(monkeypatch):
    """An instance that is not cloud, with a plan and a count of organizations."""
    state = SimpleNamespace(plan=COMMUNITY, organizations=1, cloud=False)

    async def _plan():
        if isinstance(state.plan, Exception):
            raise state.plan
        return state.plan

    monkeypatch.setattr(entitlements_service, "is_cloud", lambda: state.cloud)
    monkeypatch.setattr(entitlements_service, "instance_plan", _plan)
    count = AsyncMock(side_effect=lambda: state.organizations)
    monkeypatch.setattr(entitlements_service.db_manager, "count_organizations", count)
    state.count = count
    return state


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "plan, organizations, refused",
    [
        # The first organization on a new instance.
        (COMMUNITY, 0, False),
        (COMMUNITY, 1, True),
        # Organizations above the limit are kept; only a new one is refused.
        (COMMUNITY, 3, True),
        # The free key lifts the project limit, not the organization limit.
        (REGISTERED, 1, True),
        (ENTERPRISE, 1, False),
        (ENTERPRISE, 10, False),
    ],
)
async def test_instance_organization_limit_follows_the_instance_plan(
    instance, plan, organizations, refused
):
    instance.plan = plan
    instance.organizations = organizations

    if not refused:
        await entitlements_service.check_instance_organization_limit()
        return

    with pytest.raises(InstanceOrganizationLimitReachedError) as error:
        await entitlements_service.check_instance_organization_limit()

    assert error.value.code == "instance_organization_limit_reached"
    assert error.value.limit == 1
    assert error.value.message == LIMIT_MESSAGE


@pytest.mark.asyncio
async def test_cloud_has_no_instance_organization_limit(instance):
    instance.cloud = True
    instance.organizations = 1000

    await entitlements_service.check_instance_organization_limit()

    instance.count.assert_not_awaited()


@pytest.mark.asyncio
async def test_instance_organization_limit_fails_open_when_the_plan_read_fails(
    instance,
):
    instance.plan = ConnectionError("database down")

    await entitlements_service.check_instance_organization_limit()

    instance.count.assert_not_awaited()


# --- POST /organizations/ -------------------------------------------------------------


@pytest.fixture
def owner(monkeypatch):
    user = SimpleNamespace(id=uuid4(), email="owner@example.com")
    access = commoners.env.agenta.access
    monkeypatch.setattr(access, "allowed_owner_emails", None, raising=False)
    monkeypatch.setattr(access, "max_owned_organizations", None)
    monkeypatch.setattr(
        commoners, "is_auth_info_blocked", AsyncMock(return_value=False)
    )
    monkeypatch.setattr(commoners.db_manager, "get_user", AsyncMock(return_value=user))
    created = AsyncMock(
        return_value=SimpleNamespace(id=uuid4(), name="Second", description=None)
    )
    monkeypatch.setattr(commoners, "create_organization", created)
    monkeypatch.setattr(
        organizations_service, "provision_user_subscription", AsyncMock()
    )
    return SimpleNamespace(user=user, created=created)


async def _post_organization(user):
    return await organization_router.create_organization(
        request=SimpleNamespace(state=SimpleNamespace(user_id=str(user.id))),
        payload=organization_router.CreateOrganizationPayload(name="Second"),
    )


@pytest.mark.asyncio
async def test_second_organization_is_refused_without_a_paid_key(instance, owner):
    with pytest.raises(HTTPException) as refused:
        await _post_organization(owner.user)

    assert refused.value.status_code == 403
    assert refused.value.detail == {
        "code": "instance_organization_limit_reached",
        "message": LIMIT_MESSAGE,
        "limit": 1,
    }
    owner.created.assert_not_awaited()


@pytest.mark.asyncio
async def test_second_organization_is_created_with_a_paid_key(instance, owner):
    instance.plan = ENTERPRISE

    response = await _post_organization(owner.user)

    assert response.status_code == 201
    owner.created.assert_awaited_once()


@pytest.mark.asyncio
async def test_organization_is_created_on_cloud(instance, owner):
    instance.cloud = True

    response = await _post_organization(owner.user)

    assert response.status_code == 201
    owner.created.assert_awaited_once()


# --- Sign-up --------------------------------------------------------------------------


@pytest.fixture
def signup(monkeypatch):
    user = SimpleNamespace(id=uuid4(), email="new@example.com")
    access = commoners.env.agenta.access
    monkeypatch.setattr(access, "allowed_owner_emails", None, raising=False)
    monkeypatch.setattr(commoners, "acquire_lock", AsyncMock(return_value="lock"))
    monkeypatch.setattr(commoners, "release_lock", AsyncMock(return_value=True))
    monkeypatch.setattr(
        commoners.db_manager, "get_user_with_email", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        commoners.db_manager, "get_user_organizations", AsyncMock(return_value=[])
    )
    monkeypatch.setattr(commoners, "create_new_user", AsyncMock(return_value=user))
    deleted = AsyncMock()
    monkeypatch.setattr(commoners, "delete_user", deleted)
    created = AsyncMock()
    monkeypatch.setattr(commoners, "create_organization_for_signup", created)
    monkeypatch.setattr(AuthService, "enforce_domain_policies", AsyncMock())
    monkeypatch.setattr(emailing, "add_contact", AsyncMock())
    return SimpleNamespace(user=user, created=created, deleted=deleted)


@pytest.mark.asyncio
async def test_signup_at_the_limit_skips_the_personal_organization(instance, signup):
    # A second person, with or without a pending invitation: the invitation is
    # accepted after sign-up, so the user only needs to exist.
    user = await commoners.create_accounts({"uid": "uid", "email": "new@example.com"})

    assert user is signup.user
    signup.created.assert_not_awaited()
    signup.deleted.assert_not_awaited()


@pytest.mark.asyncio
async def test_first_signup_creates_the_personal_organization(instance, signup):
    instance.organizations = 0

    user = await commoners.create_accounts({"uid": "uid", "email": "new@example.com"})

    assert user is signup.user
    signup.created.assert_awaited_once()
    signup.deleted.assert_not_awaited()


@pytest.mark.asyncio
async def test_signup_with_a_paid_key_creates_the_personal_organization(
    instance, signup
):
    instance.plan = ENTERPRISE

    await commoners.create_accounts({"uid": "uid", "email": "new@example.com"})

    signup.created.assert_awaited_once()
