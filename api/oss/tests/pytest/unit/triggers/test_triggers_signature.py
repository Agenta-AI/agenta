"""Unit tests for Composio webhook signature verification.

Pure HMAC logic, no network or database. The acceptance suite only exercises
this path when ``COMPOSIO_WEBHOOK_SECRET`` is present in the runner; these tests
pin the security contract (forged/missing signatures rejected) unconditionally.
"""

import hashlib
import hmac

from unittest.mock import patch

from oss.src.apis.fastapi.triggers.router import _verify_composio_signature

_SECRET = "whsec_test_secret"
_WEBHOOK_ID = "wh-1"
_TIMESTAMP = "1700000000"
_BODY = b'{"type":"github.issue.opened"}'

_ENV_PATH = "oss.src.apis.fastapi.triggers.router.env"


def _sign(secret: str, webhook_id: str, timestamp: str, body: bytes) -> str:
    signed = f"{webhook_id}.{timestamp}.{body.decode('utf-8')}"
    return hmac.new(
        secret.encode("utf-8"),
        signed.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


class _Env:
    """Minimal stand-in for the shared env object's composio config."""

    class composio:  # noqa: N801 - mirrors env.composio attribute access
        webhook_secret = None


def _env_with_secret(secret):
    env = _Env()
    env.composio.webhook_secret = secret
    return env


class TestVerifyComposioSignature:
    def test_unset_secret_is_noop_accept(self):
        with patch(_ENV_PATH, _env_with_secret(None)):
            assert _verify_composio_signature(body=_BODY, headers={}) is True

    def test_valid_signature_accepted(self):
        sig = _sign(_SECRET, _WEBHOOK_ID, _TIMESTAMP, _BODY)
        headers = {
            "webhook-signature": sig,
            "webhook-id": _WEBHOOK_ID,
            "webhook-timestamp": _TIMESTAMP,
        }
        with patch(_ENV_PATH, _env_with_secret(_SECRET)):
            assert _verify_composio_signature(body=_BODY, headers=headers) is True

    def test_valid_signature_with_versioned_prefix_accepted(self):
        # Composio sends "v1,<sig>"; only the last comma-part is the digest.
        sig = _sign(_SECRET, _WEBHOOK_ID, _TIMESTAMP, _BODY)
        headers = {
            "webhook-signature": f"v1,{sig}",
            "webhook-id": _WEBHOOK_ID,
            "webhook-timestamp": _TIMESTAMP,
        }
        with patch(_ENV_PATH, _env_with_secret(_SECRET)):
            assert _verify_composio_signature(body=_BODY, headers=headers) is True

    def test_forged_signature_rejected(self):
        headers = {
            "webhook-signature": "deadbeef",
            "webhook-id": _WEBHOOK_ID,
            "webhook-timestamp": _TIMESTAMP,
        }
        with patch(_ENV_PATH, _env_with_secret(_SECRET)):
            assert _verify_composio_signature(body=_BODY, headers=headers) is False

    def test_missing_signature_header_rejected(self):
        headers = {"webhook-id": _WEBHOOK_ID, "webhook-timestamp": _TIMESTAMP}
        with patch(_ENV_PATH, _env_with_secret(_SECRET)):
            assert _verify_composio_signature(body=_BODY, headers=headers) is False

    def test_tampered_body_rejected(self):
        sig = _sign(_SECRET, _WEBHOOK_ID, _TIMESTAMP, _BODY)
        headers = {
            "webhook-signature": sig,
            "webhook-id": _WEBHOOK_ID,
            "webhook-timestamp": _TIMESTAMP,
        }
        with patch(_ENV_PATH, _env_with_secret(_SECRET)):
            assert (
                _verify_composio_signature(body=b'{"type":"tampered"}', headers=headers)
                is False
            )

    def test_x_composio_signature_header_alias(self):
        sig = _sign(_SECRET, _WEBHOOK_ID, _TIMESTAMP, _BODY)
        headers = {
            "x-composio-signature": sig,
            "webhook-id": _WEBHOOK_ID,
            "webhook-timestamp": _TIMESTAMP,
        }
        with patch(_ENV_PATH, _env_with_secret(_SECRET)):
            assert _verify_composio_signature(body=_BODY, headers=headers) is True
