from typing import Union, Optional, Callable
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache

log = get_module_logger(__name__)

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

meters_service = MetersService(
    meters_dao=MetersDAO(),
)

subscriptions_service = SubscriptionsService(
    subscriptions_dao=SubscriptionsDAO(),
    meters_service=meters_service,
)


class EntitlementsException(Exception):
    pass


NOT_ENTITLED_RESPONSE: Callable[[Tracker], JSONResponse] = (
    lambda tracker=None: JSONResponse(
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
)


async def check_entitlements(
    organization_id: UUID,
    key: Union[Flag, Counter, Gauge],
    delta: Optional[int] = None,
) -> tuple[bool, Optional[MeterDTO], Optional[Callable]]:
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

    cache_key = {
        "organization_id": organization_id,
    }

    subscription_data = await get_cache(
        namespace="entitlements:subscription",
        key=cache_key,
    )

    if subscription_data is None:
        subscription = await subscriptions_service.read(organization_id=organization_id)

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

    if flag:
        if flag not in ENTITLEMENTS[plan][Tracker.FLAGS]:
            raise EntitlementsException(f"Invalid flag: {flag} for plan [{plan}]")

        check = ENTITLEMENTS[plan][Tracker.FLAGS][flag]

        if flag.name != "RBAC":
            # TODO: remove this line
            log.info(
                f"adjusting: {organization_id} |         | {'allow' if check else 'deny '} | {flag.name}"
            )

        return check is True, None, None

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

    # TODO: remove this line
    log.info(
        f"adjusting: {organization_id} | {(('0' if (meter.month != 0 and meter.month < 10) else '') + str(meter.month)) if meter.month != 0 else '  '}.{meter.year if meter.year else '    '} | {'allow' if check else 'deny '} | {meter.key}: {meter.value - meter.synced} [{meter.value}]"
    )

    return check is True, meter, _
