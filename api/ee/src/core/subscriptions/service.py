from contextlib import nullcontext
from typing import Any, Optional, Tuple
from uuid import UUID, getnode
from datetime import datetime, timezone, timedelta

import uuid_utils.compat as uuid_utils

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env
from oss.src.utils.caching import invalidate_cache
from oss.src.utils.lazy import _load_stripe

from ee.src.core.subscriptions.types import (
    SubscriptionDTO,
    Event,
    get_default_plan,
)
from ee.src.core.subscriptions.settings import (
    get_free_plan,
    get_trial_plan,
    get_trial_days,
    get_stripe_line_items,
    require_pricing,
    trial_enabled,
)
from ee.src.core.subscriptions.interfaces import SubscriptionsDAOInterface
from ee.src.core.wallets.service import WalletsService

log = get_module_logger(__name__)

MAC_ADDRESS = ":".join(f"{(getnode() >> ele) & 0xFF:02x}" for ele in range(40, -1, -8))


def _stripe_field(value: Any, key: str) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return value.get(key)
    return getattr(value, key, None)


def current_billing_period(
    stripe_subscription: Any,
) -> Tuple[Optional[datetime], Optional[datetime]]:
    """The Stripe subscription's current billing period, read from its first item
    (where Stripe carries it), or `(None, None)` when it is not there."""
    items = _stripe_field(_stripe_field(stripe_subscription, "items"), "data") or []
    if not items:
        return None, None

    start = _stripe_field(items[0], "current_period_start")
    end = _stripe_field(items[0], "current_period_end")
    if start is None or end is None:
        return None, None

    return (
        datetime.fromtimestamp(int(start), tz=timezone.utc),
        datetime.fromtimestamp(int(end), tz=timezone.utc),
    )


class SwitchException(Exception):
    pass


class EventException(Exception):
    pass


class SubscriptionsService:
    def __init__(
        self,
        subscriptions_dao: SubscriptionsDAOInterface,
        wallets_service: Optional[WalletsService] = None,
    ):
        self.subscriptions_dao = subscriptions_dao
        # Only the instance that handles plan changes (the billing router's) needs it.
        self.wallets_service = wallets_service

    async def create(
        self,
        *,
        subscription: SubscriptionDTO,
    ) -> Optional[SubscriptionDTO]:
        return await self.subscriptions_dao.create(subscription=subscription)

    async def read(
        self,
        *,
        organization_id: str,
    ) -> Optional[SubscriptionDTO]:
        return await self.subscriptions_dao.read(organization_id=organization_id)

    async def update(
        self,
        *,
        subscription: SubscriptionDTO,
    ) -> Optional[SubscriptionDTO]:
        return await self.subscriptions_dao.update(subscription=subscription)

    async def start_reverse_trial(
        self,
        *,
        organization_id: str,
        organization_name: str,
        organization_email: str,
    ) -> Optional[SubscriptionDTO]:
        stripe = _load_stripe()
        if stripe is None:
            raise EventException("Reverse trial requires Stripe to be available")

        if not trial_enabled():
            raise EventException(
                "Reverse trial requires an AGENTA_BILLING_PRICING entry "
                'carrying a `"trial": N` marker on the trial plan slug.'
            )

        trial_days = get_trial_days()
        trial_plan = get_trial_plan()
        if trial_days is None or trial_plan is None:
            raise EventException(
                "Reverse trial invoked without configured trial state "
                "(trial_days and trial_plan must both be set)."
            )
        try:
            line_items = require_pricing(
                trial_plan,
                purpose="Reverse trial signup",
            )
        except ValueError as e:
            raise EventException(str(e)) from e

        free_plan = get_free_plan()

        now = datetime.now(tz=timezone.utc)
        anchor = now + timedelta(days=trial_days)

        subscription = await self.read(organization_id=organization_id)

        if subscription:
            return None

        subscription = await self.create(
            subscription=SubscriptionDTO(
                organization_id=organization_id,
                plan=free_plan,
                active=True,
                anchor=anchor.day,
            )
        )

        if not subscription:
            return None

        customer = stripe.Customer.create(
            name=organization_name,
            email=organization_email,
            metadata={
                "organization_id": organization_id,
                "target": env.stripe.webhook_target,
            },
        )

        customer_id = customer.id

        if not customer_id:
            log.error(
                "Failed to create Stripe customer for organization ID: %s",
                organization_id,
            )

            return None

        stripe_subscription = stripe.Subscription.create(
            customer=customer_id,
            items=line_items,
            #
            # automatic_tax={"enabled": True},
            metadata={
                "organization_id": organization_id,
                "plan": trial_plan,
                "target": env.stripe.webhook_target,
            },
            #
            trial_period_days=trial_days,
            trial_settings={"end_behavior": {"missing_payment_method": "cancel"}},
        )

        subscription = await self.update(
            subscription=SubscriptionDTO(
                organization_id=organization_id,
                customer_id=customer_id,
                subscription_id=stripe_subscription.id,
                plan=trial_plan,
                active=True,
                anchor=anchor.day,
            )
        )

        return subscription

    async def start_plan(
        self,
        *,
        organization_id: str,
        plan: str,
    ) -> Optional[SubscriptionDTO]:
        """Start a specific plan for an organization.

        Args:
            organization_id: The organization ID
            plan: The plan slug to assign

        Returns:
            SubscriptionDTO: The created subscription or None if already exists
        """
        now = datetime.now(tz=timezone.utc)

        subscription = await self.read(organization_id=organization_id)

        if subscription:
            return None

        subscription = await self.create(
            subscription=SubscriptionDTO(
                organization_id=organization_id,
                plan=plan,
                active=True,
                anchor=now.day,
            )
        )

        log.info("✓ Plan [%s] started for organization %s", plan, organization_id)

        return subscription

    async def provision_subscription(
        self,
        *,
        organization_id: str,
        organization_name: str,
        organization_email: str,
    ) -> Optional[SubscriptionDTO]:
        """Provision the initial subscription for a newly signed-up organization.

        - Stripe enabled                     → reverse-trial flow on trial plan.
        - Stripe disabled                    → onboard on `get_default_plan()`.
        """
        if env.stripe.enabled:
            if trial_enabled():
                return await self.start_reverse_trial(
                    organization_id=organization_id,
                    organization_name=organization_name,
                    organization_email=organization_email,
                )

            free_plan = get_free_plan()
            log.info(
                "Trial not configured; onboarding org %s on free plan [%s]",
                organization_id,
                free_plan,
            )
            return await self.start_plan(
                organization_id=organization_id,
                plan=free_plan,
            )

        return await self.start_plan(
            organization_id=organization_id,
            plan=get_default_plan(),
        )

    async def cancel_subscription(
        self,
        *,
        organization_id: str,
    ) -> bool:
        """Cancel an organization's Stripe subscription, if any.

        Used by org/account deletion to stop billing before the local rows are
        removed. Returns True if a live subscription was cancelled at Stripe,
        False when there was nothing to cancel (no subscription, or Stripe
        disabled). Raises on a genuine Stripe failure so the caller can decide
        whether to treat it as best-effort.
        """
        subscription = await self.read(organization_id=organization_id)

        if not subscription or not subscription.subscription_id:
            return False

        stripe = _load_stripe()
        if stripe is None:
            return False

        stripe_subscription = stripe.Subscription.retrieve(
            subscription.subscription_id,
        )

        status = getattr(stripe_subscription, "status", None)
        if status == "canceled":
            return False

        stripe.Subscription.cancel(subscription.subscription_id)

        return True

    async def process_event(
        self,
        *,
        organization_id: str,
        event: Event,
        subscription_id: Optional[str] = None,
        plan: Optional[str] = None,
        anchor: Optional[int] = None,
        event_id: Optional[str] = None,
        effective_at: Optional[datetime] = None,
        period_start: Optional[datetime] = None,
        period_end: Optional[datetime] = None,
        # force: Optional[bool] = True,
        **kwargs,
    ) -> SubscriptionDTO:
        """Apply one subscription lifecycle event.

        `event_id` is Stripe's `stripe_event.id` on the webhook (stable across retries);
        the direct routes have none. `effective_at` is when the change took effect, and
        `period_start`/`period_end` the new subscription's billing period on a creation;
        both feed the wallet proration.

        With wallets enabled, the whole event runs under the organization's subscription
        lock, so a second submission of the same switch sees the new plan and is refused,
        and two changes cannot interleave their wallet adjustments. Open-designs item 22.
        """
        lock = (
            self.subscriptions_dao.lock(organization_id=organization_id)
            if env.wallets.enabled
            else nullcontext()
        )
        async with lock:
            return await self._process_event(
                organization_id=organization_id,
                event=event,
                subscription_id=subscription_id,
                plan=plan,
                anchor=anchor,
                event_id=event_id,
                effective_at=effective_at,
                period_start=period_start,
                period_end=period_end,
            )

    async def _process_event(
        self,
        *,
        organization_id: str,
        event: Event,
        subscription_id: Optional[str],
        plan: Optional[str],
        anchor: Optional[int],
        event_id: Optional[str],
        effective_at: Optional[datetime],
        period_start: Optional[datetime],
        period_end: Optional[datetime],
    ) -> SubscriptionDTO:
        log.info(
            "[billing] [internal] %s | %s | %s",
            organization_id,
            event,
            plan,
        )

        now = effective_at or datetime.now(tz=timezone.utc)

        if not anchor:
            anchor = now.day

        subscription = await self.read(organization_id=organization_id)

        if not subscription:
            raise EventException(
                "Subscription not found for organization ID: {organization_id}"
            )

        previous_plan = subscription.plan
        free_plan = get_free_plan()

        if event == Event.SUBSCRIPTION_CREATED:
            subscription.active = True
            subscription.plan = plan
            subscription.subscription_id = subscription_id
            subscription.anchor = anchor

            subscription = await self.update(subscription=subscription)

        elif subscription.plan != free_plan and event == Event.SUBSCRIPTION_PAUSED:
            subscription.active = False

            subscription = await self.update(subscription=subscription)

        elif subscription.plan != free_plan and event == Event.SUBSCRIPTION_RESUMED:
            subscription.active = True

            subscription = await self.update(subscription=subscription)

        elif subscription.plan != free_plan and event == Event.SUBSCRIPTION_SWITCHED:
            stripe = _load_stripe()
            if stripe is None:
                log.warn("✗ Stripe unavailable")
                raise EventException("Stripe is not available for plan switching")

            if subscription.plan == plan:
                log.warn("Subscription already on the plan: %s", plan)

                raise EventException(
                    f"Same plan [{plan}] already exists for organization ID: {organization_id}"
                )

            if not subscription.subscription_id:
                raise SwitchException(
                    f"Cannot switch plans without an existing subscription for organization ID: {organization_id}"
                )

            try:
                _subscription = stripe.Subscription.retrieve(
                    id=subscription.subscription_id,
                )
            except Exception as e:  # pylint: disable=too-broad-exception
                log.warn(
                    "Failed to retrieve subscription from Stripe: %s", subscription
                )

                raise EventException(
                    "Could not switch plans. Please try again or contact support.",
                ) from e

            subscription.active = True
            subscription.plan = plan
            # A switch keeps the subscription and its billing period.
            period_start, period_end = current_billing_period(_subscription)

            stripe.Subscription.modify(
                subscription.subscription_id,
                items=[
                    {"id": item.id, "deleted": True}
                    for item in stripe.SubscriptionItem.list(
                        subscription=subscription.subscription_id,
                    ).data
                ]
                + get_stripe_line_items(plan),
            )

            subscription = await self.update(subscription=subscription)

        elif subscription.plan != free_plan and event == Event.SUBSCRIPTION_CANCELLED:
            subscription.active = True
            subscription.plan = free_plan
            subscription.subscription_id = None
            subscription.anchor = anchor

            subscription = await self.update(subscription=subscription)

        elif subscription.plan == free_plan and event == Event.SUBSCRIPTION_CANCELLED:
            log.info(
                "Subscription already cancelled for organization ID: %s",
                organization_id,
            )

        else:
            log.warn("Invalid subscription event: %s ", subscription)

            raise EventException(
                f"Invalid subscription event {event} for organization ID: {organization_id}"
            )

        # Invalidate the entitlements subscription cache so the new plan takes effect immediately
        await invalidate_cache(
            namespace="entitlements:subscription",
            key={"organization_id": organization_id},
        )

        # `update` returns None when the row has gone; an AttributeError here would escape
        # into the Stripe webhook boundary and make the event look unacknowledged.
        if subscription is not None and subscription.plan != previous_plan:
            await self._apply_wallet_plan_change(
                organization_id=organization_id,
                subscription_id=subscription.subscription_id,
                outgoing_plan=previous_plan,
                incoming_plan=subscription.plan,
                period_start=period_start,
                period_end=period_end,
                event_id=event_id,
                now=now,
            )

        return subscription

    async def _apply_wallet_plan_change(
        self,
        *,
        organization_id: str,
        subscription_id: Optional[str],
        outgoing_plan: str,
        incoming_plan: str,
        period_start: Optional[datetime],
        period_end: Optional[datetime],
        event_id: Optional[str],
        now: datetime,
    ) -> None:
        """Prorate the wallet's plan allowance for a mid-period plan change.

        The key is `plan_change:{event_id}` on a webhook (Stripe reuses the id on
        retries), otherwise fresh per call. A fresh key is safe only because
        `process_event` holds the subscription lock: a repeated switch sees the new plan
        and never gets here, and a transition repeated in one period is a new change.

        Best-effort: logged and swallowed, so a wallet bug neither blocks Stripe's
        acknowledgement nor rolls back a committed subscription change. A SWALLOWED
        FAILURE IS NOT SELF-HEALING: a redelivery finds the plan already changed and
        skips this hook, and nothing records the owed proration. Accepted as
        open-designs item 22, option 3 (deferred).
        """
        if not env.wallets.enabled:
            return

        try:
            if self.wallets_service is None:
                raise RuntimeError("No wallets service was wired into this service")

            await self.wallets_service.apply_plan_change(
                organization_id=UUID(organization_id),
                idempotency_key=f"plan_change:{event_id or uuid_utils.uuid7()}",
                subscription_id=subscription_id,
                incoming_plan=incoming_plan,
                period_start=period_start,
                period_end=period_end,
                now=now,
            )
        except Exception as exc:
            log.error(
                "[wallets] Failed to apply plan-change proration for organization "
                "[%s] (%s -> %s): %s",
                organization_id,
                outgoing_plan,
                incoming_plan,
                exc,
            )
