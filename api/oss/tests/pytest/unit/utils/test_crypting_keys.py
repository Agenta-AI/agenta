"""Per-purpose signing keys and the placeholder check."""

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
