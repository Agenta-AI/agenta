from typing import Tuple, Callable, List, Optional
from datetime import datetime
from os import environ
from json import loads

import stripe

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env

from ee.src.core.entitlements.types import Quota
from ee.src.core.entitlements.types import Counter, Gauge, REPORTS
from ee.src.core.meters.types import MeterDTO
from ee.src.core.meters.interfaces import MetersDAOInterface

AGENTA_PRICING = loads(env.agenta.pricing or "{}")

log = get_module_logger(__name__)

# Initialize Stripe only if enabled
if env.stripe.enabled:
    stripe.api_key = env.stripe.api_key
    log.info("✓ Stripe enabled in meters service")
else:
    log.info("Stripe disabled in meters service")


class MetersService:
    def __init__(
        self,
        meters_dao: MetersDAOInterface,
    ):
        self.meters_dao = meters_dao

    async def dump(
        self,
        limit: Optional[int] = None,
    ) -> List[MeterDTO]:
        return await self.meters_dao.dump(limit=limit)

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
            log.warn("[report] Missing Stripe API Key.")
            return

        log.info("[report] ============================================")
        log.info("[report] Starting meter report job")
        log.info("[report] ============================================")

        BATCH_SIZE = 100
        MAX_BATCHES = 50  # Safety limit: 50 batches * 100 meters = 5000 meters max
        total_reported = 0
        total_skipped = 0
        total_errors = 0
        batch_number = 0

        while True:
            batch_number += 1

            if batch_number > MAX_BATCHES:
                log.error(
                    f"[report] ⚠️  Reached maximum batch limit ({MAX_BATCHES}), stopping to prevent infinite loop"
                )
                break

            log.info(f"[report] Processing batch #{batch_number}")

            try:
                meters = await self.dump(limit=BATCH_SIZE)
                log.info(
                    f"[report] Dumped {len(meters)} meters for batch #{batch_number}"
                )

                if not meters:
                    log.info(f"[report] No more meters to process")
                    break

            except Exception as e:  # pylint: disable=broad-exception-caught
                log.error(
                    f"[report] Error dumping meters for batch #{batch_number}:",
                    exc_info=True,
                )
                break

            reported_count = 0
            skipped_count = 0
            error_count = 0

            for idx, meter in enumerate(meters, 1):
                if meter.subscription is None:
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
                                        f"[report] Skipping meter {meter.organization_id}/{meter.key} - missing price_id"
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
                                        f"[report] Skipping meter {meter.organization_id}/{meter.key} - subscription item not found"
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
                                    f"[stripe] updating:  {meter.organization_id} |         | {'sync ' if meter.key.value in REPORTS else '     '} | {meter.key}: {meter.value}"
                                )

                            except Exception as e:  # pylint: disable=broad-exception-caught
                                log.error(
                                    f"[report] Error modifying subscription for {meter.organization_id}/{meter.key}:",
                                    exc_info=True,
                                )
                                error_count += 1
                                continue

                        if meter.key.name in Counter.__members__.keys():
                            try:
                                event_name = meter.key.value
                                delta = meter.value - meter.synced

                                if delta <= 0:
                                    skipped_count += 1
                                    continue

                                payload = {"delta": delta, "customer_id": customer_id}

                                stripe.billing.MeterEvent.create(
                                    event_name=event_name,
                                    payload=payload,
                                )

                                reported_count += 1
                                log.info(
                                    f"[stripe] reporting: {meter.organization_id} | {(('0' if (meter.month != 0 and meter.month < 10) else '') + str(meter.month)) if meter.month != 0 else '  '}.{meter.year if meter.year else '    '} | {'sync ' if meter.key.value in REPORTS else '     '} | {meter.key}: {meter.value - meter.synced}"
                                )

                            except Exception as e:  # pylint: disable=broad-exception-caught
                                log.error(
                                    f"[report] Error creating meter event for {meter.organization_id}/{meter.key}:",
                                    exc_info=True,
                                )
                                error_count += 1
                                continue

                except Exception as e:  # pylint: disable=broad-exception-caught
                    log.error(
                        f"[report] Error reporting meter {meter.organization_id}/{meter.key}:",
                        exc_info=True,
                    )
                    error_count += 1

            log.info(
                f"[report] Batch #{batch_number}: {reported_count} reported, {skipped_count} skipped, {error_count} errors"
            )

            # Set synced values for this batch
            for meter in meters:
                meter.synced = meter.value

            # Commit this batch to DB
            try:
                log.info(
                    f"[report] Bumping batch #{batch_number} ({len(meters)} meters)"
                )
                await self.bump(meters=meters)
                log.info(f"[report] ✅ Batch #{batch_number} completed successfully")
            except Exception as e:  # pylint: disable=broad-exception-caught
                log.error(
                    f"[report] ❌ Error bumping batch #{batch_number}:", exc_info=True
                )
                total_errors += len(meters)
                continue

            # Update totals
            total_reported += reported_count
            total_skipped += skipped_count
            total_errors += error_count

        log.info(f"[report] ============================================")
        log.info(f"[report] ✅ REPORT JOB COMPLETED")
        log.info(f"[report] Total batches: {batch_number}")
        log.info(f"[report] Total reported: {total_reported}")
        log.info(f"[report] Total skipped: {total_skipped}")
        log.info(f"[report] Total errors: {total_errors}")
        log.info(f"[report] ============================================")
