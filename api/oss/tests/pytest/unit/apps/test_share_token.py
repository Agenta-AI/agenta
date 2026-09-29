"""Share tokens: signed, nonce-revoked, and never interchangeable with scope tokens."""

from uuid import uuid4

import pytest

from oss.src.core.apps import share_token
from oss.src.core.apps.scope_token import mint as mint_scope
from oss.src.core.apps.share_token import (
    ShareTokenInvalid,
    SharingDisabled,
    mint,
    parse,
)

PROJECT = uuid4()
MOUNT = uuid4()


@pytest.fixture(autouse=True)
def _real_key(monkeypatch):
    from oss.src.utils.env import env

    monkeypatch.setattr(env.agenta, "crypt_key", "a-test-crypt-key")


def _token(nonce="n1"):
    return mint(project_id=PROJECT, mount_id=MOUNT, app_path="apps/board", nonce=nonce)


def test_round_trips_its_claims():
    claims = parse(_token())
    assert (claims.project_id, claims.mount_id, claims.app_path, claims.nonce) == (
        PROJECT,
        MOUNT,
        "apps/board",
        "n1",
    )


def test_rejects_a_tampered_token():
    token = _token()
    with pytest.raises(ShareTokenInvalid):
        parse(token[:-1] + ("A" if token[-1] != "A" else "B"))


def test_rejects_a_scope_token():
    scope, _ = mint_scope(
        project_id=PROJECT, mount_id=MOUNT, prefix="apps/board", level="read"
    )
    with pytest.raises(ShareTokenInvalid):
        parse(scope)


@pytest.mark.parametrize("junk", ["", "abc", "a.b.c", "!!!.???"])
def test_rejects_malformed_input(junk):
    with pytest.raises(ShareTokenInvalid):
        parse(junk)


def test_a_new_nonce_makes_a_different_link():
    assert _token("n1") != _token("n2")


def test_the_placeholder_key_disables_sharing(monkeypatch):
    token = _token()
    monkeypatch.setattr(share_token, "is_default_crypt_key", lambda: True)
    with pytest.raises(SharingDisabled):
        _token()
    with pytest.raises(SharingDisabled):
        parse(token)
