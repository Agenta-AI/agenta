"""PATCH /auth/session/identities cannot add identities to a session."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from oss.src.apis.fastapi.auth import router as auth_router


@pytest.mark.asyncio
async def test_update_session_identities_ignores_payload(monkeypatch):
    session = MagicMock()
    session.get_access_token_payload.return_value = {
        "session_identities": ["email:otp"],
    }
    session.update_access_token_payload = AsyncMock()
    session.merge_into_access_token_payload = AsyncMock()
    monkeypatch.setattr(auth_router, "get_session", AsyncMock(return_value=session))

    result = await auth_router.update_session_identities(
        request=MagicMock(),
        payload=auth_router.SessionIdentitiesUpdate(
            session_identities=["sso:acme:okta", "social:google"],
        ),
    )

    assert result == {
        "session_identities": ["email:otp"],
        "previous": ["email:otp"],
    }
    session.update_access_token_payload.assert_not_called()
    session.merge_into_access_token_payload.assert_not_called()
