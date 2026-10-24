"""An organization SSO login is accepted only for that organization's verified domains."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.auth import service as auth_service_module
from oss.src.core.auth.service import AuthService
from oss.src.core.auth.supertokens import overrides
from supertokens_python.recipe.thirdparty.interfaces import SignInUpNotAllowed


ORG_ID = uuid4()
OTHER_ORG_ID = uuid4()


def _auth_service(monkeypatch, *, verified_domains):
    """An AuthService in EE mode whose verified domains map slug -> organization id."""
    service = AuthService()
    monkeypatch.setattr(auth_service_module, "is_ee", lambda: True)
    monkeypatch.setattr(
        auth_service_module.db_manager,
        "get_organization_by_slug",
        AsyncMock(
            side_effect=lambda slug: (
                SimpleNamespace(id=ORG_ID) if slug == "acme" else None
            )
        ),
    )

    async def get_verified_by_slug(*, slug):
        organization_id = verified_domains.get(slug)
        if organization_id is None:
            return None
        return SimpleNamespace(slug=slug, organization_id=organization_id)

    service.domains_dao = SimpleNamespace(get_verified_by_slug=get_verified_by_slug)
    return service


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("third_party_id", "email", "allowed"),
    [
        ("sso:acme:okta", "user@acme.com", True),
        ("sso:acme:okta", "User@ACME.com", True),
        # Domain verified by another organization.
        ("sso:acme:okta", "user@other.com", False),
        # Domain not verified by anyone.
        ("sso:acme:okta", "user@unknown.com", False),
        # Unknown organization slug.
        ("sso:nobody:okta", "user@acme.com", False),
        ("sso:acme", "user@acme.com", False),
        ("google", "user@acme.com", False),
        ("sso:acme:okta", "not-an-email", False),
    ],
)
async def test_is_sso_email_allowed(monkeypatch, third_party_id, email, allowed):
    service = _auth_service(
        monkeypatch,
        verified_domains={"acme.com": ORG_ID, "other.com": OTHER_ORG_ID},
    )

    assert await service.is_sso_email_allowed(third_party_id, email) is allowed


@pytest.mark.asyncio
async def test_is_sso_email_allowed_is_false_without_ee(monkeypatch):
    monkeypatch.setattr(auth_service_module, "is_ee", lambda: False)
    service = AuthService()

    assert await service.is_sso_email_allowed("sso:acme:okta", "a@acme.com") is False


def _thirdparty_implementation():
    original_sign_in_up = AsyncMock(
        side_effect=AssertionError("original sign_in_up should not be called")
    )
    implementation = SimpleNamespace(
        sign_in_up=original_sign_in_up,
        get_provider=AsyncMock(return_value=None),
    )
    overrides.override_thirdparty_functions(implementation)
    return implementation, original_sign_in_up


async def _sign_in(implementation, *, third_party_id, email):
    return await implementation.sign_in_up(
        third_party_id=third_party_id,
        third_party_user_id="provider-user",
        email=email,
        is_verified=True,
        oauth_tokens={},
        raw_user_info_from_provider={},
        session=None,
        should_try_linking_with_session_user=None,
        tenant_id="public",
        user_context={},
    )


@pytest.mark.asyncio
async def test_sso_sign_in_refused_outside_verified_domains(monkeypatch):
    implementation, original_sign_in_up = _thirdparty_implementation()
    monkeypatch.setattr(
        overrides, "is_auth_info_blocked", AsyncMock(return_value=False)
    )
    is_allowed = AsyncMock(return_value=False)
    monkeypatch.setattr(overrides.auth_service, "is_sso_email_allowed", is_allowed)

    result = await _sign_in(
        implementation,
        third_party_id="sso:acme:okta",
        email="user@other.com",
    )

    assert isinstance(result, SignInUpNotAllowed)
    assert result.reason == "Access Denied."
    original_sign_in_up.assert_not_called()
    is_allowed.assert_awaited_once_with("sso:acme:okta", "user@other.com")


@pytest.mark.asyncio
async def test_social_sign_in_skips_sso_domain_check(monkeypatch):
    implementation, original_sign_in_up = _thirdparty_implementation()
    monkeypatch.setattr(
        overrides, "is_auth_info_blocked", AsyncMock(return_value=False)
    )
    is_allowed = AsyncMock(return_value=False)
    monkeypatch.setattr(overrides.auth_service, "is_sso_email_allowed", is_allowed)

    # The check passes social logins through to SuperTokens unchanged.
    with pytest.raises(AssertionError, match="should not be called"):
        await _sign_in(implementation, third_party_id="google", email="u@x.com")

    original_sign_in_up.assert_awaited_once()
    is_allowed.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("known_methods", "allowed"),
    [
        ([], False),
        (["social:google"], False),
        (["email:otp"], True),
    ],
)
async def test_policy_counts_only_identities_the_user_has(
    monkeypatch, known_methods, allowed
):
    service = AuthService()
    monkeypatch.setattr(auth_service_module, "is_ee", lambda: True)
    monkeypatch.setattr(
        service,
        "_get_organization_flags",
        AsyncMock(return_value={"allow_email": True, "allow_social": False}),
    )
    monkeypatch.setattr(
        service, "_is_organization_owner", AsyncMock(return_value=False)
    )
    service.identities_dao = SimpleNamespace(
        list_by_user=AsyncMock(
            return_value=[SimpleNamespace(method=m) for m in known_methods]
        )
    )

    result = await service.check_organization_access(uuid4(), ORG_ID, ["email:otp"])

    assert (result is None) is allowed


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("flags", "loaded"),
    [
        ({"is_active": True, "is_valid": True}, True),
        ({"is_active": True, "is_valid": False}, False),
        ({"is_active": True}, False),
        ({"is_valid": True}, False),
    ],
)
async def test_dynamic_provider_needs_active_and_valid(monkeypatch, flags, loaded):
    monkeypatch.setattr(overrides, "is_ee", lambda: True)
    monkeypatch.setattr(
        overrides.db_manager,
        "get_organization_by_slug",
        AsyncMock(return_value=SimpleNamespace(id=ORG_ID)),
    )
    provider = SimpleNamespace(id=uuid4(), flags=flags, secret_id=uuid4())
    monkeypatch.setattr(
        overrides,
        "providers_dao",
        SimpleNamespace(get_by_slug=AsyncMock(return_value=provider)),
    )
    secret = SimpleNamespace(
        data={
            "provider": {
                "issuer_url": "https://idp.test.agenta.ai",
                "client_id": "client-id",
                "client_secret": "client-secret",
            }
        }
    )
    vault = SimpleNamespace(get_secret_by_id=AsyncMock(return_value=secret))
    monkeypatch.setattr(overrides, "VaultService", lambda *_args: vault, raising=False)
    monkeypatch.setattr(overrides, "SecretsDAO", lambda: None, raising=False)
    monkeypatch.setattr(
        overrides,
        "_fetch_checked_oidc_endpoints",
        AsyncMock(
            return_value={
                "authorization_endpoint": "https://idp.test.agenta.ai/authorize",
                "token_endpoint": "https://idp.test.agenta.ai/token",
                "userinfo_endpoint": "https://idp.test.agenta.ai/userinfo",
            }
        ),
    )

    result = await overrides._get_dynamic_oidc_provider("sso:acme:okta")

    assert (result is not None) is loaded


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("session_identity", "allowed"),
    [
        ("sso:acme:okta", True),
        ("sso:other-org:okta", False),
        ("sso:acme:inactive", False),
        ("sso:acme:untested", False),
    ],
)
async def test_sso_policy_counts_only_the_orgs_own_providers(
    monkeypatch, session_identity, allowed
):
    service = AuthService()
    monkeypatch.setattr(auth_service_module, "is_ee", lambda: True)
    monkeypatch.setattr(
        service,
        "_get_organization_flags",
        AsyncMock(
            return_value={
                "allow_email": False,
                "allow_social": False,
                "allow_sso": True,
            }
        ),
    )
    monkeypatch.setattr(
        service, "_is_organization_owner", AsyncMock(return_value=False)
    )
    monkeypatch.setattr(
        service, "_get_organization_slug", AsyncMock(return_value="acme")
    )
    monkeypatch.setattr(
        service, "_get_active_sso_providers", AsyncMock(return_value=[])
    )
    service.identities_dao = SimpleNamespace(
        list_by_user=AsyncMock(return_value=[SimpleNamespace(method=session_identity)])
    )
    providers = [
        SimpleNamespace(slug="okta", flags={"is_active": True, "is_valid": True}),
        SimpleNamespace(slug="inactive", flags={"is_active": False, "is_valid": True}),
        SimpleNamespace(slug="untested", flags={"is_active": True, "is_valid": False}),
    ]
    service.providers_dao = SimpleNamespace(
        list_by_organization=AsyncMock(return_value=providers)
    )

    result = await service.check_organization_access(
        uuid4(), ORG_ID, [session_identity]
    )

    service.providers_dao.list_by_organization.assert_awaited_once_with(
        organization_id=str(ORG_ID)
    )
    assert (result is None) is allowed
