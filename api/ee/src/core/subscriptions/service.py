import asyncio
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
from ee.src.core.wallets.service import WalletsService

log = get_module_logger(__name__)

MAC_ADDRESS = ":".join(f"{(getnode() >> ele) & 0xFF:02x}" for ele in range(40, -1, -8))


class SwitchException(Exception):
    pass


class EventException(Exception):
    pass


class StaleEventException(Exception):
    """The event is for a subscription the organization no longer has. The webhook
    acknowledges it, so Stripe stops retrying, and nothing is written."""


_ENDED_STRIPE_STATUSES = frozenset({"canceled", "incomplete_expired"})


async def _stripe_subscription_ended(subscription_id: str) -> bool:
    """Whether Stripe reports the subscription as ended.

    Raises EventException when Stripe cannot be read, so the webhook answers non-2xx
    and Stripe retries the event instead of it being applied on a guess.
    """
    stripe = _load_stripe()
    if stripe is None:
        raise EventException("Stripe is not available to check the subscription")

    try:
        # The Stripe client is synchronous; keep the request off the event loop.
        stripe_subscription = await asyncio.to_thread(
            stripe.Subscription.retrieve, subscription_id
        )
    except Exception as e:  # pylint: disable=too-broad-exception
        log.warn("Failed to read subscription %s from Stripe", subscription_id)
        raise EventException(
            f"Could not read subscription {subscription_id} from Stripe"
        ) from e

    status = getattr(stripe_subscription, "status", None)
    if status is None and isinstance(stripe_subscription, dict):
        status = stripe_subscription.get("status")

    return status in _ENDED_STRIPE_STATUSES


async def _is_stale_event(
    *,
    event: Event,
    subscription_id: str,
    recorded_subscription_id: Optional[str],
    recorded_plan_is_free: bool,
) -> bool:
    """Whether a Stripe event is for a subscription the organization no longer has.

    Stripe delivers events out of order and retries them for days, so an event can
    arrive after the organization's subscription changed. A different id alone does
    not prove the event is older, so Stripe decides: an ended subscription's event
    is stale; a live one's is applied (CREATED) or refused so Stripe retries it.
    """
    if subscription_id == recorded_subscription_id:
        return False

    # A paid row with no recorded id has nothing to compare: apply, as before.
    if (
        event != Event.SUBSCRIPTION_CREATED
        and not recorded_subscription_id
        and not recorded_plan_is_free
    ):
        return False

    if await _stripe_subscription_ended(subscription_id):
        return True

    # A live subscription the row does not record yet: CREATED records it. Any other
    # event waits for that, so it is refused and Stripe retries it.
    if event == Event.SUBSCRIPTION_CREATED:
        return False

    raise EventException(
        f"Event {event.value} is for subscription {subscription_id}, which is live "
        "but not the one recorded yet"
    )


class SubscriptionsService:
    def __init__(
        self,
        subscriptions_dao: SubscriptionsDAOInterface,
        wallets_service: Optional[WalletsService] = None,
    ):
        self.subscriptions_dao = subscriptions_dao
        # Wired only into the billing router's instance, which handles the Stripe
        # webhook. A plan change writes nothing to the wallet: it changes which plan
        # allowance the next billing period grants (open-designs items 22 and 23).
        self.wallets_service = wallets_service

    async def grant_period_credits(
        self,
        *,
        organization_id: str,
        plan: str,
        period_start: datetime,
        period_end: datetime,
    ) -> None:
        """Grant the monthly credits of a paid billing period. Idempotent per
        organization and period (see `WalletsService.grant_period_allowance`)."""
        if not env.wallets.enabled or self.wallets_service is None:
            return

        credit = await self.wallets_service.grant_period_allowance(
            organization_id=UUID(organization_id),
            plan=plan,
            period_start=period_start,
            period_end=period_end,
        )

        log.info(
            "[billing] [wallets] period credits %s | %s | %s | %s",
            organization_id,
            plan,
            period_start.isoformat(),
            credit.amount_musd if credit else 0,
        )

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

    async def _apply_event_write(
        self,
        *,
        subscription: SubscriptionDTO,
        recorded_subscription_id: Optional[str],
        guarded: bool,
    ) -> Optional[SubscriptionDTO]:
        """Write the row an event produced. A Stripe event's write applies only if the
        row still records the subscription it was checked against; otherwise another
        event changed it in between and this one is refused, so Stripe retries it."""
        if not guarded:
            return await self.update(subscription=subscription)

        updated = await self.subscriptions_dao.update(
            subscription=subscription,
            check_subscription_id=True,
            expected_subscription_id=recorded_subscription_id,
        )

        if updated is None:
            raise EventException(
                f"The subscription for organization ID {subscription.organization_id} "
                "changed while the event was applied"
            )

        return updated

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

        - Stripe enabled, a pricing entry carries `"trial": N` → reverse trial.
        - Stripe enabled, no trial entry     → onboard on the free plan.
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
            log.warn(
                "[billing] [internal] no subscription row | %s | %s",
                organization_id,
                event.value,
            )

            raise EventException(
                f"No subscription is recorded for organization ID {organization_id}, "
                f"so event {event.value} cannot be applied"
            )

        free_plan = get_free_plan()

        if subscription_id and await _is_stale_event(
            event=event,
            subscription_id=subscription_id,
            recorded_subscription_id=subscription.subscription_id,
            recorded_plan_is_free=subscription.plan == free_plan,
        ):
            log.info(
                "[billing] [internal] stale subscription event | %s | %s | recorded=%s | event=%s",
                organization_id,
                event.value,
                subscription.subscription_id,
                subscription_id,
            )

            raise StaleEventException(
                f"Event {event.value} is for subscription {subscription_id}, not the "
                f"one recorded for organization ID {organization_id}"
            )

        recorded_subscription_id = subscription.subscription_id
        guarded = subscription_id is not None

        if event == Event.SUBSCRIPTION_CREATED:
            subscription.active = True
            subscription.plan = plan
            subscription.subscription_id = subscription_id
            subscription.anchor = anchor

            subscription = await self._apply_event_write(
                subscription=subscription,
                recorded_subscription_id=recorded_subscription_id,
                guarded=guarded,
            )

        elif subscription.plan != free_plan and event == Event.SUBSCRIPTION_PAUSED:
            subscription.active = False

            subscription = await self._apply_event_write(
                subscription=subscription,
                recorded_subscription_id=recorded_subscription_id,
                guarded=guarded,
            )

        elif subscription.plan != free_plan and event == Event.SUBSCRIPTION_RESUMED:
            subscription.active = True

            subscription = await self._apply_event_write(
                subscription=subscription,
                recorded_subscription_id=recorded_subscription_id,
                guarded=guarded,
            )

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

            line_items = get_stripe_line_items(plan)

            # Stripe rejects a subscription left with no items.
            if not line_items:
                raise SwitchException(
                    f"Plan [{plan}] has no Stripe prices and cannot be switched to. Please contact support."
                )

            try:
                stripe.Subscription.modify(
                    subscription.subscription_id,
                    items=[
                        {"id": item.id, "deleted": True}
                        for item in stripe.SubscriptionItem.list(
                            subscription=subscription.subscription_id,
                        ).data
                    ]
                    + line_items,
                    # Invoices snapshot this metadata, and the renewal's monthly credits
                    # follow the plan it names (see BillingRouter._grant_period_credits).
                    metadata={"plan": plan},
                )
            except Exception as e:  # pylint: disable=too-broad-exception
                log.warn("Failed to switch subscription in Stripe: %s", subscription)

                raise EventException(
                    "Could not switch plans. Please try again or contact support.",
                ) from e

            subscription.active = True
            subscription.plan = plan

            subscription = await self._apply_event_write(
                subscription=subscription,
                recorded_subscription_id=recorded_subscription_id,
                guarded=guarded,
            )

        elif subscription.plan != free_plan and event == Event.SUBSCRIPTION_CANCELLED:
            subscription.active = True
            subscription.plan = free_plan
            subscription.subscription_id = None
            subscription.anchor = anchor

            subscription = await self._apply_event_write(
                subscription=subscription,
                recorded_subscription_id=recorded_subscription_id,
                guarded=guarded,
            )

        elif subscription.plan == free_plan and event == Event.SUBSCRIPTION_CANCELLED:
            log.info(
                "Subscription already cancelled for organization ID: %s",
                organization_id,
            )

        else:
            # Every branch above missed. PAUSED, RESUMED and SWITCHED are each
            # guarded by `plan != free_plan`, and CANCELLED has its own
            # free-plan no-op, so reaching here means the organization's
            # recorded plan IS the free plan: there is no paid subscription for
            # the event to act on.
            log.warn(
                "[billing] [internal] unhandled subscription event | %s | %s | plan=%s | active=%s",
                organization_id,
                event.value,
                subscription.plan,
                subscription.active,
            )

            raise EventException(
                f"Event {event.value} does not apply to organization ID "
                f"{organization_id}, whose recorded plan is "
                f"{subscription.plan or 'unset'}"
            )

        # Invalidate the entitlements subscription cache so the new plan takes effect immediately
        await invalidate_cache(
            namespace="entitlements:subscription",
            key={"organization_id": organization_id},
        )

        return subscription
