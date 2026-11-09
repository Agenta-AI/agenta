import base64
import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from oss.src.utils.env import env

from ee.src.core.licenses import keys


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def sign_key(private_key: Ed25519PrivateKey, **fields) -> str:
    """A signed key; a field set to `...` is left out of the payload."""
    payload = {
        "key_id": str(uuid4()),
        "plan": "self_hosted_enterprise",
        "customer": "Acme",
        "seats": 10,
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=365)).isoformat(),
        "telemetry": "required",
    }
    for name, value in fields.items():
        if value is ...:
            payload.pop(name, None)
        else:
            payload[name] = value
    body = _b64url(json.dumps(payload).encode("utf-8"))
    signature = _b64url(private_key.sign(body.encode("ascii")))
    return f"agenta_license_v1.{body}.{signature}"


@pytest.fixture
def signing_key(monkeypatch) -> Ed25519PrivateKey:
    """A throwaway key pair made for the test; its public half replaces `PUBLIC_KEY`."""
    private_key = Ed25519PrivateKey.generate()
    public_pem = (
        private_key.public_key()
        .public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("ascii")
    )
    monkeypatch.setattr(keys, "PUBLIC_KEY", public_pem)
    return private_key


@pytest.fixture
def self_hosted(monkeypatch):
    monkeypatch.setattr(env.stripe, "api_key", None)
    monkeypatch.setattr(env.license, "key", None)


@pytest.fixture
def cloud(monkeypatch):
    monkeypatch.setattr(env.stripe, "api_key", "sk_test_unit")
