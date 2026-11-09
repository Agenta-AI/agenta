"""The plan order without Stripe: a valid license key, else `self_hosted_community`."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from oss.src.utils.env import env

from ee.src.core.licenses import keys
from ee.src.core.licenses.service import LicensesService
from ee.src.core.licenses.types import (
    InvalidLicenseKey,
    LicenseKeyInEnvironment,
    StoredLicense,
)

from .conftest import sign_key

COMMUNITY = "self_hosted_community"
ENTERPRISE = "self_hosted_enterprise"


def _service(stored_key=None) -> LicensesService:
    dao = SimpleNamespace(
        read=AsyncMock(
            return_value=(
                StoredLicense(
                    key_id=uuid4(),
                    key=stored_key,
                    created_at=datetime.now(timezone.utc),
                    created_by_id=uuid4(),
                )
                if stored_key
                else None
            )
        ),
        replace=AsyncMock(),
    )
    return LicensesService(licenses_dao=dao)


@pytest.mark.asyncio
async def test_no_key_runs_on_the_community_plan(self_hosted, signing_key):
    service = _service()

    assert await service.active_license() is None
    assert await service.instance_plan() == COMMUNITY


@pytest.mark.asyncio
async def test_a_valid_stored_key_gives_its_plan(self_hosted, signing_key):
    service = _service(sign_key(signing_key, plan=ENTERPRISE))

    assert await service.instance_plan() == ENTERPRISE
    state = await service.read_state()
    assert state.source == "database"


@pytest.mark.asyncio
async def test_an_expired_key_falls_back_to_community(self_hosted, signing_key):
    expired = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    service = _service(sign_key(signing_key, expires_at=expired))

    assert await service.active_license() is None
    assert await service.instance_plan() == COMMUNITY
    # The License page still shows the expired key.
    assert (await service.read_state()).license is not None


@pytest.mark.asyncio
async def test_a_key_with_a_bad_signature_falls_back_to_community(
    self_hosted, signing_key
):
    service = _service(sign_key(Ed25519PrivateKey.generate(), plan=ENTERPRISE))

    assert await service.instance_plan() == COMMUNITY
    assert (await service.read_state()).license is None


@pytest.mark.asyncio
async def test_a_refused_key_falls_back_to_community(
    self_hosted, signing_key, monkeypatch
):
    key_id = str(uuid4())
    monkeypatch.setattr(keys, "REVOKED_KEY_IDS", frozenset({key_id}))
    service = _service(sign_key(signing_key, key_id=key_id, plan=ENTERPRISE))

    assert await service.instance_plan() == COMMUNITY


@pytest.mark.asyncio
async def test_the_environment_key_wins_over_the_stored_key(
    self_hosted, signing_key, monkeypatch
):
    monkeypatch.setattr(
        env.license, "key", sign_key(signing_key, plan="self_hosted_registered")
    )
    service = _service(sign_key(signing_key, plan=ENTERPRISE))

    assert await service.instance_plan() == "self_hosted_registered"
    assert (await service.read_state()).source == "environment"
    service.licenses_dao.read.assert_not_awaited()


@pytest.mark.asyncio
async def test_activate_stores_a_valid_key(self_hosted, signing_key):
    service = _service()
    user_id = uuid4()
    text = sign_key(signing_key)

    state = await service.activate(key=f"  {text}\n", user_id=user_id)

    assert state.source == "database"
    service.licenses_dao.replace.assert_awaited_once_with(
        key_id=state.license.key_id, key=text, created_by_id=user_id
    )


@pytest.mark.asyncio
async def test_activate_refuses_an_expired_key(self_hosted, signing_key):
    service = _service()
    expired = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    with pytest.raises(InvalidLicenseKey):
        await service.activate(
            key=sign_key(signing_key, expires_at=expired), user_id=uuid4()
        )
    service.licenses_dao.replace.assert_not_awaited()


@pytest.mark.asyncio
async def test_activate_refuses_a_bad_signature(self_hosted, signing_key):
    service = _service()

    with pytest.raises(InvalidLicenseKey):
        await service.activate(
            key=sign_key(Ed25519PrivateKey.generate()), user_id=uuid4()
        )
    service.licenses_dao.replace.assert_not_awaited()


@pytest.mark.asyncio
async def test_activate_refuses_when_the_key_is_set_in_the_environment(
    self_hosted, signing_key, monkeypatch
):
    monkeypatch.setattr(env.license, "key", sign_key(signing_key))
    service = _service()

    with pytest.raises(LicenseKeyInEnvironment):
        await service.activate(key=sign_key(signing_key), user_id=uuid4())
    service.licenses_dao.replace.assert_not_awaited()
