"""Unit tests for Composio webhook signature verification.

Pure HMAC logic, no network or database. Verification lives on
``TriggersService.verify_signature``; the secret is resolved from Composio
(cached encrypted in Redis), so here the resolver is stubbed. The contract:
forged/missing signatures and an unresolvable secret are all rejected.
"""

import hashlib
import hmac

from unittest.mock import AsyncMock, MagicMock

from oss.src.core.triggers.service import TriggersService

_SECRET = "whsec_test_secret"
_WEBHOOK_ID = "wh-1"
_TIMESTAMP = "1700000000"
_BODY = b'{"type":"github.issue.opened"}'


def _sign(secret: str, webhook_id: str, timestamp: str, body: bytes) -> str:
    signed = f"{webhook_id}.{timestamp}.{body.decode('utf-8')}"
    return hmac.new(
        secret.encode("utf-8"),
        signed.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _service(*, secret):
    """A TriggersService whose secret resolver returns ``secret``."""
    service = TriggersService(
        adapter_registry=MagicMock(),
        catalog_service=MagicMock(),
    )
    service.webhook_secret_resolver.resolve = AsyncMock(return_value=secret)
    return service


def _headers(sig):
    return {
        "webhook-signature": sig,
        "webhook-id": _WEBHOOK_ID,
        "webhook-timestamp": _TIMESTAMP,
    }


class TestVerifySignature:
    async def test_valid_signature_accepted(self):
        service = _service(secret=_SECRET)
        sig = _sign(_SECRET, _WEBHOOK_ID, _TIMESTAMP, _BODY)
        assert await service.verify_signature(body=_BODY, headers=_headers(sig)) is True

    async def test_valid_signature_with_versioned_prefix_accepted(self):
        # Composio sends "v1,<sig>"; only the last comma-part is the digest.
        service = _service(secret=_SECRET)
        sig = _sign(_SECRET, _WEBHOOK_ID, _TIMESTAMP, _BODY)
        headers = _headers(f"v1,{sig}")
        assert await service.verify_signature(body=_BODY, headers=headers) is True

    async def test_forged_signature_rejected(self):
        service = _service(secret=_SECRET)
        assert (
            await service.verify_signature(body=_BODY, headers=_headers("deadbeef"))
            is False
        )

    async def test_missing_signature_header_rejected(self):
        service = _service(secret=_SECRET)
        headers = {"webhook-id": _WEBHOOK_ID, "webhook-timestamp": _TIMESTAMP}
        assert await service.verify_signature(body=_BODY, headers=headers) is False

    async def test_tampered_body_rejected(self):
        service = _service(secret=_SECRET)
        sig = _sign(_SECRET, _WEBHOOK_ID, _TIMESTAMP, _BODY)
        assert (
            await service.verify_signature(
                body=b'{"type":"tampered"}', headers=_headers(sig)
            )
            is False
        )

    async def test_unresolvable_secret_rejected(self):
        service = _service(secret=None)
        sig = _sign(_SECRET, _WEBHOOK_ID, _TIMESTAMP, _BODY)
        assert (
            await service.verify_signature(body=_BODY, headers=_headers(sig)) is False
        )

    async def test_x_composio_signature_header_alias(self):
        service = _service(secret=_SECRET)
        sig = _sign(_SECRET, _WEBHOOK_ID, _TIMESTAMP, _BODY)
        headers = {
            "x-composio-signature": sig,
            "webhook-id": _WEBHOOK_ID,
            "webhook-timestamp": _TIMESTAMP,
        }
        assert await service.verify_signature(body=_BODY, headers=headers) is True

    async def test_mismatch_triggers_one_refresh_retry(self):
        # First resolve returns a wrong secret; the forced refresh returns the
        # right one — the valid signature must then be accepted.
        service = _service(secret=_SECRET)
        service.webhook_secret_resolver.resolve = AsyncMock(
            side_effect=["wrong_secret", _SECRET]
        )
        sig = _sign(_SECRET, _WEBHOOK_ID, _TIMESTAMP, _BODY)
        assert await service.verify_signature(body=_BODY, headers=_headers(sig)) is True
        assert service.webhook_secret_resolver.resolve.await_count == 2
