from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest

from oss.src.core.auth import helper as auth_helper
from oss.src.core.organizations.exceptions import (
    OrganizationCreationNotAllowedError,
    OrganizationLimitReachedError,
)
from oss.src.services import commoners
from oss.src.services.commoners import create_accounts


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


@pytest.mark.asyncio
async def test_create_accounts_awaits_add_contact():
    payload = {"uid": "123", "email": "test@example.com"}

    with (
        patch(
            "oss.src.services.commoners.acquire_lock",
            return_value="lock1",
            new_callable=AsyncMock,
        ),
        patch(
            "oss.src.services.commoners.release_lock",
            return_value=True,
            new_callable=AsyncMock,
        ),
        patch(
            "oss.src.services.commoners.db_manager.get_user_with_email",
            return_value=AsyncMock(id="user1"),
            new_callable=AsyncMock,
        ),
        patch(
            "oss.src.services.commoners.db_manager.get_user_organizations",
            return_value=["org1"],
            new_callable=AsyncMock,
        ),
        patch(
            "oss.src.core.auth.service.AuthService.enforce_domain_policies",
            new_callable=AsyncMock,
        ),
        patch("oss.src.services.commoners.is_ee", return_value=True),
        patch(
            "oss.src.utils.emailing.add_contact", new_callable=AsyncMock
        ) as mock_add_contact,
    ):
        await create_accounts(payload)

        mock_add_contact.assert_awaited_once_with("test@example.com")


@pytest.mark.asyncio
async def test_create_accounts_survives_add_contact_failure():
    payload = {"uid": "123", "email": "test@example.com"}

    with (
        patch(
            "oss.src.services.commoners.acquire_lock",
            return_value="lock1",
            new_callable=AsyncMock,
        ),
        patch(
            "oss.src.services.commoners.release_lock",
            return_value=True,
            new_callable=AsyncMock,
        ),
        patch(
            "oss.src.services.commoners.db_manager.get_user_with_email",
            return_value=AsyncMock(id="user1"),
            new_callable=AsyncMock,
        ),
        patch(
            "oss.src.services.commoners.db_manager.get_user_organizations",
            return_value=["org1"],
            new_callable=AsyncMock,
        ),
        patch(
            "oss.src.core.auth.service.AuthService.enforce_domain_policies",
            new_callable=AsyncMock,
        ),
        patch("oss.src.services.commoners.is_ee", return_value=True),
        patch(
            "oss.src.utils.emailing.add_contact",
            new_callable=AsyncMock,
            side_effect=httpx.ConnectTimeout("loops is down"),
        ) as mock_add_contact,
    ):
        user = await create_accounts(payload)

        assert user is not None

        mock_add_contact.assert_awaited_once_with("test@example.com")


@pytest.fixture
def _owner(monkeypatch):
    access = commoners.env.agenta.access
    monkeypatch.setattr(access, "allowed_owner_emails", None, raising=False)
    monkeypatch.setattr(access, "allowed_domains", set())
    monkeypatch.setattr(access, "blocked_emails", set())
    monkeypatch.setattr(access, "blocked_domains", {"blocked.example"})
    monkeypatch.setattr(access, "max_owned_organizations", None)
    # The empty email list falls back to PostHog; keep the test off the network.
    monkeypatch.setattr(
        auth_helper, "_get_posthog_string_entries", AsyncMock(return_value=set())
    )
    monkeypatch.setattr(commoners, "is_ee", lambda: False)
    install_ping = MagicMock()
    monkeypatch.setattr(commoners, "schedule_install_ping", install_ping)

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

    return SimpleNamespace(
        set_user=_set_user, created=created, access=access, install_ping=install_ping
    )


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
    _owner.install_ping.assert_called_once_with()


@pytest.mark.asyncio
async def test_create_organization_has_no_limit_when_unset(_owner):
    user = _owner.set_user("user@example.com", owned=50)

    await commoners.create_organization_for_user(user_id=user.id)

    _owner.created.assert_awaited_once()


@pytest.mark.asyncio
async def test_signup_organization_schedules_the_install_ping(_owner):
    user = _owner.set_user("user@example.com")

    await commoners.create_organization_for_signup(
        user_id=user.id, organization_email=user.email
    )

    _owner.created.assert_awaited_once()
    _owner.install_ping.assert_called_once_with()
