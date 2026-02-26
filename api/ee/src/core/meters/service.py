from typing import Awaitable, Tuple, Callable, List, Optional
from uuid import uuid4

import stripe

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env

from ee.src.core.entitlements.types import Quota
from ee.src.core.entitlements.types import Counter, Gauge, REPORTS
from ee.src.core.meters.types import MeterDTO
from ee.src.core.meters.interfaces import MetersDAOInterface

log = get_module_logger(__name__)

# Initialize Stripe only if enabled
if env.stripe.enabled:
    stripe.api_key = env.stripe.api_key
    log.info("✓ Stripe enabled:", target=env.stripe.webhook_target)
else:
    log.info("✗ Stripe disabled")


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

    async def report(
        self,
        renew: Optional[Callable[[], Awaitable[bool]]] = None,
    ):
        if not env.stripe.enabled:
            log.warn("✗ Stripe disabled")
            return

        log.info("[report] ============================================")
        log.info("[report] Starting meter report job")
        log.info("[report] ============================================")
        job_id = uuid4().hex[:12]
        log.info(f"[report] Job id: {job_id}")

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
                    log.info("[report] No more meters to process")
                    break

            except Exception:  # pylint: disable=broad-exception-caught
                log.error(
                    f"[report] Error dumping meters for batch #{batch_number}:",
                    exc_info=True,
                )
                break

            reported_count = 0
            skipped_count = 0
            error_count = 0
            # Meters to bump = flush from dump(). Includes both successfully
            # reported meters AND non-reportable meters (no subscription,
            # missing customer_id, etc.). Only actual Stripe API failures
            # are excluded so they get retried on the next run.
            meters_to_bump: List[MeterDTO] = []

            for idx, meter in enumerate(meters, 1):
                if meter.subscription is None:
                    # No subscription — not reportable to Stripe, but still
                    # bump so dump() doesn't return it forever.
                    skipped_count += 1
                    meters_to_bump.append(meter)
                    continue

                try:
                    if meter.key.value not in REPORTS:
                        # Key not in REPORTS — not reportable to Stripe.
                        # Bump to flush from dump().
                        skipped_count += 1
                        meters_to_bump.append(meter)
                        continue

                    subscription_id = meter.subscription.subscription_id
                    customer_id = meter.subscription.customer_id

                    if not subscription_id:
                        # Missing subscription_id — can't report to Stripe.
                        # Bump to flush from dump().
                        skipped_count += 1
                        meters_to_bump.append(meter)
                        continue

                    if not customer_id:
                        # Missing customer_id — can't report to Stripe.
                        # Bump to flush from dump().
                        log.warn(
                            f"[report] Skipping meter {meter.organization_id}/{meter.key} - missing customer_id"
                        )
                        skipped_count += 1
                        meters_to_bump.append(meter)
                        continue

                    if meter.key.name in Gauge.__members__.keys():
                        try:
                            price_id = (
                                env.stripe.pricing.get(meter.subscription.plan, {})
                                .get("users", {})
                                .get("price")
                            )

                            if not price_id:
                                log.warn(
                                    f"[report] Skipping meter {meter.organization_id}/{meter.key} - missing price_id"
                                )
                                skipped_count += 1
                                meters_to_bump.append(meter)
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
                                meters_to_bump.append(meter)
                                continue

                            quantity = meter.value
                            items = [{"id": _id, "quantity": quantity}]

                            log.info(
                                f"[stripe] gauge-update attempt: job={job_id} "
                                f"org={meter.organization_id} key={meter.key} "
                                f"period={meter.year}-{meter.month} synced={meter.synced} value={meter.value} "
                                f"subscription={subscription_id} customer={customer_id} item={_id} quantity={quantity}"
                            )
                            stripe.Subscription.modify(
                                subscription_id,
                                items=items,
                            )

                            reported_count += 1
                            meters_to_bump.append(meter)
                            log.info(
                                f"[stripe] gauge-update success: job={job_id} "
                                f"org={meter.organization_id} key={meter.key} "
                                f"period={meter.year}-{meter.month} synced={meter.synced} value={meter.value} "
                                f"subscription={subscription_id} customer={customer_id} item={_id} quantity={quantity}"
                            )
                            log.info(
                                f"[stripe] updating:  {meter.organization_id} |         | {'sync ' if meter.key.value in REPORTS else '     '} | {meter.key}: {meter.value}"
                            )

                        except Exception:  # pylint: disable=broad-exception-caught
                            # Actual Stripe API failure — do NOT bump so it
                            # gets retried on the next run.
                            log.error(
                                f"[report] Error modifying subscription for "
                                f"job={job_id} org={meter.organization_id} key={meter.key} "
                                f"period={meter.year}-{meter.month} synced={meter.synced} value={meter.value} "
                                f"subscription={subscription_id} customer={customer_id}",
                                exc_info=True,
                            )
                            error_count += 1
                            continue

                    if meter.key.name in Counter.__members__.keys():
                        try:
                            event_name = meter.key.value
                            delta = max(meter.value - meter.synced, 0)

                            if delta == 0:
                                # Nothing to report — bump to flush from dump().
                                skipped_count += 1
                                meters_to_bump.append(meter)
                                continue

                            payload = {"delta": delta, "customer_id": customer_id}
                            event_identifier = (
                                f"{meter.organization_id}:"
                                f"{meter.key.value}:"
                                f"{meter.year}:{meter.month}:"
                                f"{meter.synced}"
                            )

                            log.info(
                                f"[stripe] counter-event attempt: job={job_id} "
                                f"org={meter.organization_id} key={meter.key} "
                                f"period={meter.year}-{meter.month} synced={meter.synced} value={meter.value} delta={delta} "
                                f"event={event_name} customer={customer_id} identifier={event_identifier}"
                            )
                            stripe.billing.MeterEvent.create(
                                event_name=event_name,
                                payload=payload,
                                identifier=event_identifier,
                            )

                            reported_count += 1
                            meters_to_bump.append(meter)
                            log.info(
                                f"[stripe] counter-event success: job={job_id} "
                                f"org={meter.organization_id} key={meter.key} "
                                f"period={meter.year}-{meter.month} synced={meter.synced} value={meter.value} delta={delta} "
                                f"event={event_name} customer={customer_id} identifier={event_identifier}"
                            )
                            log.info(
                                f"[stripe] reporting: {meter.organization_id} | {(('0' if (meter.month != 0 and meter.month < 10) else '') + str(meter.month)) if meter.month != 0 else '  '}.{meter.year if meter.year else '    '} | {'sync ' if meter.key.value in REPORTS else '     '} | {meter.key}: {meter.value - meter.synced}"
                            )

                        except stripe.error.InvalidRequestError as e:
                            # Stripe deduplicates MeterEvents by identifier.
                            # If the event already exists, treat this as idempotent
                            # success and bump synced to avoid infinite retries.
                            if "event already exists with identifier" in str(e).lower():
                                log.warn(
                                    f"[stripe] counter-event duplicate (idempotent): job={job_id} "
                                    f"org={meter.organization_id} key={meter.key} "
                                    f"period={meter.year}-{meter.month} synced={meter.synced} value={meter.value} delta={delta} "
                                    f"event={event_name} customer={customer_id} identifier={event_identifier}"
                                )
                                reported_count += 1
                                meters_to_bump.append(meter)
                                continue
                            raise

                        except Exception:  # pylint: disable=broad-exception-caught
                            # Actual Stripe API failure — do NOT bump so it
                            # gets retried on the next run.
                            log.error(
                                f"[report] Error creating meter event for "
                                f"job={job_id} org={meter.organization_id} key={meter.key} "
                                f"period={meter.year}-{meter.month} synced={meter.synced} value={meter.value} delta={delta} "
                                f"event={event_name} customer={customer_id} identifier={event_identifier}",
                                exc_info=True,
                            )
                            error_count += 1
                            continue

                except Exception:  # pylint: disable=broad-exception-caught
                    log.error(
                        f"[report] Error reporting meter {meter.organization_id}/{meter.key}:",
                        exc_info=True,
                    )
                    error_count += 1

            log.info(
                f"[report] Batch #{batch_number}: {reported_count} reported, {skipped_count} skipped, {error_count} errors"
            )

            # Set synced = value for all meters we want to flush from dump().
            # This includes both successfully reported AND non-reportable meters.
            # Only actual Stripe API failures are excluded (not in meters_to_bump).
            for meter in meters_to_bump:
                meter.synced = meter.value

            if not meters_to_bump:
                log.info(f"[report] Batch #{batch_number}: no meters to bump")
                total_skipped += skipped_count
                total_errors += error_count
                continue

            try:
                log.info(
                    f"[report] Bumping batch #{batch_number} ({len(meters_to_bump)} meters)"
                )
                await self.bump(meters=meters_to_bump)
                log.info(f"[report] ✅ Batch #{batch_number} completed successfully")
            except Exception:  # pylint: disable=broad-exception-caught
                log.error(
                    f"[report] ❌ Error bumping batch #{batch_number}:", exc_info=True
                )
                total_errors += len(meters)
                # Avoid re-reporting the same unsynced batch in this same run.
                break

            # Renew lock after each batch to prevent expiration during long runs
            if renew:
                try:
                    renewed = await renew()
                    if not renewed:
                        log.error(
                            "[report] Lock renewal rejected (expired or lost ownership), stopping job"
                        )
                        break
                except Exception:
                    log.error("[report] Failed to renew lock", exc_info=True)
                    break

            # Update totals
            total_reported += reported_count
            total_skipped += skipped_count
            total_errors += error_count

        log.info("[report] ============================================")
        log.info("[report] ✅ REPORT JOB COMPLETED")
        log.info(f"[report] Total batches: {batch_number}")
        log.info(f"[report] Total reported: {total_reported}")
        log.info(f"[report] Total skipped: {total_skipped}")
        log.info(f"[report] Total errors: {total_errors}")
        log.info("[report] ============================================")
