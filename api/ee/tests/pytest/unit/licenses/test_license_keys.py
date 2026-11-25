from uuid import uuid4

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from ee.src.core.licenses import keys
from ee.src.core.licenses.keys import parse_license_key
from ee.src.core.licenses.types import InvalidLicenseKey

from .conftest import REGISTRATION, RELEASE, public_key_line, sign_key


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
        "agenta_license_v1.\u00e9.AA",
        "agenta_license_v1.abc.\u00e9",
        "agenta_license_v1.e30.AA",
    ],
)
def test_a_malformed_key_is_refused(signing_key, text):
    with pytest.raises(InvalidLicenseKey):
        parse_license_key(text)


def test_the_release_key_signs_any_plan(signing_key):
    for plan in ("self_hosted_enterprise", "self_hosted_registered", "cloud"):
        license_key = parse_license_key(sign_key(signing_key, plan=plan))
        assert license_key.plan == plan
        assert license_key.signing_key_id == RELEASE


def test_the_registration_key_signs_the_registered_plan(registration_key):
    license_key = parse_license_key(
        sign_key(
            registration_key,
            signing_key_id=REGISTRATION,
            plan="self_hosted_registered",
        )
    )

    assert license_key.plan == "self_hosted_registered"
    assert license_key.signing_key_id == REGISTRATION


@pytest.mark.parametrize("plan", ["self_hosted_enterprise", "cloud", "not_a_plan"])
def test_the_registration_key_cannot_sign_another_plan(registration_key, plan):
    with pytest.raises(InvalidLicenseKey) as error:
        parse_license_key(
            sign_key(registration_key, signing_key_id=REGISTRATION, plan=plan)
        )

    assert error.value.reason == "signing_key_plan"


def test_a_registration_signature_under_the_release_id_is_refused(
    signing_key, registration_key
):
    with pytest.raises(InvalidLicenseKey) as error:
        parse_license_key(sign_key(registration_key, signing_key_id=RELEASE))

    assert error.value.reason == "signature"


@pytest.mark.parametrize("signing_key_id", ["release-9", "", 1, None, ...])
def test_an_unknown_or_missing_signing_key_id_is_refused(signing_key, signing_key_id):
    with pytest.raises(InvalidLicenseKey) as error:
        parse_license_key(sign_key(signing_key, signing_key_id=signing_key_id))

    assert error.value.reason == "signing_key"


def test_a_second_release_key_keeps_keys_from_the_first_valid(signing_key, monkeypatch):
    issued = sign_key(signing_key)
    new_release = Ed25519PrivateKey.generate()
    monkeypatch.setitem(
        keys.SIGNING_KEYS,
        "release-2",
        keys.SigningKey(public_key=public_key_line(new_release)),
    )

    assert parse_license_key(issued).signing_key_id == RELEASE
    assert (
        parse_license_key(
            sign_key(new_release, signing_key_id="release-2")
        ).signing_key_id
        == "release-2"
    )


def test_no_key_checks_without_a_public_key(signing_key, monkeypatch):
    text = sign_key(signing_key)
    monkeypatch.setitem(keys.SIGNING_KEYS, RELEASE, keys.SigningKey(public_key=""))

    with pytest.raises(InvalidLicenseKey) as error:
        parse_license_key(text)

    assert error.value.reason == "no_public_key"


def test_the_shipped_signing_keys_are_placeholders_or_ed25519_keys():
    # The release replaces the placeholders with Agenta's public keys.
    assert set(keys.SIGNING_KEYS) == {RELEASE, REGISTRATION}
    assert keys.SIGNING_KEYS[RELEASE].plans is None
    assert keys.SIGNING_KEYS[REGISTRATION].plans == frozenset(
        {"self_hosted_registered"}
    )
    for signing_key in keys.SIGNING_KEYS.values():
        if signing_key.public_key:
            assert keys._public_key(signing_key) is not None
