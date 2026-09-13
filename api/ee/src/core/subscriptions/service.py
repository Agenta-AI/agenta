from typing import Optional
from uuid import UUID, getnode
from datetime import datetime, timezone, timedelta

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
from ee.src.core.wallets.proration import billing_period_bounds
from ee.src.core.wallets.runtime import get_wallets_service

log = get_module_logger(__name__)

MAC_ADDRESS = ":".join(f"{(getnode() >> ele) & 0xFF:02x}" for ele in range(40, -1, -8))


class SwitchException(Exception):
    pass


class EventException(Exception):
    pass


class SubscriptionsService:
    def __init__(
        self,
        subscriptions_dao: SubscriptionsDAOInterface,
    ):
        self.subscriptions_dao = subscriptions_dao

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
        # force: Optional[bool] = True,
        **kwargs,
    ) -> SubscriptionDTO:
        """Apply one subscription lifecycle event.

        `event_id` identifies the DELIVERY that carried this event — Stripe's own
        `stripe_event.id` at the webhook boundary, which is stable across Stripe's
        retries and distinct for two genuinely different changes. It is the wallet
        proration's idempotency identity; see `_apply_wallet_plan_change`. The direct
        (non-webhook) plan-switch and cancel routes have no such identifier and pass
        none.
        """
        log.info(
            "[billing] [internal] %s | %s | %s",
            organization_id,
            event,
            plan,
        )

        now = datetime.now(tz=timezone.utc)

        if not anchor:
            anchor = now.day

        subscription = await self.read(organization_id=organization_id)

        if not subscription:
            raise EventException(
                "Subscription not found for organization ID: {organization_id}"
            )

        previous_plan = subscription.plan
        # The outgoing clawback is prorated over the window the OUTGOING allowance was
        # granted for, so that anchor must be read before a branch below overwrites
        # `subscription.anchor`: prorating a cancellation over a window that starts today
        # claws back nearly the whole allowance whatever the customer used. The incoming
        # grant uses the post-event anchor instead — see `_apply_wallet_plan_change`.
        previous_anchor = subscription.anchor
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

        # `update` returns None when the row has gone (it is `Optional[SubscriptionDTO]`),
        # and this function returned that None long before the wallet hook existed. Guard
        # the dereference rather than change that: an AttributeError here would escape
        # into the Stripe webhook boundary and make the event look unacknowledged.
        if subscription is not None and subscription.plan != previous_plan:
            await self._apply_wallet_plan_change(
                organization_id=organization_id,
                event=event,
                subscription_id=subscription.subscription_id,
                outgoing_plan=previous_plan,
                incoming_plan=subscription.plan,
                outgoing_anchor=previous_anchor,
                incoming_anchor=subscription.anchor,
                event_id=event_id,
                now=now,
            )

        return subscription

    async def _apply_wallet_plan_change(
        self,
        *,
        organization_id: str,
        event: Event,
        subscription_id: Optional[str],
        outgoing_plan: str,
        incoming_plan: str,
        outgoing_anchor: Optional[int],
        incoming_anchor: Optional[int],
        event_id: Optional[str],
        now: datetime,
    ) -> None:
        """Prorate the wallet's plan-allowance credit for a mid-period plan change.

        TWO ANCHORS, TWO WINDOWS. `outgoing_anchor` is the subscription's anchor day
        BEFORE this event: it defines the period the outgoing allowance was granted for,
        which is the only period a remainder can be clawed back out of. `incoming_anchor`
        is the anchor the subscription now carries — on a new subscription that is
        Stripe's own `billing_cycle_anchor`, threaded through from the webhook — and it
        defines the period the incoming allowance will cover, so it sizes the new credit
        and sets its expiry. `SUBSCRIPTION_SWITCHED` never moves the anchor, so both
        windows are then the same window and the arithmetic is unchanged.

        `idempotency_key` IDENTIFIES THE OCCURRENCE, and it has two shapes:

        * `plan_change:{event_id}` whenever a delivery identifier reached us. Stripe
          redelivers a retried event under the same `stripe_event.id`, which must be one
          change, and gives two genuinely distinct changes different ids, which must both
          apply. That is exactly the identity this key needs, so when it is present
          nothing else belongs in the key — the same one-prefix-one-identifier shape as
          `measurement:{measurement_id}` (`ee.src.tasks.asyncio.measurements.worker`).
        * `plan_change:{subscription_id}:{incoming period start}` as the fallback, for the
          direct plan-switch and cancel routes, which are synchronous user actions with no
          delivery to identify. The incoming period is used because it is the one still
          reconstructible from the stored subscription afterwards; the outgoing anchor is
          overwritten by this same event.

        The fallback still collides on TWO DIRECT SWITCHES IN ONE BILLING PERIOD for the
        same subscription: the second is treated as a replay of the first and moves no
        money. That residue is open-designs item 22 ("What identifies one plan change"),
        and it is now the only case left — the webhook path, which is every Stripe-driven
        change, is fully identified.

        Best-effort: logged and swallowed, never raised into the billing-webhook
        boundary. A wallet-side bug here must not block Stripe event acknowledgement
        (which would only cause Stripe to retry indefinitely) or roll back a subscription
        change that already committed. A SWALLOWED FAILURE IS NOT SELF-HEALING: the caller
        runs this hook only when the plan actually changed, so a redelivery of the same
        webhook finds the plan already changed and skips the hook entirely, and nothing
        durable records that the proration is still owed. Only a reconciliation job — one
        that compares subscriptions against wallet credits and re-drives the missing
        change — recovers it, and no such job exists yet; that is the second half of
        open-designs item 22. `apply_plan_change` being idempotent makes such a job safe
        to run, which is not the same as making this call converge on its own.
        """
        if not env.wallets.enabled:
            return

        try:
            # Inside the try, not above it: the never-raises promise in the docstring
            # covers everything this helper does, and deriving the window is as much a
            # place for a wallet-side bug as the call it feeds.
            outgoing_period_start, outgoing_period_end = billing_period_bounds(
                now=now, anchor=outgoing_anchor
            )
            incoming_period_start, incoming_period_end = billing_period_bounds(
                now=now, anchor=incoming_anchor
            )
            idempotency_key = (
                f"plan_change:{event_id}"
                if event_id
                else f"plan_change:{subscription_id or 'none'}:{incoming_period_start.isoformat()}"
            )

            await get_wallets_service().apply_plan_change(
                organization_id=UUID(organization_id),
                idempotency_key=idempotency_key,
                outgoing_plan=outgoing_plan,
                incoming_plan=incoming_plan,
                outgoing_period_start=outgoing_period_start,
                outgoing_period_end=outgoing_period_end,
                incoming_period_start=incoming_period_start,
                incoming_period_end=incoming_period_end,
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
