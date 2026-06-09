from typing import Optional
from uuid import getnode
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

    async def provision_signup_subscription(
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

    async def process_event(
        self,
        *,
        organization_id: str,
        event: Event,
        subscription_id: Optional[str] = None,
        plan: Optional[str] = None,
        anchor: Optional[int] = None,
        # force: Optional[bool] = True,
        **kwargs,
    ) -> SubscriptionDTO:
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

        return subscription

    async def cancel_stripe_subscription(
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

        stripe_subscription = stripe.Subscription.retrieve(subscription.subscription_id)

        status = getattr(stripe_subscription, "status", None)
        if status == "canceled":
            return False

        stripe.Subscription.cancel(subscription.subscription_id)
        return True
