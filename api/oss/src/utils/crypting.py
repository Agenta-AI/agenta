"""Symmetric encryption helpers for secrets.

Uses `cryptography.fernet.Fernet` for authenticated encryption.
AGENTA_CRYPT_KEY can be any non-empty string and is deterministically
derived to a Fernet key via SHA-256 + base64url encoding.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from oss.src.utils.env import env


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
