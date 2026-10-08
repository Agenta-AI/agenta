import pytest
from unittest.mock import AsyncMock, patch
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
