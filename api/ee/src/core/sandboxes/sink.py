"""record_usage_credits() -- credits sink for sandbox resource-second events.

Called by `SandboxMeteringService.record_usage()` after the raw *_seconds
meters are adjusted. Per event it:

  1. Computes per-dimension *_credits from the raw seconds via `to_credits()`.
  2. Adjusts each per-dimension *_credits meter.
  3. Sums per-dimension credits into sandbox_credits and adjusts that meter.

Credit deltas are stored as millicredits (credits x 1000, truncated) to
preserve sub-credit precision without changing the int-typed MeterDTO.delta
field. Stripe's per-millicredit price accounts for the x1000 factor.

All adjustments are org-scoped. Gate: is_ee() (caller gates on provider.enabled).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee

from ee.src.core.access.entitlements.types import Counter
from ee.src.core.access.entitlements.service import check_entitlements
from ee.src.core.meters.types import MeterScope
from ee.src.core.sandboxes.credits import Dimension, to_credits


log = get_module_logger(__name__)

# Millicredits scale factor: credits x 1000 stored as int in MeterDTO.delta.
_MILLICREDITS = Decimal("1000")


async def record_usage_credits(
    *,
    provider: str,
    organization_id: UUID,
    #
    cpu_seconds: Decimal = Decimal("0"),
    ram_seconds: Decimal = Decimal("0"),
    ssd_seconds: Decimal = Decimal("0"),
    gpu_seconds: Optional[Decimal] = None,
) -> None:
    """Record per-dimension + total sandbox credits for one usage event.

    Writes SANDBOX_{CPU,RAM,SSD,GPU}_CREDITS and SANDBOX_CREDITS in one call.
    No-ops silently when is_ee() is False. Raw *_seconds meters are the
    caller's responsibility (already adjusted by
    `SandboxMeteringService.record_usage`).

    Args:
        provider: Provider slug ("e2b", "daytona", "local", ...).
        organization_id: Org to meter under.
        cpu_seconds: vCPU-s consumed (Decimal >= 0).
        ram_seconds: GiB-s of RAM consumed (Decimal >= 0).
        ssd_seconds: GiB-s of disk consumed (Decimal >= 0).
        gpu_seconds: GPU-s consumed; None means provider has no GPU meter.
    """
    if not is_ee():
        return

    meter_scope = MeterScope(organization_id=organization_id)

    dimension_pairs: list[tuple[Counter, Dimension, Decimal]] = [
        (Counter.SANDBOX_CPU_CORE_CREDITS, Dimension.CPU, cpu_seconds),
        (Counter.SANDBOX_RAM_GIBI_CREDITS, Dimension.RAM, ram_seconds),
        (Counter.SANDBOX_SSD_GIBI_CREDITS, Dimension.SSD, ssd_seconds),
    ]
    if gpu_seconds is not None:
        dimension_pairs.append(
            (Counter.SANDBOX_GPU_CORE_CREDITS, Dimension.GPU, gpu_seconds)
        )

    total_credits = Decimal("0")
    for counter, dimension, units in dimension_pairs:
        credits = to_credits(provider=provider, dimension=dimension, raw_units=units)
        total_credits += credits
        if credits <= Decimal("0"):
            continue
        # Store as millicredits to preserve sub-credit precision in the int field.
        millicredits = int(credits * _MILLICREDITS)
        if millicredits <= 0:
            continue
        try:
            await check_entitlements(
                key=counter,
                delta=millicredits,
                cache=False,
                scope=meter_scope,
            )
        except Exception:  # pylint: disable=broad-exception-caught
            log.warning(
                "[sandboxes] failed to record %s for org=%s",
                counter.value,
                organization_id,
                exc_info=True,
            )

    if total_credits <= Decimal("0"):
        return

    total_millicredits = int(total_credits * _MILLICREDITS)
    if total_millicredits <= 0:
        return

    try:
        await check_entitlements(
            key=Counter.SANDBOX_CREDITS,
            delta=total_millicredits,
            cache=False,
            scope=meter_scope,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning(
            "[sandboxes] failed to record sandbox_credits for org=%s",
            organization_id,
            exc_info=True,
        )
