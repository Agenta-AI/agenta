"""Unit tests for Composio webhook signature verification.

Pure HMAC logic, no network. Verification lives on
``TriggersService.verify_signature``; the secret resolver and the Redis-backed
replay-dedup cache engine are both stubbed here. The contract: forged/missing
signatures, an unresolvable secret, a stale timestamp, and a replayed
``webhook-id`` are all rejected; a fresh, first-seen, correctly-signed request
is accepted.
"""

import hashlib
import hmac
import time
from unittest.mock import AsyncMock, MagicMock, patch

from oss.src.core.triggers.service import TriggersService

_SECRET = "whsec_test_secret"
_WEBHOOK_ID = "wh-1"
_BODY = b'{"type":"github.issue.opened"}'


def _now_timestamp() -> str:
    return str(int(time.time()))


def _sign(secret: str, webhook_id: str, timestamp: str, body: bytes) -> str:
    signed = f"{webhook_id}.{timestamp}.{body.decode('utf-8')}"
    return hmac.new(
        secret.encode("utf-8"),
        signed.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _fake_cache_engine(*, claim_result=True):
    """A cache engine stub whose `set(nx=True, ...)` simulates first-seen/replay."""
    engine = MagicMock()
    engine.set = AsyncMock(return_value=(object() if claim_result else None))
    return engine


def _service(*, secret, claim_result=True):
    """A TriggersService whose secret resolver returns ``secret`` and whose
    dedup cache engine claims (or refuses to claim) ``webhook_id``."""
    service = TriggersService(
        adapter_registry=MagicMock(),
        catalog_service=MagicMock(),
        triggers_dao=MagicMock(),
        connections_service=MagicMock(),
        workflows_service=MagicMock(),
    )
    service.webhook_secret_resolver.resolve = AsyncMock(return_value=secret)
    return service, _fake_cache_engine(claim_result=claim_result)


def _headers(sig, *, webhook_id=_WEBHOOK_ID, timestamp=None):
    return {
        "webhook-signature": sig,
        "webhook-id": webhook_id,
        "webhook-timestamp": timestamp or _now_timestamp(),
    }


class TestVerifySignature:
    async def test_valid_signature_accepted(self):
        service, cache = _service(secret=_SECRET)
        timestamp = _now_timestamp()
        sig = _sign(_SECRET, _WEBHOOK_ID, timestamp, _BODY)
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert (
                await service.verify_signature(
                    body=_BODY, headers=_headers(sig, timestamp=timestamp)
                )
                is True
            )

    async def test_valid_signature_with_versioned_prefix_accepted(self):
        # Composio sends "v1,<sig>"; only the last comma-part is the digest.
        service, cache = _service(secret=_SECRET)
        timestamp = _now_timestamp()
        sig = _sign(_SECRET, _WEBHOOK_ID, timestamp, _BODY)
        headers = _headers(f"v1,{sig}", timestamp=timestamp)
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert await service.verify_signature(body=_BODY, headers=headers) is True

    async def test_forged_signature_rejected(self):
        service, cache = _service(secret=_SECRET)
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert (
                await service.verify_signature(body=_BODY, headers=_headers("deadbeef"))
                is False
            )

    async def test_missing_signature_header_rejected(self):
        service, cache = _service(secret=_SECRET)
        headers = {
            "webhook-id": _WEBHOOK_ID,
            "webhook-timestamp": _now_timestamp(),
        }
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert await service.verify_signature(body=_BODY, headers=headers) is False

    async def test_tampered_body_rejected(self):
        service, cache = _service(secret=_SECRET)
        timestamp = _now_timestamp()
        sig = _sign(_SECRET, _WEBHOOK_ID, timestamp, _BODY)
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert (
                await service.verify_signature(
                    body=b'{"type":"tampered"}',
                    headers=_headers(sig, timestamp=timestamp),
                )
                is False
            )

    async def test_unresolvable_secret_rejected(self):
        service, cache = _service(secret=None)
        timestamp = _now_timestamp()
        sig = _sign(_SECRET, _WEBHOOK_ID, timestamp, _BODY)
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert (
                await service.verify_signature(
                    body=_BODY, headers=_headers(sig, timestamp=timestamp)
                )
                is False
            )

    async def test_x_composio_signature_header_alias(self):
        service, cache = _service(secret=_SECRET)
        timestamp = _now_timestamp()
        sig = _sign(_SECRET, _WEBHOOK_ID, timestamp, _BODY)
        headers = {
            "x-composio-signature": sig,
            "webhook-id": _WEBHOOK_ID,
            "webhook-timestamp": timestamp,
        }
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert await service.verify_signature(body=_BODY, headers=headers) is True

    async def test_mismatch_triggers_one_refresh_retry(self):
        # First resolve returns a wrong secret; the forced refresh returns the
        # right one — the valid signature must then be accepted.
        service, cache = _service(secret=_SECRET)
        service.webhook_secret_resolver.resolve = AsyncMock(
            side_effect=["wrong_secret", _SECRET]
        )
        timestamp = _now_timestamp()
        sig = _sign(_SECRET, _WEBHOOK_ID, timestamp, _BODY)
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert (
                await service.verify_signature(
                    body=_BODY, headers=_headers(sig, timestamp=timestamp)
                )
                is True
            )
        assert service.webhook_secret_resolver.resolve.await_count == 2


class TestReplayAndFreshness:
    async def test_stale_timestamp_rejected(self):
        # Well outside the default 300s window.
        service, cache = _service(secret=_SECRET)
        stale_timestamp = str(int(time.time()) - 3600)
        sig = _sign(_SECRET, _WEBHOOK_ID, stale_timestamp, _BODY)
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert (
                await service.verify_signature(
                    body=_BODY, headers=_headers(sig, timestamp=stale_timestamp)
                )
                is False
            )
        # Freshness is checked before the secret is ever resolved.
        service.webhook_secret_resolver.resolve.assert_not_awaited()

    async def test_future_timestamp_outside_window_rejected(self):
        service, cache = _service(secret=_SECRET)
        future_timestamp = str(int(time.time()) + 3600)
        sig = _sign(_SECRET, _WEBHOOK_ID, future_timestamp, _BODY)
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert (
                await service.verify_signature(
                    body=_BODY, headers=_headers(sig, timestamp=future_timestamp)
                )
                is False
            )

    async def test_missing_timestamp_rejected(self):
        service, cache = _service(secret=_SECRET)
        sig = _sign(_SECRET, _WEBHOOK_ID, "", _BODY)
        headers = {"webhook-signature": sig, "webhook-id": _WEBHOOK_ID}
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert await service.verify_signature(body=_BODY, headers=headers) is False

    async def test_non_numeric_timestamp_rejected(self):
        service, cache = _service(secret=_SECRET)
        sig = _sign(_SECRET, _WEBHOOK_ID, "not-a-number", _BODY)
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert (
                await service.verify_signature(
                    body=_BODY,
                    headers=_headers(sig, timestamp="not-a-number"),
                )
                is False
            )

    async def test_duplicate_webhook_id_within_window_rejected(self):
        # The cache engine's NX-set refuses the claim -> already seen.
        service, cache = _service(secret=_SECRET, claim_result=False)
        timestamp = _now_timestamp()
        sig = _sign(_SECRET, _WEBHOOK_ID, timestamp, _BODY)
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert (
                await service.verify_signature(
                    body=_BODY, headers=_headers(sig, timestamp=timestamp)
                )
                is False
            )

    async def test_dedup_claims_only_after_signature_verifies(self):
        # A forged signature must not consume the webhook_id's replay slot.
        service, cache = _service(secret=_SECRET)
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            await service.verify_signature(body=_BODY, headers=_headers("deadbeef"))
        cache.set.assert_not_awaited()

    async def test_fresh_first_seen_request_passes(self):
        service, cache = _service(secret=_SECRET, claim_result=True)
        timestamp = _now_timestamp()
        sig = _sign(_SECRET, _WEBHOOK_ID, timestamp, _BODY)
        with patch(
            "oss.src.core.triggers.service.get_cache_engine", return_value=cache
        ):
            assert (
                await service.verify_signature(
                    body=_BODY, headers=_headers(sig, timestamp=timestamp)
                )
                is True
            )
        cache.set.assert_awaited_once()
        _args, kwargs = cache.set.await_args
        assert kwargs.get("nx") is True
