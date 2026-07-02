"""Sandbox metering service: record_usage(), E2B signature verification, Daytona poll."""

import hashlib
import hmac
import math
from decimal import Decimal
from uuid import UUID

import httpx

from oss.src.utils.env import env
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
from ee.src.core.sandboxes.exceptions import SandboxWebhookSignatureError
from ee.src.core.sandboxes.sink import record_usage_credits

log = get_module_logger(__name__)

# Daytona poll lock
_DAYTONA_LOCK_NS = "sandboxes:daytona"
_DAYTONA_LOCK_KEY = "poll"
_DAYTONA_LOCK_TTL = 120  # 2 min — poll should complete well within this

# Webhook redelivery dedup (E2B `e2b-delivery-id`).
_DELIVERY_DEDUP_NS = "sandboxes:e2b:delivery"
_DELIVERY_DEDUP_TTL = 48 * 60 * 60  # 48h — comfortably beyond E2B's redelivery window

# Daytona reports decimal GB (10^9 bytes); meters store binary GiB (2^30 bytes).
_GB_TO_GIB = Decimal(10**9) / Decimal(2**30)


def _gb_to_gib_seconds(gb_seconds: Decimal) -> int:
    """Convert Daytona GB-seconds to GiB-seconds (ceiling, matches E2B rounding)."""
    if gb_seconds <= 0:
        return 0
    return max(1, math.ceil(gb_seconds * _GB_TO_GIB))


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

        Deduped on usage.delivery_id via Redis SET NX (webhook redelivery
        double-counting guard). Missing delivery_id skips dedup (best-effort).
        """
        if usage.delivery_id:
            claimed = await acquire_lock(
                namespace=_DELIVERY_DEDUP_NS,
                key=usage.delivery_id,
                ttl=_DELIVERY_DEDUP_TTL,
            )
            if not claimed:
                log.info(
                    "[sandboxes] duplicate delivery_id=%s — skipping meter writes",
                    usage.delivery_id,
                )
                return SandboxUsageResult(
                    accepted=True, delivery_id=usage.delivery_id, deduped=True
                )

        org_id = usage.organization_id
        scope = MeterScope(organization_id=org_id)

        meter_deltas: list[tuple[Counter, int]] = [
            (Counter.SANDBOX_CPU_CORE_SECONDS, usage.vcpu_seconds),
            (Counter.SANDBOX_RAM_GIBI_SECONDS, usage.ram_gib_seconds),
            (Counter.SANDBOX_SSD_GIBI_SECONDS, usage.disk_gib_seconds),
            (Counter.SANDBOX_GPU_CORE_SECONDS, usage.gpu_seconds),
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

        # Billing layer: per-dimension + total sandbox_credits, derived from
        # the raw seconds just recorded above (see sink.py).
        await record_usage_credits(
            provider=usage.provider,
            organization_id=org_id,
            cpu_seconds=Decimal(usage.vcpu_seconds),
            ram_seconds=Decimal(usage.ram_gib_seconds),
            ssd_seconds=Decimal(usage.disk_gib_seconds),
            gpu_seconds=Decimal(usage.gpu_seconds) if usage.gpu_seconds else None,
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
    # E2B: webhook signature verification
    # ------------------------------------------------------------------

    def verify_e2b_signature(self, *, raw_body: bytes, signature_header: str) -> bool:
        """Verify E2B webhook HMAC signature against env.e2b.webhook_secret.

        Mirrors the Stripe pattern: the operator sets E2B_WEBHOOK_SECRET and
        registers the webhook with E2B out-of-band; no secret machinery here.
        E2B signs: sha256(secret + raw_body) → hex, sent in e2b-signature header.
        """
        secret = env.e2b.webhook_secret
        if not secret:
            raise SandboxWebhookSignatureError("E2B_WEBHOOK_SECRET is not configured.")

        expected = hmac.new(
            secret.encode(),
            raw_body,
            hashlib.sha256,
        ).hexdigest()
        try:
            return hmac.compare_digest(expected, signature_header.strip())
        except Exception:
            return False

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
        ram_gib_seconds = _gb_to_gib_seconds(
            Decimal(str(data.get("totalRAMGBSeconds") or 0))
        )
        disk_gib_seconds = _gb_to_gib_seconds(
            Decimal(str(data.get("totalDiskGBSeconds") or 0))
        )
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
