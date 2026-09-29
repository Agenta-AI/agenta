"""Per-purpose signing keys and the placeholder check."""

import pytest

from oss.src.utils import crypting
from oss.src.utils.env import env


def test_each_label_gets_its_own_key(monkeypatch):
    monkeypatch.setattr(env.agenta, "crypt_key", "a-test-crypt-key")
    scope = crypting.derive_key("agenta/app-scope/v1")
    share = crypting.derive_key("agenta/app-share/v1")
    assert scope != share and len(scope) == len(share) == 32


def test_the_placeholder_key_is_recognised(monkeypatch):
    monkeypatch.setattr(env.agenta, "crypt_key", "replace-me")
    assert crypting.is_default_crypt_key()
    monkeypatch.setattr(env.agenta, "crypt_key", "a-test-crypt-key")
    assert not crypting.is_default_crypt_key()


def test_signed_claims_round_trip_and_stay_bound_to_their_label(monkeypatch):
    monkeypatch.setattr(env.agenta, "crypt_key", "a-test-crypt-key")
    token = crypting.sign_claims("agenta/app-scope/v1", {"p": "x"})
    assert crypting.verify_claims("agenta/app-scope/v1", token) == {"p": "x"}
    with pytest.raises(ValueError):
        crypting.verify_claims("agenta/app-share/v1", token)


@pytest.mark.parametrize("token", ["", "abc", "a.b.c", "eyJ9.é", "é.sig"])
def test_a_malformed_token_is_a_value_error_not_a_crash(monkeypatch, token):
    monkeypatch.setattr(env.agenta, "crypt_key", "a-test-crypt-key")
    with pytest.raises(ValueError):
        crypting.verify_claims("agenta/app-scope/v1", token)
