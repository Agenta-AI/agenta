"""The sign-in flags stored on an organization apply only on a plan with the access
entitlement, the plans whose owners can change them. On other plans, such as
Community after an open source upgrade, the deployment's sign-in methods apply."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.auth import service as auth_service_module
from oss.src.core.auth.service import AuthService


# Flags an open source install saved when it created the organization, before the
# operator turned on social sign-in.
STORED = {
    "allow_email": True,
    "allow_social": False,
    "allow_sso": False,
    "allow_root": False,
    "auto_join": False,
}


def _service(monkeypatch, *, entitled: bool, stored=STORED) -> AuthService:
    # The operator turned on social sign-in after the organization was created.
    monkeypatch.setattr(
        auth_service_module,
        "env",
        SimpleNamespace(auth=SimpleNamespace(email_enabled=True, oidc_enabled=True)),
    )

    @asynccontextmanager
    async def session():
        yield SimpleNamespace(
            execute=AsyncMock(return_value=SimpleNamespace(scalar=lambda: stored))
        )

    monkeypatch.setattr(
        auth_service_module,
        "get_transactions_engine",
        lambda: SimpleNamespace(session=session),
    )
    service = AuthService()
    monkeypatch.setattr(service, "_access_entitled", AsyncMock(return_value=entitled))
    monkeypatch.setattr(
        service, "_is_organization_owner", AsyncMock(return_value=False)
    )
    service.identities_dao = SimpleNamespace(
        list_by_user=AsyncMock(return_value=[SimpleNamespace(method="social:google")])
    )
    return service


@pytest.mark.asyncio
async def test_social_sign_in_opens_the_organization_without_access_entitlement(
    monkeypatch,
):
    service = _service(monkeypatch, entitled=False)

    result = await service.check_organization_access(
        uuid4(), uuid4(), ["social:google"]
    )

    assert result is None


@pytest.mark.asyncio
async def test_stored_flags_apply_with_access_entitlement(monkeypatch):
    service = _service(monkeypatch, entitled=True)

    result = await service.check_organization_access(
        uuid4(), uuid4(), ["social:google"]
    )

    assert result["error"] == "AUTH_UPGRADE_REQUIRED"


@pytest.mark.asyncio
async def test_only_email_and_social_flags_follow_the_deployment(monkeypatch):
    stored = {**STORED, "allow_root": True, "allow_sso": True, "auto_join": True}
    service = _service(monkeypatch, entitled=False, stored=stored)

    flags = await service._get_organization_flags(uuid4())

    assert flags == {
        "allow_email": True,
        "allow_social": True,
        "allow_sso": True,
        "allow_root": True,
        "auto_join": True,
    }
