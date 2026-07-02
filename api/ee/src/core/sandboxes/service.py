"""Sandbox metering service: record_usage(), E2B webhook registration, Daytona poll."""

import hashlib
import hmac
import secrets
from uuid import UUID

import httpx

from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.crypting import decrypt, encrypt
from oss.src.utils.locking import (
    acquire_lock,
    release_lock,
)
from oss.src.utils.logging import get_module_logger

from ee.src.core.access.entitlements.service import check_entitlements
from ee.src.core.access.entitlements.types import Counter
from ee.src.core.meters.service import MetersService
from ee.src.core.meters.types import MeterScope
from ee.src.core.sandboxes.dtos import SandboxUsageDTO, SandboxUsageResult
from ee.src.core.sandboxes.exceptions import (
    SandboxWebhookRegistrationError,
)

log = get_module_logger(__name__)

# Redis key namespaces
_E2B_SECRET_CACHE_NS = "sandboxes:e2b"
_E2B_SECRET_CACHE_KEY = "webhook_secret"
_E2B_SECRET_CACHE_TTL = 86400  # 24h — rotated only on explicit re-registration

# Daytona poll lock
_DAYTONA_LOCK_NS = "sandboxes:daytona"
_DAYTONA_LOCK_KEY = "poll"
_DAYTONA_LOCK_TTL = 120  # 2 min — poll should complete well within this


class SandboxMeteringService:
    def __init__(self, *, meters_service: MetersService):
        self.meters_service = meters_service

    # ------------------------------------------------------------------
    # Core: record usage for one sandbox billing event
    # ------------------------------------------------------------------

    async def record_usage(self, usage: SandboxUsageDTO) -> SandboxUsageResult:
        """Persist sandbox resource-second usage into the meters layer.

        Calls check_entitlements(cache=False) per meter so the Layer-2
        atomic adjust() runs, giving an authoritative quota check.
        The call is NON-BLOCKING in Phase 1 (quotas are soft).
        """
        org_id = usage.organization_id
        scope = MeterScope(organization_id=org_id)

        meter_deltas: list[tuple[Counter, int]] = [
            (Counter.SANDBOX_CPU_SECONDS, usage.vcpu_seconds),
            (Counter.SANDBOX_RAM_SECONDS, usage.ram_gib_seconds),
            (Counter.SANDBOX_SSD_SECONDS, usage.disk_gib_seconds),
            (Counter.SANDBOX_GPU_SECONDS, usage.gpu_seconds),
        ]

        for counter, delta in meter_deltas:
            if delta <= 0:
                continue
            try:
                # cache=False → Layer-2 hard check (atomic DB adjust).
                # Fails open on error per check_entitlements contract.
                await check_entitlements(
                    key=counter,
                    delta=delta,
                    cache=False,
                    scope=scope,
                )
            except Exception:
                log.warning(
                    "[sandboxes] check_entitlements failed for %s/%s",
                    org_id,
                    counter,
                    exc_info=True,
                )

        log.info(
            "[sandboxes] recorded provider=%s sandbox=%s org=%s "
            "vcpu_s=%d ram_s=%d disk_s=%d gpu_s=%d",
            usage.provider,
            usage.sandbox_id,
            org_id,
            usage.vcpu_seconds,
            usage.ram_gib_seconds,
            usage.disk_gib_seconds,
            usage.gpu_seconds,
        )

        return SandboxUsageResult(accepted=True, delivery_id=usage.delivery_id)

    # ------------------------------------------------------------------
    # E2B: webhook secret management
    # ------------------------------------------------------------------

    async def get_or_create_e2b_webhook_secret(self) -> str:
        """Return the E2B webhook signing secret, creating it if absent.

        Leader-elected via Redis SET NX: only one container writes the
        secret; all others read the encrypted value from Redis.
        """
        cached = await get_cache(
            namespace=_E2B_SECRET_CACHE_NS, key=_E2B_SECRET_CACHE_KEY
        )
        if cached:
            return decrypt(cached)

        # Generate + store under SET NX so only one container wins.
        new_secret = secrets.token_hex(32)
        encrypted = encrypt(new_secret)

        # Use locking module's set_key which is backed by the Redis lock store.
        # We treat the encrypted secret itself as the lock value; if the key
        # already exists the SET NX semantics mean another container won.
        from oss.src.dbs.redis.shared.engine import get_lock_engine

        redis = get_lock_engine()
        stored = await redis.set(
            f"lock:{_E2B_SECRET_CACHE_NS}:{_E2B_SECRET_CACHE_KEY}",
            encrypted,
            nx=True,
            ex=_E2B_SECRET_CACHE_TTL,
        )
        if not stored:
            # Another container already stored it — read theirs.
            raw = await redis.get(
                f"lock:{_E2B_SECRET_CACHE_NS}:{_E2B_SECRET_CACHE_KEY}"
            )
            if raw:
                return decrypt(raw.decode() if isinstance(raw, bytes) else raw)
            # Fallback: generate ephemeral (should not happen)
            return new_secret

        # Cache in the normal cache layer too for fast reads.
        await set_cache(
            namespace=_E2B_SECRET_CACHE_NS,
            key=_E2B_SECRET_CACHE_KEY,
            value=encrypted,
            ttl=_E2B_SECRET_CACHE_TTL,
        )
        return new_secret

    def verify_e2b_signature(
        self, *, raw_body: bytes, signature_header: str, secret: str
    ) -> bool:
        """Verify E2B webhook HMAC signature.

        E2B signs: sha256(secret + raw_body) → base64, sent in e2b-signature header.
        NOTE: docs/actual header mismatch issue #1103 — log raw header on first failures.
        """
        expected = hmac.new(
            secret.encode(),
            raw_body,
            hashlib.sha256,
        ).hexdigest()
        # E2B may send hex or base64; try hex comparison first.
        try:
            return hmac.compare_digest(expected, signature_header.strip())
        except Exception:
            return False

    async def ensure_e2b_webhook_registered(
        self,
        *,
        api_key: str,
        api_url: str,
        webhook_url: str,
    ) -> None:
        """Register or reconcile the E2B webhook subscription.

        Idempotent: GET /events/webhooks first, POST only if missing.
        Raises SandboxWebhookRegistrationError on failure.
        """
        secret = await self.get_or_create_e2b_webhook_secret()
        headers = {"X-API-Key": api_key, "Content-Type": "application/json"}

        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.get(f"{api_url}/events/webhooks", headers=headers)
                resp.raise_for_status()
                webhooks = resp.json() if resp.status_code == 200 else []
            except Exception as exc:
                log.warning("[sandboxes] E2B GET /events/webhooks failed: %s", exc)
                webhooks = []

            # Check if our webhook_url is already registered.
            for wh in webhooks if isinstance(webhooks, list) else []:
                if isinstance(wh, dict) and wh.get("url") == webhook_url:
                    log.info(
                        "[sandboxes] E2B webhook already registered: %s",
                        webhook_url,
                    )
                    return

            # Register.
            payload = {
                "name": "agenta-sandbox-metering",
                "url": webhook_url,
                "enabled": True,
                "events": [
                    "sandbox.created",
                    "sandbox.paused",
                    "sandbox.resumed",
                    "sandbox.killed",
                ],
                "signature_secret": secret,
            }
            try:
                resp = await client.post(
                    f"{api_url}/events/webhooks",
                    headers=headers,
                    json=payload,
                )
                resp.raise_for_status()
                log.info("[sandboxes] E2B webhook registered: %s", webhook_url)
            except Exception as exc:
                raise SandboxWebhookRegistrationError(
                    f"E2B webhook registration failed: {exc}"
                ) from exc

    # ------------------------------------------------------------------
    # Daytona: periodic poll
    # ------------------------------------------------------------------

    async def daytona_poll(
        self,
        *,
        org_id: UUID,
        api_key: str,
        analytics_url: str,
        daytona_organization_id: str,
        period_start: str,
        period_end: str,
    ) -> None:
        """Poll Daytona usage/aggregated and adjust meters.

        Daytona returns cumulative totals for the window → SET absolute
        value (delta = total - current) so re-polls are idempotent.
        """
        headers = {
            "Authorization": f"Bearer {api_key}",
            "X-Daytona-Organization-ID": daytona_organization_id,
        }
        url = f"{analytics_url}/organization/{daytona_organization_id}/usage/aggregated"
        params = {"from": period_start, "to": period_end}

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url, headers=headers, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            log.error("[sandboxes] Daytona poll failed: %s", exc)
            return

        vcpu_seconds = int(data.get("totalCPUSeconds") or 0)
        ram_gib_seconds = int(data.get("totalRAMGBSeconds") or 0)
        disk_gib_seconds = int(data.get("totalDiskGBSeconds") or 0)
        gpu_seconds = int(data.get("totalGPUSeconds") or 0)

        log.info(
            "[sandboxes] Daytona poll org=%s vcpu_s=%d ram_s=%d disk_s=%d gpu_s=%d",
            org_id,
            vcpu_seconds,
            ram_gib_seconds,
            disk_gib_seconds,
            gpu_seconds,
        )

        usage = SandboxUsageDTO(
            organization_id=org_id,
            provider="daytona",
            sandbox_id="__aggregate__",
            vcpu_seconds=vcpu_seconds,
            ram_gib_seconds=ram_gib_seconds,
            disk_gib_seconds=disk_gib_seconds,
            gpu_seconds=gpu_seconds,
        )
        await self.record_usage(usage)

    async def run_daytona_poll(
        self,
        *,
        org_id: UUID,
        api_key: str,
        analytics_url: str,
        daytona_organization_id: str,
        period_start: str,
        period_end: str,
    ) -> bool:
        """Acquire lock, run poll, release. Returns True if poll ran."""
        lock_owner = await acquire_lock(
            namespace=_DAYTONA_LOCK_NS,
            key=_DAYTONA_LOCK_KEY,
            ttl=_DAYTONA_LOCK_TTL,
        )
        if not lock_owner:
            log.info("[sandboxes] Daytona poll already in progress, skipping")
            return False

        try:
            await self.daytona_poll(
                org_id=org_id,
                api_key=api_key,
                analytics_url=analytics_url,
                daytona_organization_id=daytona_organization_id,
                period_start=period_start,
                period_end=period_end,
            )
            return True
        finally:
            await release_lock(
                namespace=_DAYTONA_LOCK_NS,
                key=_DAYTONA_LOCK_KEY,
                owner=lock_owner,
            )
