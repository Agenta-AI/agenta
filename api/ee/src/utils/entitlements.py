from typing import Union, Optional, Callable
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from ee.src.utils.billing import compute_billing_period
from fastapi.responses import JSONResponse
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.core.entitlements.types import (
    Tracker,
    Flag,
    Counter,
    Gauge,
    Plan,
    ENTITLEMENTS,
)
from ee.src.core.meters.service import MetersService
from ee.src.core.meters.types import MeterDTO
from ee.src.dbs.postgres.meters.dao import MetersDAO
from ee.src.dbs.postgres.subscriptions.dao import SubscriptionsDAO

log = get_module_logger(__name__)

meters_service = MetersService(
    meters_dao=MetersDAO(),
)

subscriptions_service = SubscriptionsService(
    subscriptions_dao=SubscriptionsDAO(),
    meters_service=meters_service,
)


class EntitlementsException(Exception):
    pass


def NOT_ENTITLED_RESPONSE(tracker=None) -> JSONResponse:
    return JSONResponse(
        status_code=403,
        content={
            "detail": (
                "You have reached your monthly quota limit. Please upgrade your plan to continue."
                if tracker == Tracker.COUNTERS
                else (
                    "You have reached your quota limit. Please upgrade your plan to continue."
                    if tracker == Tracker.GAUGES
                    else (
                        "You do not have access to this feature. Please upgrade your plan to continue."
                        if tracker == Tracker.FLAGS
                        else "You do not have access to this feature."
                    )
                )
            ),
        },
    )


async def check_entitlements(
    organization_id: UUID,
    key: Union[Flag, Counter, Gauge],
    delta: Optional[int] = None,
    # soft-check mode
    use_cache: Optional[bool] = False,
) -> tuple[bool, Optional[MeterDTO], Optional[Callable]]:
    """
    Checks entitlements for flags, counters, or gauges.
    - If `use_cache=True`, performs a soft-check:
        1. Tries Redis cached value first.
        2. Falls back to DB fetch if cache is cold.
        3. NEVER writes to DB.
    - Otherwise, performs a full atomic adjust() in DB.
    """
    # -------------------------------------------------------------- #
    # 1. Parse key type (Flag / Counter / Gauge)
    # -------------------------------------------------------------- #

    flag = None
    try:
        flag = Flag(key)
    except ValueError:
        pass

    counter = None
    try:
        counter = Counter(key)
    except ValueError:
        pass

    gauge = None
    try:
        gauge = Gauge(key)
    except ValueError:
        pass

    if flag is None and counter is None and gauge is None:
        raise EntitlementsException(f"Invalid key [{key}]")

    # -------------------------------------------------------------- #
    # 2. Load subscription data (cached)
    # -------------------------------------------------------------- #

    cache_key = {
        "organization_id": str(organization_id),
    }

    subscription_data = await get_cache(
        namespace="entitlements:subscription",
        key=cache_key,
    )

    if subscription_data is None:
        subscription = await subscriptions_service.read(
            organization_id=str(organization_id),
        )

        if not subscription:
            raise EntitlementsException(
                f"No subscription found for organization [{organization_id}]"
            )

        subscription_data = {
            "plan": subscription.plan.value,
            "anchor": subscription.anchor,
        }

        await set_cache(
            namespace="entitlements:subscription",
            key=cache_key,
            value=subscription_data,
        )

    plan = Plan(subscription_data.get("plan"))
    anchor = subscription_data.get("anchor")

    if plan not in ENTITLEMENTS:
        raise EntitlementsException(f"Missing plan [{plan}] in entitlements")

    # -------------------------------------------------------------- #
    # 3. Handle flags (boolean entitlements)
    # -------------------------------------------------------------- #

    if flag:
        if flag not in ENTITLEMENTS[plan][Tracker.FLAGS]:
            raise EntitlementsException(f"Invalid flag: {flag} for plan [{plan}]")

        check = ENTITLEMENTS[plan][Tracker.FLAGS][flag]

        if flag.name != "RBAC":
            # TODO: remove this line
            log.info(
                f"[METERS] adjusting: {organization_id} |         | {'allow' if check else 'deny '} | {flag.name}"
            )

        return check is True, None, None

    # -------------------------------------------------------------- #
    # 4. Determine quota and current billing period
    # -------------------------------------------------------------- #

    quota = None

    if counter:
        if counter not in ENTITLEMENTS[plan][Tracker.COUNTERS]:
            raise EntitlementsException(f"Invalid counter: {counter} for plan [{plan}]")

        quota = ENTITLEMENTS[plan][Tracker.COUNTERS][counter]

    if gauge:
        if gauge not in ENTITLEMENTS[plan][Tracker.GAUGES]:
            raise EntitlementsException(f"Invalid gauge: {gauge} for plan [{plan}]")

        quota = ENTITLEMENTS[plan][Tracker.GAUGES][gauge]

    if not quota:
        raise EntitlementsException(f"No quota found for key [{key}] in plan [{plan}]")

    # Compute current year/month based on anchor
    year, month = compute_billing_period(anchor=anchor)

    # -------------------------------------------------------------- #
    # 5. Soft-check mode (Layer 1)
    # -------------------------------------------------------------- #
    if use_cache:
        # 5.1. Try Redis cache first
        cache_key = {
            "organization_id": str(organization_id),
            "key": key.value,
            "year": str(year) if quota.monthly else "-",
            "month": str(month) if quota.monthly else "-",
        }

        cached_value = await get_cache(
            namespace="entitlements:meters",
            key=cache_key,
        )

        if cached_value is not None:
            current_value = cached_value

        else:
            # 5.2. Fallback to DB fetch for current billing period only
            meters = await meters_service.fetch(
                organization_id=str(organization_id),
                key=key,
                year=year,
                month=month,
            )

            current_value = (meters[0].value if meters else 0) or 0

            # Cache value for future soft-checks
            # Two-tier: Local (60s) + Redis (24h)
            # Local cache ensures hot meter values are always fresh
            # Redis provides distributed cache across instances
            await set_cache(
                namespace="entitlements:meters",
                key=cache_key,
                value=current_value,
                ttl=24 * 60 * 60,  # 24 hours (Redis TTL)
            )

        # 5.3. Decide based on quota
        proposed_value = current_value + (delta or 0)
        allowed = quota.limit is None or proposed_value <= quota.limit

        return allowed, None, None

    # -------------------------------------------------------------- #
    # 6. Full check + adjust mode (Layer 2)
    # -------------------------------------------------------------- #

    meter = MeterDTO(
        organization_id=organization_id,
        key=key,
        delta=delta,
    )

    check, meter, _ = await meters_service.adjust(
        meter=meter,
        quota=quota,
        anchor=anchor,
    )

    cache_key = {
        "organization_id": str(organization_id),
        "key": key.value,
        "year": str(year) if quota.monthly else "-",
        "month": str(month) if quota.monthly else "-",
    }

    if check:
        # ✅ Allowed — sync both cache layers so they're always fresh
        current_value = (meter.value if meter else 0) or 0

        await set_cache(
            namespace="entitlements:meters",
            key=cache_key,
            value=current_value,
            ttl=24 * 60 * 60,  # 24 hours (Redis TTL)
        )
    else:
        # ❌ Rejected — invalidate Layer 1 cache so subsequent soft-checks
        # go to DB instead of using a stale cached value that would keep
        # allowing requests through.
        await invalidate_cache(
            namespace="entitlements:meters",
            key=cache_key,
        )

    # TODO: remove this line
    log.info(
        f"[METERS] adjusting: {organization_id} | {(('0' if (meter.month != 0 and meter.month < 10) else '') + str(meter.month)) if meter.month != 0 else '  '}.{meter.year if meter.year else '    '} | {'allow' if check else 'deny '} | {meter.key}: {meter.value - meter.synced} [{meter.value}]"
    )

    return check is True, meter, _
