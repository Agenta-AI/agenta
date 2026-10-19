from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.organizations.exceptions import (
    OrganizationCreationNotAllowedError,
    OrganizationLimitReachedError,
)
from oss.src.services import commoners


def test_can_create_organization_allows_anyone_when_unset(monkeypatch):
    monkeypatch.setattr(
        commoners.env.agenta.access, "allowed_owner_emails", None, raising=False
    )

    assert commoners.can_create_organization("anyone@example.com") is True


def test_can_create_organization_allows_listed_email(monkeypatch):
    monkeypatch.setattr(
        commoners.env.agenta.access,
        "allowed_owner_emails",
        {"owner@example.com"},
        raising=False,
    )

    assert commoners.can_create_organization("owner@example.com") is True
    assert commoners.can_create_organization("  Owner@Example.com ") is True


def test_can_create_organization_rejects_unlisted_email(monkeypatch):
    monkeypatch.setattr(
        commoners.env.agenta.access,
        "allowed_owner_emails",
        {"owner@example.com"},
        raising=False,
    )

    assert commoners.can_create_organization("other@example.com") is False


@pytest.fixture
def _owner(monkeypatch):
    access = commoners.env.agenta.access
    monkeypatch.setattr(access, "allowed_owner_emails", None, raising=False)
    monkeypatch.setattr(access, "allowed_domains", set())
    monkeypatch.setattr(access, "blocked_emails", set())
    monkeypatch.setattr(access, "blocked_domains", {"blocked.example"})
    monkeypatch.setattr(access, "max_owned_organizations", None)
    monkeypatch.setattr(commoners, "is_ee", lambda: False)

    created = AsyncMock(return_value=SimpleNamespace(id=uuid4()))
    monkeypatch.setattr(commoners, "create_organization", created)

    def _set_user(email, owned=0):
        user = SimpleNamespace(id=uuid4(), email=email)
        monkeypatch.setattr(
            commoners.db_manager, "get_user", AsyncMock(return_value=user)
        )
        monkeypatch.setattr(
            commoners.db_manager,
            "count_organizations_by_owner",
            AsyncMock(return_value=owned),
        )
        return user

    return SimpleNamespace(set_user=_set_user, created=created, access=access)


@pytest.mark.asyncio
async def test_create_organization_refuses_blocked_subdomain(_owner):
    user = _owner.set_user("user@007.blocked.example")

    with pytest.raises(OrganizationCreationNotAllowedError):
        await commoners.create_organization_for_user(user_id=user.id)

    _owner.created.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_organization_refuses_past_the_owned_limit(monkeypatch, _owner):
    monkeypatch.setattr(_owner.access, "max_owned_organizations", 2)
    user = _owner.set_user("user@example.com", owned=2)

    with pytest.raises(OrganizationLimitReachedError):
        await commoners.create_organization_for_user(user_id=user.id)

    _owner.created.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_organization_allows_below_the_owned_limit(monkeypatch, _owner):
    monkeypatch.setattr(_owner.access, "max_owned_organizations", 2)
    user = _owner.set_user("user@example.com", owned=1)

    await commoners.create_organization_for_user(user_id=user.id)

    _owner.created.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_organization_has_no_limit_when_unset(_owner):
    user = _owner.set_user("user@example.com", owned=50)

    await commoners.create_organization_for_user(user_id=user.id)

    _owner.created.assert_awaited_once()
