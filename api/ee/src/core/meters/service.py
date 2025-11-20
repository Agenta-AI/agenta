from typing import Tuple, Callable, List, Optional
from datetime import datetime
from os import environ
from json import loads

import stripe

from oss.src.utils.logging import get_module_logger

from ee.src.core.entitlements.types import Quota
from ee.src.core.entitlements.types import Counter, Gauge, REPORTS
from ee.src.core.meters.types import MeterDTO
from ee.src.core.meters.interfaces import MetersDAOInterface

AGENTA_PRICING = loads(environ.get("AGENTA_PRICING") or "{}")

log = get_module_logger(__name__)

stripe.api_key = environ.get("STRIPE_API_KEY")


class MetersService:
    def __init__(
        self,
        meters_dao: MetersDAOInterface,
    ):
        self.meters_dao = meters_dao

    async def dump(
        self,
    ) -> List[MeterDTO]:
        return await self.meters_dao.dump()

    async def bump(
        self,
        *,
        meters: List[MeterDTO],
    ) -> None:
        await self.meters_dao.bump(meters=meters)

    async def fetch(
        self,
        *,
        organization_id: str,
        #
        key: Optional[str] = None,
        year: Optional[int] = None,
        month: Optional[int] = None,
    ) -> List[MeterDTO]:
        return await self.meters_dao.fetch(
            organization_id=organization_id,
            key=key,
            year=year,
            month=month,
        )

    async def check(
        self,
        *,
        meter: MeterDTO,
        quota: Quota,
        anchor: Optional[int] = None,
    ) -> Tuple[bool, MeterDTO]:
        return await self.meters_dao.check(meter=meter, quota=quota, anchor=anchor)

    async def adjust(
        self,
        *,
        meter: MeterDTO,
        quota: Quota,
        anchor: Optional[int] = None,
    ) -> Tuple[bool, MeterDTO, Callable]:
        return await self.meters_dao.adjust(meter=meter, quota=quota, anchor=anchor)

    async def report(self):
        if not stripe.api_key:
            log.warn("Missing Stripe API Key.")
            return

        try:
            meters = await self.dump()

        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error("Error dumping meters: %s", e)
            return

        try:
            for meter in meters:
                if meter.subscription is None:
                    continue

                try:
                    if meter.key.value in REPORTS:
                        subscription_id = meter.subscription.subscription_id
                        customer_id = meter.subscription.customer_id

                        if not subscription_id:
                            continue

                        if not customer_id:
                            continue

                        if meter.key.name in Gauge.__members__.keys():
                            try:
                                price_id = (
                                    AGENTA_PRICING.get(meter.subscription.plan, {})
                                    .get("users", {})
                                    .get("price")
                                )

                                if not price_id:
                                    continue

                                _id = None
                                for item in stripe.SubscriptionItem.list(
                                    subscription=subscription_id,
                                ).auto_paging_iter():
                                    if item.price.id == price_id:
                                        _id = item.id
                                        break

                                if not _id:
                                    continue

                                quantity = meter.value

                                items = [{"id": _id, "quantity": quantity}]

                                stripe.Subscription.modify(
                                    subscription_id,
                                    items=items,
                                )

                            except (
                                Exception  # pylint: disable=broad-exception-caught
                            ) as e:
                                log.error("Error modifying subscription: %s", e)
                                continue

                            log.info(
                                f"[stripe] updating:  {meter.organization_id} |         | {'sync ' if meter.key.value in REPORTS else '     '} | {meter.key}: {meter.value}"
                            )

                        if meter.key.name in Counter.__members__.keys():
                            try:
                                event_name = meter.key.value
                                delta = meter.value - meter.synced
                                payload = {"delta": delta, "customer_id": customer_id}

                                stripe.billing.MeterEvent.create(
                                    event_name=event_name,
                                    payload=payload,
                                )
                            except (
                                Exception  # pylint: disable=broad-exception-caught
                            ) as e:
                                log.error("Error creating meter event: %s", e)
                                continue

                            log.info(
                                f"[stripe] reporting: {meter.organization_id} | {(('0' if (meter.month != 0 and meter.month < 10) else '') + str(meter.month)) if meter.month != 0 else '  '}.{meter.year if meter.year else '    '} | {'sync ' if meter.key.value in REPORTS else '     '} | {meter.key}: {meter.value - meter.synced}"
                            )

                except Exception as e:  # pylint: disable=broad-exception-caught
                    log.error("Error reporting meter: %s", e)

        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error("Error reporting meters: %s", e)

        try:
            for meter in meters:
                meter.synced = meter.value

        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error("Error syncing meters: %s", e)

        try:
            await self.bump(meters=meters)

        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error("Error bumping meters: %s", e)
            return
