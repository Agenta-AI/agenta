from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from oss.src.core.auth import helper as auth_helper
from oss.src.core.auth.supertokens import overrides
from oss.src.services.exceptions import UnauthorizedException
from supertokens_python.recipe.thirdparty.interfaces import SignInUpNotAllowed


@pytest.mark.asyncio
async def test_ensure_auth_info_not_blocked_rejects_explicitly_blocked_email(
    monkeypatch,
):
    monkeypatch.setattr(auth_helper, "is_ee", lambda: True)
    monkeypatch.setattr(
        auth_helper,
        "get_blocked_emails",
        AsyncMock(return_value={"blocked@example.com"}),
    )
    monkeypatch.setattr(
        auth_helper,
        "get_allowed_domains",
        AsyncMock(return_value=set()),
    )
    monkeypatch.setattr(
        auth_helper,
        "get_blocked_domains",
        AsyncMock(return_value=set()),
    )

    auth_info = auth_helper.parse_auth_info("Blocked@example.com")

    with pytest.raises(UnauthorizedException, match="Access Denied."):
        await auth_helper.ensure_auth_info_not_blocked(auth_info)


@pytest.mark.asyncio
async def test_ensure_auth_info_not_blocked_rejects_disallowed_domain(monkeypatch):
    monkeypatch.setattr(auth_helper, "is_ee", lambda: True)
    monkeypatch.setattr(
        auth_helper,
        "get_blocked_emails",
        AsyncMock(return_value=set()),
    )
    monkeypatch.setattr(
        auth_helper,
        "get_allowed_domains",
        AsyncMock(return_value={"allowed.example.com"}),
    )
    monkeypatch.setattr(
        auth_helper,
        "get_blocked_domains",
        AsyncMock(return_value={"blocked.example.com"}),
    )

    auth_info = auth_helper.parse_auth_info("user@other.example.com")

    with pytest.raises(UnauthorizedException, match="Access Denied."):
        await auth_helper.ensure_auth_info_not_blocked(auth_info)


@pytest.mark.asyncio
async def test_get_blocked_domains_accepts_string_posthog_payload(monkeypatch):
    monkeypatch.setattr(
        auth_helper,
        "env",
        SimpleNamespace(
            agenta=SimpleNamespace(
                blocked_domains=set(),
                blocked_emails=set(),
                allowed_domains=set(),
            ),
            posthog=SimpleNamespace(enabled=True),
        ),
    )
    monkeypatch.setattr(
        auth_helper,
        "get_cache",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        auth_helper,
        "set_cache",
        AsyncMock(),
    )
    monkeypatch.setattr(
        auth_helper.posthog,
        "get_feature_flag_payload",
        lambda feature_flag, distinct_id: "agenta.dev",
    )

    blocked_domains = await auth_helper.get_blocked_domains()

    assert blocked_domains == {"agenta.dev"}


@pytest.mark.asyncio
async def test_get_blocked_domains_splits_comma_separated_posthog_payload(monkeypatch):
    monkeypatch.setattr(
        auth_helper,
        "env",
        SimpleNamespace(
            agenta=SimpleNamespace(
                blocked_domains=set(),
                blocked_emails=set(),
                allowed_domains=set(),
            ),
            posthog=SimpleNamespace(enabled=True),
        ),
    )
    monkeypatch.setattr(
        auth_helper,
        "get_cache",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        auth_helper,
        "set_cache",
        AsyncMock(),
    )
    monkeypatch.setattr(
        auth_helper.posthog,
        "get_feature_flag_payload",
        lambda feature_flag, distinct_id: "spica.asia, agenta.ai , yopmail.com",
    )

    blocked_domains = await auth_helper.get_blocked_domains()

    assert blocked_domains == {"spica.asia", "agenta.ai", "yopmail.com"}


@pytest.mark.asyncio
async def test_thirdparty_sign_in_up_checks_blocking_before_auth(monkeypatch):
    called = False

    async def original_sign_in_up(**kwargs):
        nonlocal called
        called = True
        raise AssertionError("original sign_in_up should not be called")

    async def original_get_provider(**kwargs):
        return None

    implementation = SimpleNamespace(
        sign_in_up=original_sign_in_up,
        get_provider=original_get_provider,
    )
    overrides.override_thirdparty_functions(implementation)

    monkeypatch.setattr(
        overrides,
        "is_auth_info_blocked",
        AsyncMock(return_value=True),
    )

    result = await implementation.sign_in_up(
        third_party_id="google",
        third_party_user_id="provider-user",
        email="blocked@example.com",
        is_verified=True,
        oauth_tokens={},
        raw_user_info_from_provider={},
        session=None,
        should_try_linking_with_session_user=None,
        tenant_id="public",
        user_context={},
    )

    assert called is False
    assert isinstance(result, SignInUpNotAllowed)
    assert result.reason == "Access Denied."
