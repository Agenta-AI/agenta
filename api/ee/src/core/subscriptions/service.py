from typing import Optional
from uuid import getnode
from datetime import datetime, timezone, timedelta


import stripe

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env
from oss.src.utils.caching import invalidate_cache

from ee.src.core.subscriptions.types import (
    SubscriptionDTO,
    Event,
    Plan,
    FREE_PLAN,
    REVERSE_TRIAL_PLAN,
    REVERSE_TRIAL_DAYS,
    get_default_plan,
)
from ee.src.core.subscriptions.interfaces import SubscriptionsDAOInterface
from ee.src.core.entitlements.service import EntitlementsService
from ee.src.core.meters.service import MetersService

log = get_module_logger(__name__)

# Initialize Stripe only if enabled
if env.stripe.enabled:
    stripe.api_key = env.stripe.api_key
    log.info("✓ Stripe enabled:", target=env.stripe.webhook_target)
else:
    log.info("✗ Stripe disabled")

MAC_ADDRESS = ":".join(f"{(getnode() >> ele) & 0xFF:02x}" for ele in range(40, -1, -8))


class SwitchException(Exception):
    pass


class EventException(Exception):
    pass


class SubscriptionsService:
    def __init__(
        self,
        subscriptions_dao: SubscriptionsDAOInterface,
        meters_service: MetersService,
    ):
        self.subscriptions_dao = subscriptions_dao
        self.meters_service = meters_service
        self.entitlements_service = EntitlementsService(meters_service=meters_service)

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
        if not env.stripe.enabled:
            raise EventException("Reverse trial requires Stripe to be enabled")

        now = datetime.now(tz=timezone.utc)
        anchor = now + timedelta(days=REVERSE_TRIAL_DAYS)

        subscription = await self.read(organization_id=organization_id)

        if subscription:
            return None

        subscription = await self.create(
            subscription=SubscriptionDTO(
                organization_id=organization_id,
                plan=FREE_PLAN,
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
            items=list(env.stripe.pricing[REVERSE_TRIAL_PLAN].values()),
            #
            # automatic_tax={"enabled": True},
            metadata={
                "organization_id": organization_id,
                "plan": REVERSE_TRIAL_PLAN.value,
                "target": env.stripe.webhook_target,
            },
            #
            trial_period_days=REVERSE_TRIAL_DAYS,
            trial_settings={"end_behavior": {"missing_payment_method": "cancel"}},
        )

        subscription = await self.update(
            subscription=SubscriptionDTO(
                organization_id=organization_id,
                customer_id=customer_id,
                subscription_id=stripe_subscription.id,
                plan=REVERSE_TRIAL_PLAN,
                active=True,
                anchor=anchor.day,
            )
        )

        return subscription

    async def start_plan(
        self,
        *,
        organization_id: str,
        plan: Plan,
    ) -> Optional[SubscriptionDTO]:
        """Start a specific plan for an organization.

        Args:
            organization_id: The organization ID
            plan: The plan to assign

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

        log.info("✓ Plan [%s] started for organization %s", plan.value, organization_id)

        return subscription

    async def provision_signup_subscription(
        self,
        *,
        organization_id: str,
        organization_name: str,
        organization_email: str,
    ) -> Optional[SubscriptionDTO]:
        """Provision the initial subscription for a newly signed-up organization.

        Cloud signups use the reverse-trial flow. Self-hosted deployments start
        directly on the configured default plan.
        """
        if env.stripe.enabled:
            return await self.start_reverse_trial(
                organization_id=organization_id,
                organization_name=organization_name,
                organization_email=organization_email,
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
        plan: Optional[Plan] = None,
        anchor: Optional[Plan] = None,
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

        if event == Event.SUBSCRIPTION_CREATED:
            subscription.active = True
            subscription.plan = plan
            subscription.subscription_id = subscription_id
            subscription.anchor = anchor

            subscription = await self.update(subscription=subscription)

        elif subscription.plan != FREE_PLAN and event == Event.SUBSCRIPTION_PAUSED:
            subscription.active = False

            subscription = await self.update(subscription=subscription)

        elif subscription.plan != FREE_PLAN and event == Event.SUBSCRIPTION_RESUMED:
            subscription.active = True

            subscription = await self.update(subscription=subscription)

        elif subscription.plan != FREE_PLAN and event == Event.SUBSCRIPTION_SWITCHED:
            if not env.stripe.enabled:
                log.warn("✗ Stripe disabled")
                return None

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

            # await self.entitlements_service.enforce(
            #     organization_id=organization_id,
            #     plan=plan,
            #     force=force,
            # )

            stripe.Subscription.modify(
                subscription.subscription_id,
                items=[
                    {"id": item.id, "deleted": True}
                    for item in stripe.SubscriptionItem.list(
                        subscription=subscription.subscription_id,
                    ).data
                ]
                + list(env.stripe.pricing[plan].values()),
            )

            subscription = await self.update(subscription=subscription)

        elif subscription.plan != FREE_PLAN and event == Event.SUBSCRIPTION_CANCELLED:
            subscription.active = True
            subscription.plan = FREE_PLAN
            subscription.subscription_id = None
            subscription.anchor = anchor

            # await self.entitlements_service.enforce(
            #     organization_id=organization_id,
            #     plan=FREE_PLAN,
            #     force=True,
            # )

            subscription = await self.update(subscription=subscription)

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
