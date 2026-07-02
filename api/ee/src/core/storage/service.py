"""Storage gauge: delta tracking + periodic reconciliation."""

from uuid import UUID

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


async def record_storage_delta(
    *,
    org_id: UUID,
    delta_bytes: int,
) -> bool:
    """Adjust the storage gauge by `delta_bytes` (positive=write, negative=delete).

    Returns True if allowed (under quota), False if capped. Fails open on errors.
    """
    from oss.src.utils.common import is_ee

    if not is_ee():
        return True

    try:
        from ee.src.core.access.entitlements.types import Gauge
        from ee.src.core.access.entitlements.service import check_entitlements
        from ee.src.core.meters.types import MeterScope

        scope = MeterScope(organization_id=org_id)
        allowed, _, _ = await check_entitlements(
            key=Gauge.STORAGE_BYTES,
            delta=delta_bytes,
            scope=scope,
        )
        return allowed
    except Exception:
        log.warning(
            "[storage] record_storage_delta failed; failing open", exc_info=True
        )
        return True


async def reconcile_org_storage(
    *,
    org_id: UUID,
) -> None:
    """Reconcile storage gauge: read authoritative size, set gauge via delta."""
    from oss.src.utils.common import is_ee

    if not is_ee():
        return

    try:
        from ee.src.core.access.entitlements.types import Gauge
        from ee.src.core.access.entitlements.service import (
            check_entitlements,
            _meters_service,
        )
        from ee.src.core.meters.types import MeterScope, MeterPeriod, Meters
        from ee.src.core.storage.adapters import get_org_storage_bytes

        authoritative = await get_org_storage_bytes(org_id=org_id)

        scope = MeterScope(organization_id=org_id)
        period = MeterPeriod()

        meters = await _meters_service().fetch(
            scope=scope,
            key=Meters.STORAGE_BYTES,
            period=period,
        )
        current = (meters[0].value if meters else 0) or 0
        delta = authoritative - current

        if delta == 0:
            return

        await check_entitlements(
            key=Gauge.STORAGE_BYTES,
            delta=delta,
            scope=scope,
            period=period,
        )
        log.info(
            "[storage] reconciled org=%s authoritative=%d current=%d delta=%d",
            org_id,
            authoritative,
            current,
            delta,
        )
    except Exception:
        log.warning("[storage] reconcile_org_storage failed", exc_info=True)
