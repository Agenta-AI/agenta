"""Symmetric encryption helpers for secrets.

Uses `cryptography.fernet.Fernet` for authenticated encryption.
AGENTA_CRYPT_KEY can be any non-empty string and is deterministically
derived to a Fernet key via SHA-256 + base64url encoding.
"""

import base64
import hashlib
import hmac
import json
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from oss.src.utils.env import env


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    crypt_key = env.agenta.crypt_key
    if not crypt_key:
        raise ValueError("AGENTA_CRYPT_KEY is required for secret encryption")
    key_material = hashlib.sha256(crypt_key.encode()).digest()
    fernet_key = base64.urlsafe_b64encode(key_material)
    return Fernet(fernet_key)


def encrypt(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return _get_fernet().decrypt(value.encode()).decode()
    except InvalidToken as e:
        raise ValueError("Invalid ciphertext") from e


_DEFAULT_CRYPT_KEY = "replace-me"


def is_default_crypt_key() -> bool:
    """True when the deployment still runs with the placeholder `AGENTA_CRYPT_KEY`."""
    return (env.agenta.crypt_key or _DEFAULT_CRYPT_KEY) == _DEFAULT_CRYPT_KEY


def derive_key(label: str) -> bytes:
    """A signing key for one purpose, so no two token types (or Fernet) share key bytes."""
    root = hashlib.sha256((env.agenta.crypt_key or "").encode()).digest()
    return hmac.new(root, label.encode(), hashlib.sha256).digest()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def sign_claims(label: str, claims: dict) -> str:
    """`<payload>.<signature>`: the claims as JSON, signed with the key for `label`. Not secret."""
    payload = json.dumps(claims, separators=(",", ":"), sort_keys=True).encode()
    signature = hmac.new(derive_key(label), payload, hashlib.sha256).digest()
    return f"{_b64(payload)}.{_b64(signature)}"


def verify_claims(label: str, token: str) -> dict:
    """The claims of a token from `sign_claims(label, ...)`. Raises `ValueError` otherwise."""
    body, dot, signature = (token or "").partition(".")
    if not dot or "." in signature:
        raise ValueError("malformed token")
    try:
        payload, given = _unb64(body), _unb64(signature)
    except ValueError as exc:  # also a non-ASCII token
        raise ValueError("malformed token") from exc
    expected = hmac.new(derive_key(label), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, given):
        raise ValueError("bad signature")
    claims = json.loads(payload)
    if not isinstance(claims, dict):
        raise ValueError("malformed token")
    return claims
