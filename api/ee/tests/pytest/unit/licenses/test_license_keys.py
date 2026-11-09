from uuid import uuid4

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from ee.src.core.licenses import keys
from ee.src.core.licenses.keys import parse_license_key
from ee.src.core.licenses.types import InvalidLicenseKey

from .conftest import sign_key


def test_a_signed_key_parses(signing_key):
    key_id = uuid4()
    license_key = parse_license_key(
        sign_key(signing_key, key_id=str(key_id), seats=None, expires_at=None)
    )

    assert license_key.key_id == key_id
    assert license_key.plan == "self_hosted_enterprise"
    assert license_key.customer == "Acme"
    assert license_key.seats is None
    assert license_key.expires_at is None
    assert license_key.telemetry == "required"


def test_missing_telemetry_means_required_and_unknown_fields_are_ignored(signing_key):
    text = sign_key(signing_key, telemetry=..., extra_field="ignored")
    assert parse_license_key(text).telemetry == "required"


def test_a_key_signed_by_another_key_pair_is_refused(signing_key):
    other = Ed25519PrivateKey.generate()

    with pytest.raises(InvalidLicenseKey) as error:
        parse_license_key(sign_key(other))

    assert error.value.reason == "signature"


def test_a_changed_payload_is_refused(signing_key):
    prefix, payload, signature = sign_key(signing_key).split(".")
    changed = sign_key(signing_key, plan="self_hosted_registered").split(".")[1]

    with pytest.raises(InvalidLicenseKey):
        parse_license_key(f"{prefix}.{changed}.{signature}")
    with pytest.raises(InvalidLicenseKey):
        parse_license_key(f"{prefix}.{payload}x.{signature}")


def test_a_refused_key_id_is_refused(signing_key, monkeypatch):
    key_id = str(uuid4())
    monkeypatch.setattr(keys, "REVOKED_KEY_IDS", frozenset({key_id}))

    with pytest.raises(InvalidLicenseKey) as error:
        parse_license_key(sign_key(signing_key, key_id=key_id))

    assert error.value.reason == "refused"


def test_a_plan_outside_the_plan_table_is_refused(signing_key):
    with pytest.raises(InvalidLicenseKey) as error:
        parse_license_key(sign_key(signing_key, plan="not_a_plan"))

    assert error.value.reason == "plan"


@pytest.mark.parametrize(
    "text",
    [
        "",
        "agenta_license_v1",
        "agenta_license_v1.abc",
        "agenta_license_v2.abc.def",
        "agenta_license_v1.ab c.def",
        "agenta_license_v1.abc.de=f",
    ],
)
def test_a_malformed_key_is_refused(signing_key, text):
    with pytest.raises(InvalidLicenseKey):
        parse_license_key(text)


def test_no_key_checks_without_a_public_key(signing_key, monkeypatch):
    text = sign_key(signing_key)
    monkeypatch.setattr(keys, "PUBLIC_KEY", "")

    with pytest.raises(InvalidLicenseKey) as error:
        parse_license_key(text)

    assert error.value.reason == "no_public_key"


def test_the_shipped_public_key_is_a_placeholder_or_an_ed25519_key():
    # The release replaces the placeholder with Agenta's public key.
    if keys.PUBLIC_KEY:
        assert keys._public_key() is not None
