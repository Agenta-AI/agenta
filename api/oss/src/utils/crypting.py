"""Lightweight symmetric encrypt/decrypt using Python stdlib only.

Uses HMAC-SHA256 as a keystream generator (stream cipher) with a random
16-byte nonce to ensure non-deterministic ciphertext. Intended for
lightly protecting secrets at rest in Redis — not a replacement for
full-fat authenticated encryption.

Key is derived from env.agenta.crypt_key via SHA-256.
Output format: base64url(nonce[16] + ciphertext)
"""

import base64
import hashlib
import hmac
import os

from oss.src.utils.env import env


def _derive_key() -> bytes:
    return hashlib.sha256(env.agenta.crypt_key.encode()).digest()


def _keystream(key_bytes: bytes, nonce: bytes, length: int) -> bytes:
    stream = b""
    counter = 0
    while len(stream) < length:
        stream += hmac.new(
            key_bytes,
            nonce + counter.to_bytes(4, "big"),
            hashlib.sha256,
        ).digest()
        counter += 1
    return stream[:length]


def encrypt(value: str) -> str:
    key_bytes = _derive_key()
    nonce = os.urandom(16)
    plaintext = value.encode()
    keystream = _keystream(key_bytes, nonce, len(plaintext))
    ciphertext = bytes(a ^ b for a, b in zip(plaintext, keystream))
    return base64.urlsafe_b64encode(nonce + ciphertext).decode()


def decrypt(value: str) -> str:
    key_bytes = _derive_key()
    data = base64.urlsafe_b64decode(value.encode())
    nonce = data[:16]
    ciphertext = data[16:]
    keystream = _keystream(key_bytes, nonce, len(ciphertext))
    plaintext = bytes(a ^ b for a, b in zip(ciphertext, keystream))
    return plaintext.decode()
