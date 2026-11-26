"""Cloud is a license key with plan `cloud` in AGENTA_LICENSE_KEY. Stripe is only billing."""

import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from oss.src.utils.env import env

from ee.src.core.licenses.cloud import is_cloud, validate_cloud_license
from ee.src.core.licenses.keys import parse_license_key
from ee.src.core.licenses.service import LicensesService
from ee.src.core.licenses.types import InvalidLicenseKey

from .conftest import REGISTRATION, public_key_line, sign_key


def _cloud_key(private_key, **fields) -> str:
    return sign_key(
        private_key,
        plan="cloud",
        customer="Agenta cloud",
        seats=...,
        expires_at=...,
        **fields,
    )


def test_a_cloud_key_without_expiry_is_valid(signing_key):
    license_key = parse_license_key(_cloud_key(signing_key))

    assert license_key.plan == "cloud"
    assert license_key.expires_at is None
    assert license_key.is_expired() is False


def test_a_cloud_key_with_stripe_is_cloud(cloud):
    assert is_cloud() is True
    validate_cloud_license()


def test_stripe_alone_is_not_cloud(self_hosted, monkeypatch):
    monkeypatch.setattr(env.stripe, "api_key", "sk_test_unit")

    assert is_cloud() is False


def test_an_enterprise_key_is_not_cloud(self_hosted, signing_key, monkeypatch):
    monkeypatch.setattr(env.license, "key", sign_key(signing_key))

    assert is_cloud() is False


def test_a_cloud_key_signed_by_another_key_pair_is_not_cloud(
    self_hosted, signing_key, monkeypatch
):
    monkeypatch.setattr(env.license, "key", _cloud_key(Ed25519PrivateKey.generate()))

    assert is_cloud() is False


def test_a_cloud_key_signed_by_the_registration_key_is_not_cloud(
    self_hosted, registration_key, monkeypatch
):
    monkeypatch.setattr(
        env.license,
        "key",
        _cloud_key(registration_key, signing_key_id=REGISTRATION),
    )

    assert is_cloud() is False


def test_an_expired_cloud_key_is_not_cloud(self_hosted, signing_key, monkeypatch):
    expired = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    key = sign_key(signing_key, plan="cloud", expires_at=expired)
    monkeypatch.setattr(env.license, "key", key)

    assert is_cloud() is False


def test_startup_refuses_a_cloud_key_without_stripe(cloud, monkeypatch):
    monkeypatch.setattr(env.stripe, "api_key", None)

    with pytest.raises(RuntimeError, match="STRIPE_API_KEY is not set"):
        validate_cloud_license()


def test_startup_refuses_stripe_without_a_cloud_key(self_hosted, monkeypatch):
    monkeypatch.setattr(env.stripe, "api_key", "sk_test_unit")

    with pytest.raises(RuntimeError, match="not a valid cloud license key"):
        validate_cloud_license()


def test_startup_refuses_stripe_with_a_self_hosted_key(
    self_hosted, signing_key, monkeypatch
):
    monkeypatch.setattr(env.license, "key", sign_key(signing_key))
    monkeypatch.setattr(env.stripe, "api_key", "sk_test_unit")

    with pytest.raises(RuntimeError, match="not a valid cloud license key"):
        validate_cloud_license()


def test_startup_accepts_self_hosted_without_stripe(self_hosted, signing_key):
    validate_cloud_license()


@pytest.mark.asyncio
async def test_a_cloud_key_cannot_be_added_in_the_app(self_hosted, signing_key):
    dao = SimpleNamespace(read=AsyncMock(return_value=None), replace=AsyncMock())
    service = LicensesService(licenses_dao=dao)

    with pytest.raises(InvalidLicenseKey) as error:
        await service.activate(key=_cloud_key(signing_key), user_id=uuid4())

    assert error.value.reason == "plan"
    dao.replace.assert_not_awaited()


_FRESH_START = """
import sys
from ee.src.core.licenses import keys
from oss.src.utils.env import env

keys.SIGNING_KEYS["release-1"] = keys.SigningKey(public_key=sys.argv[1])
env.license.key = sys.argv[2]

from ee.src.core.access.controls import get_plans
from ee.src.core.licenses.cloud import is_cloud

assert "self_hosted_enterprise" in get_plans()
assert is_cloud() is False
"""


def test_a_fresh_process_starts_with_a_self_hosted_key_in_the_environment(
    signing_key,
):
    # The plan table is built at import and calls `is_cloud()`; only a new process
    # shows an import cycle between the two.
    api_dir = Path(__file__).resolve().parents[5]
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            _FRESH_START,
            public_key_line(signing_key),
            sign_key(signing_key),
        ],
        cwd=api_dir,
        env={**os.environ, "PYTHONPATH": str(api_dir)},
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
