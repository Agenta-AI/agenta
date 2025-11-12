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
    ) -> List[MeterDTO]:
        return await self.meters_dao.fetch(organization_id=organization_id)

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
            log.warn("[report] Missing Stripe API Key.")
            return

        log.info("[report] Starting meter report job")

        try:
            log.info("[report] Dumping meters to sync")
            meters = await self.dump()
            log.info(f"[report] Dumped {len(meters)} meters to sync")
        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error("[report] Error dumping meters: %s", e)
            return

        reported_count = 0
        skipped_count = 0
        error_count = 0

        for meter in meters:
            log.info(
                f"[report] Processing meter {meter.organization_id}/{meter.key} (year={meter.year}, month={meter.month}) (value={meter.value}, synced={meter.synced})"
            )

            if meter.subscription is None:
                log.info(
                    f"[report] Skipping meter {meter.organization_id}/{meter.key} - no subscription"
                )
                skipped_count += 1
                continue

            try:
                if meter.key.value in REPORTS:
                    subscription_id = meter.subscription.subscription_id
                    customer_id = meter.subscription.customer_id

                    if not subscription_id:
                        log.warn(
                            f"[report] Skipping meter {meter.organization_id}/{meter.key} - missing subscription_id"
                        )
                        skipped_count += 1
                        continue

                    if not customer_id:
                        log.warn(
                            f"[report] Skipping meter {meter.organization_id}/{meter.key} - missing customer_id"
                        )
                        skipped_count += 1
                        continue

                    if meter.key.name in Gauge.__members__.keys():
                        try:
                            price_id = (
                                AGENTA_PRICING.get(meter.subscription.plan, {})
                                .get("users", {})
                                .get("price")
                            )

                            if not price_id:
                                log.warn(
                                    f"[report] Skipping meter {meter.organization_id}/{meter.key} - missing price_id for plan {meter.subscription.plan}"
                                )
                                skipped_count += 1
                                continue

                            _id = None
                            for item in stripe.SubscriptionItem.list(
                                subscription=subscription_id,
                            ).auto_paging_iter():
                                if item.price.id == price_id:
                                    _id = item.id
                                    break

                            if not _id:
                                log.warn(
                                    f"[report] Skipping meter {meter.organization_id}/{meter.key} - subscription item not found for price_id {price_id}"
                                )
                                skipped_count += 1
                                continue

                            quantity = meter.value
                            items = [{"id": _id, "quantity": quantity}]

                            stripe.Subscription.modify(
                                subscription_id,
                                items=items,
                            )

                            reported_count += 1
                            log.info(
                                f"[report] [stripe]  {meter.organization_id} |         | {'sync ' if meter.key.value in REPORTS else '     '} | {meter.key}: {meter.value}"
                            )

                        except Exception as e:  # pylint: disable=broad-exception-caught
                            log.error(
                                f"[report] Error modifying subscription for {meter.organization_id}/{meter.key}: %s",
                                e,
                            )
                            error_count += 1
                            continue

                    if meter.key.name in Counter.__members__.keys():
                        try:
                            event_name = meter.key.value
                            delta = meter.value - meter.synced

                            if delta <= 0:
                                log.info(
                                    f"[report] Skipping meter {meter.organization_id}/{meter.key} - delta is {delta}"
                                )
                                skipped_count += 1
                                continue

                            payload = {"delta": delta, "customer_id": customer_id}

                            stripe.billing.MeterEvent.create(
                                event_name=event_name,
                                payload=payload,
                            )

                            reported_count += 1
                            log.info(
                                f"[report] [stripe] {meter.organization_id} | {(('0' if (meter.month != 0 and meter.month < 10) else '') + str(meter.month)) if meter.month != 0 else '  '}.{meter.year if meter.year else '    '} | {'sync ' if meter.key.value in REPORTS else '     '} | {meter.key}: {meter.value - meter.synced}"
                            )

                        except Exception as e:  # pylint: disable=broad-exception-caught
                            log.error(
                                f"[report] Error creating meter event for {meter.organization_id}/{meter.key}: %s",
                                e,
                            )
                            error_count += 1
                            continue

            except Exception as e:  # pylint: disable=broad-exception-caught
                log.error(
                    f"E[report] rror reporting meter {meter.organization_id}/{meter.key}: %s",
                    e,
                )
                error_count += 1

        log.info(
            f"[report] Reporting complete: {reported_count} reported, {skipped_count} skipped, {error_count} errors"
        )

        log.info(f"[report] Setting synced values for {len(meters)} meters")
        synced_count = 0
        sync_error_count = 0

        for meter in meters:
            try:
                meter.synced = meter.value
                synced_count += 1
            except Exception as e:  # pylint: disable=broad-exception-caught
                log.error(
                    f"[report] Error setting synced value for {meter.organization_id}/{meter.key}: %s",
                    e,
                )
                sync_error_count += 1

        log.info(
            f"[report] Set synced values: {synced_count} success, {sync_error_count} errors"
        )

        try:
            log.info(f"[report] Bumping {len(meters)} meters")
            await self.bump(meters=meters)
            log.info("[report] Bumped successfully")
        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error("[report] Error bumping meters: %s", e)
            return
