from typing import Any, Dict
from json import loads, decoder
from datetime import datetime, timezone
from dateutil.relativedelta import relativedelta

from fastapi import APIRouter, Request, status, HTTPException, Query
from fastapi.responses import JSONResponse

import stripe

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.caching import acquire_lock, release_lock, renew_lock
from oss.src.utils.env import env

from ee.src.utils.entitlements import period_from, scope_from
from ee.src.core.meters.types import Meters, MeterPeriod
from oss.src.utils.context import get_auth_scope

from oss.src.services.db_manager import (
    get_user_with_id,
    get_organization_by_id,
)

from ee.src.services import db_manager_ee
from ee.src.utils.permissions import check_action_access
from ee.src.models.shared_models import Permission
from ee.src.core.entitlements.types import Tracker, Quota, Period, Scope
from ee.src.core.entitlements.controls import get_plan_entitlements, get_plans
from ee.src.core.subscriptions.settings import (
    get_catalog,
    get_pricing_plan,
    get_stripe_line_items,
    get_free_plan,
    get_effective_pricing,
)
from ee.src.core.subscriptions.types import Event
from ee.src.core.meters.service import MetersService
from ee.src.core.subscriptions.service import (
    SubscriptionsService,
    SwitchException,
    EventException,
)
from ee.src.core.organizations.types import OrganizationUpdate


log = get_module_logger(__name__)

# Initialize Stripe only if enabled
if env.stripe.enabled:
    stripe.api_key = env.stripe.api_key
    log.info("✓ Stripe enabled:", target=env.stripe.webhook_target)
else:
    log.info("✗ Stripe disabled")

FORBIDDEN_RESPONSE = JSONResponse(
    status_code=403,
    content={
        "detail": "You do not have access to perform this action. Please contact your organization admin.",
    },
)


def _stripe_get(
    value: Any,
    key: str,
    default: Any = None,
) -> Any:
    if value is None:
        return default

    if isinstance(value, dict):
        return value.get(key, default)

    try:
        return getattr(value, key)
    except AttributeError:
        return default


def _stripe_has(
    value: Any,
    key: str,
) -> bool:
    if value is None:
        return False

    if isinstance(value, dict):
        return key in value

    try:
        getattr(value, key)
        return True
    except AttributeError:
        return False


class BillingRouter:
    def __init__(
        self,
        subscription_service: SubscriptionsService,
        meters_service: MetersService,
    ):
        self.subscription_service = subscription_service
        self.meters_service = meters_service

        # ROUTER
        self.router = APIRouter()

        # USES 'env.stripe.webhook_secret', SHOULD BE IN A DIFFERENT ROUTER
        self.router.add_api_route(
            "/stripe/events/",
            self.handle_events,
            methods=["POST"],
            operation_id="handle_events",
        )

        self.router.add_api_route(
            "/stripe/portals/",
            self.create_portal_user_route,
            methods=["POST"],
            operation_id="create_portal",
        )

        self.router.add_api_route(
            "/stripe/checkouts/",
            self.create_checkout_user_route,
            methods=["POST"],
            operation_id="create_checkout",
        )

        self.router.add_api_route(
            "/plans",
            self.fetch_plan_user_route,
            methods=["GET"],
            operation_id="fetch_plans",
        )

        self.router.add_api_route(
            "/plans/switch",
            self.switch_plans_user_route,
            methods=["POST"],
            operation_id="switch_plans",
        )

        self.router.add_api_route(
            "/subscription",
            self.fetch_subscription_user_route,
            methods=["GET"],
            operation_id="fetch_subscription",
        )

        self.router.add_api_route(
            "/subscription/cancel",
            self.cancel_subscription_user_route,
            methods=["POST"],
            operation_id="cancel_plan",
        )

        self.router.add_api_route(
            "/usage",
            self.fetch_usage_user_route,
            methods=["GET"],
            operation_id="fetch_usage",
        )

        self.router.add_api_route(
            "/catalog",
            self.fetch_catalog,
            methods=["GET"],
            operation_id="fetch_billing_catalog",
        )

        self.router.add_api_route(
            "/pricing",
            self.fetch_pricing,
            methods=["GET"],
            operation_id="fetch_billing_pricing",
        )

        # ADMIN ROUTER
        self.admin_router = APIRouter()

        self.admin_router.add_api_route(
            "/stripe/portals/",
            self.create_portal_admin_route,
            methods=["POST"],
        )

        self.admin_router.add_api_route(
            "/stripe/checkouts/",
            self.create_checkout_admin_route,
            methods=["POST"],
        )

        self.admin_router.add_api_route(
            "/plans/switch",
            self.switch_plans_admin_route,
            methods=["POST"],
        )

        self.admin_router.add_api_route(
            "/subscription/cancel",
            self.cancel_subscription_admin_route,
            methods=["POST"],
        )

        # DOESN'T REQUIRE 'organization_id'
        self.admin_router.add_api_route(
            "/usage/report",
            self.report_usage,
            methods=["POST"],
        )

        self.admin_router.add_api_route(
            "/usage/report/unlock",
            self.unlock_report_usage,
            methods=["POST"],
        )

    async def _reset_organization_flags(self, organization_id: str) -> None:
        organization = await db_manager_ee.get_organization(organization_id)
        if not organization:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found",
            )

        existing_flags = organization.flags or {}
        default_flags = {
            "is_demo": existing_flags.get("is_demo", False),
            "allow_email": env.auth.email_enabled,
            "allow_social": env.auth.oidc_enabled,
            "allow_sso": False,
            "allow_root": False,
            "domains_only": False,
            "auto_join": False,
        }
        await db_manager_ee.update_organization(
            organization_id,
            OrganizationUpdate(flags=default_flags),
        )

    # HANDLERS

    @intercept_exceptions()
    async def handle_events(
        self,
        request: Request,
    ):
        # No-op if Stripe is disabled
        if not env.stripe.enabled:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={"status": "ok", "message": "Stripe not configured"},
            )

        payload = await request.body()
        stripe_event = None

        try:
            stripe_event = loads(payload)
        except decoder.JSONDecodeError:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"status": "error", "message": "Payload extraction failed"},
            )

        try:
            stripe_event = stripe.Event.construct_from(
                stripe_event,
                stripe.api_key,
            )
        except ValueError as e:
            log.error("Could not construct stripe event: %s", e)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid payload",
            ) from e

        try:
            sig_header = request.headers.get("stripe-signature")

            if env.stripe.webhook_secret:
                stripe_event = stripe.Webhook.construct_event(
                    payload,
                    sig_header,
                    env.stripe.webhook_secret,
                )
        except stripe.error.SignatureVerificationError as e:
            log.error("Webhook signature verification failed: %s", e)
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"status": "error", "message": "Signature verification failed"},
            )

        metadata = None

        if not stripe_event.type.startswith("invoice"):
            if not _stripe_has(stripe_event.data.object, "metadata"):
                log.warn("Skipping stripe event: %s (no metadata)", stripe_event.type)
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"status": "error", "message": "Metadata not found"},
                )
            else:
                metadata = _stripe_get(stripe_event.data.object, "metadata")

        if stripe_event.type.startswith("invoice"):
            subscription_details = _stripe_get(
                stripe_event.data.object,
                "subscription_details",
            )

            if not _stripe_has(subscription_details, "metadata"):
                log.warn("Skipping stripe event: %s (no metadata)", stripe_event.type)

                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"status": "error", "message": "Metadata not found"},
                )
            else:
                metadata = _stripe_get(subscription_details, "metadata")

        if not _stripe_has(metadata, "target"):
            log.warn("Skipping stripe event: %s (no target)", stripe_event.type)
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"status": "error", "message": "Target not found"},
            )

        target = _stripe_get(metadata, "target")

        if target != env.stripe.webhook_target:
            log.warn(
                "Skipping stripe event: %s (wrong target: %s)",
                stripe_event.type,
                target,
            )
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={"status": "skip", "message": "Target mismatch"},
            )

        if not _stripe_has(metadata, "organization_id"):
            log.warn("Skipping stripe event: %s (no organization)", stripe_event.type)
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"status": "error", "message": "Organization ID not found"},
            )

        organization_id = _stripe_get(metadata, "organization_id")

        log.info(
            "[billing] [stripe]   %s | %s | %s",
            organization_id,
            stripe_event.type,
            target,
        )

        try:
            event = None
            subscription_id = None
            plan = None
            anchor = None

            if stripe_event.type == "customer.subscription.created":
                event = Event.SUBSCRIPTION_CREATED

                if not _stripe_has(stripe_event.data.object, "id"):
                    log.warn(
                        "Skipping stripe event: %s (no subscription)",
                        stripe_event.type,
                    )
                    return JSONResponse(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        content={
                            "status": "error",
                            "message": "Subscription ID not found",
                        },
                    )

                subscription_id = _stripe_get(stripe_event.data.object, "id")

                if not _stripe_has(metadata, "plan"):
                    log.warn("Skipping stripe event: %s (no plan)", stripe_event.type)
                    return JSONResponse(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        content={
                            "status": "error",
                            "message": "Plan not found",
                        },
                    )

                plan = _stripe_get(metadata, "plan")
                if not plan:
                    log.warn(
                        "Skipping stripe event: %s (missing plan metadata)",
                        stripe_event.type,
                    )
                    return JSONResponse(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        content={
                            "status": "error",
                            "message": "Missing plan metadata on Stripe event",
                        },
                    )
                if plan not in get_plans():
                    log.warn(
                        "Skipping stripe event: %s (unknown plan %s)",
                        stripe_event.type,
                        plan,
                    )
                    return JSONResponse(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        content={
                            "status": "error",
                            "message": f"Unknown plan '{plan}'",
                        },
                    )

                if not _stripe_has(stripe_event.data.object, "billing_cycle_anchor"):
                    log.warn("Skipping stripe event: %s (no anchor)", stripe_event.type)
                    return JSONResponse(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        content={
                            "status": "error",
                            "message": "Anchor not found",
                        },
                    )

                anchor = datetime.fromtimestamp(
                    _stripe_get(stripe_event.data.object, "billing_cycle_anchor"),
                    tz=timezone.utc,
                ).day

            elif stripe_event.type == "invoice.payment_failed":
                event = Event.SUBSCRIPTION_PAUSED

            elif stripe_event.type == "invoice.payment_succeeded":
                event = Event.SUBSCRIPTION_RESUMED

            elif stripe_event.type == "customer.subscription.deleted":
                event = Event.SUBSCRIPTION_CANCELLED

            else:
                log.warn("Skipping stripe event: %s (unsupported)", stripe_event.type)
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"status": "error", "message": "Unsupported event"},
                )

            subscription = await self.subscription_service.process_event(
                organization_id=organization_id,
                event=event,
                subscription_id=subscription_id,
                plan=plan,
                anchor=anchor,
            )
            if event == Event.SUBSCRIPTION_CANCELLED:
                await self._reset_organization_flags(organization_id)

        except Exception as e:
            raise HTTPException(status_code=500, detail="unexpected error") from e

        if not subscription:
            raise HTTPException(status_code=500, detail="unexpected error")

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"status": "success"},
        )

    async def create_portal(
        self,
        organization_id: str,
    ):
        # No-op if Stripe is disabled
        if not env.stripe.enabled:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={"status": "ok", "message": "Stripe not configured"},
            )

        subscription = await self.subscription_service.read(
            organization_id=organization_id,
        )

        if not subscription:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"status": "error", "message": "Subscription not found"},
            )

        if not subscription.customer_id:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "status": "error",
                    "message": "Access denied: please subscribe to a plan to access the portal",
                },
            )

        portal = stripe.billing_portal.Session.create(
            customer=subscription.customer_id,
        )

        return {"portal_url": portal.url}

    async def create_checkout(
        self,
        organization_id: str,
        plan: str,
        success_url: str,
    ):
        # No-op if Stripe is disabled
        if not env.stripe.enabled:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={"status": "ok", "message": "Stripe not configured"},
            )

        if plan not in get_plans():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid plan",
            )

        line_items = get_stripe_line_items(plan)
        if not line_items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Plan '{plan}' is not available for purchase (no Stripe line items configured).",
            )

        subscription = await self.subscription_service.read(
            organization_id=organization_id,
        )

        if not subscription:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "status": "error",
                    "message": "Subscription (Agenta) not found",
                },
            )

        if subscription.subscription_id:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "status": "error",
                    "message": "Subscription (Stripe) already exists",
                },
            )

        if not subscription.customer_id:
            organization = await get_organization_by_id(
                organization_id=organization_id,
            )

            if not organization:
                return JSONResponse(
                    status_code=status.HTTP_404_NOT_FOUND,
                    content={
                        "status": "error",
                        "message": "Organization not found",
                    },
                )

            user = await get_user_with_id(
                user_id=str(organization.owner_id),
            )

            if not user:
                return JSONResponse(
                    status_code=status.HTTP_404_NOT_FOUND,
                    content={"status": "error", "message": "Owner not found"},
                )

            customer = stripe.Customer.create(
                name=organization.name,
                email=user.email,
                metadata={
                    "organization_id": organization_id,
                    "target": env.stripe.webhook_target,
                },
            )

            subscription.customer_id = customer.id

            await self.subscription_service.update(
                subscription=subscription,
            )

        checkout = stripe.checkout.Session.create(
            mode="subscription",
            payment_method_types=["card"],
            allow_promotion_codes=True,
            customer_update={"address": "auto", "name": "auto"},
            billing_address_collection="required",
            automatic_tax={"enabled": True},
            tax_id_collection={"enabled": True},
            #
            customer=subscription.customer_id,
            line_items=line_items,
            #
            subscription_data={
                # "billing_cycle_anchor": anchor,
                "metadata": {
                    "organization_id": organization_id,
                    "plan": plan,
                    "target": env.stripe.webhook_target,
                },
            },
            #
            ui_mode="hosted_page",
            success_url=success_url,
        )

        return {"checkout_url": checkout.url}

    async def fetch_plans(
        self,
        organization_id: str,
    ):
        plans = []

        subscription = await self.subscription_service.read(
            organization_id=organization_id,
        )

        if not subscription:
            key = None
        else:
            key = subscription.plan

        for plan in get_catalog():
            if plan.get("type") == "standard":
                plans.append(plan)
            elif plan.get("type") == "custom" and plan.get("plan") == key:
                plans.append(plan)

        return plans

    async def switch_plans(
        self,
        organization_id: str,
        plan: str,
        # force: bool,
    ):
        if plan not in get_plans():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid plan",
            )

        try:
            subscription = await self.subscription_service.process_event(
                organization_id=organization_id,
                event=Event.SUBSCRIPTION_SWITCHED,
                plan=plan,
                # force=force,
            )

            if not subscription:
                raise HTTPException(status_code=500, detail="unexpected error")

        except EventException as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            ) from e

        except SwitchException as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            ) from e

        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="unexpected error",
            ) from e

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"status": "success"},
        )

    async def fetch_subscription(
        self,
        organization_id: str,
    ):
        now = datetime.now(timezone.utc)

        subscription = await self.subscription_service.read(
            organization_id=organization_id,
        )

        if not subscription or not subscription.plan:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "status": "error",
                    "message": "Subscription (Agenta) not found",
                },
            )

        plan = subscription.plan
        anchor = subscription.anchor

        _status: Dict[str, Any] = dict(
            plan=plan,
            type="standard",
        )

        if plan == get_free_plan():
            return _status

        # Self-hosted / non-Stripe plans still need a subscription status shape
        # for the frontend. Fall back to locally computed periods when Stripe
        # is disabled.

        _subscription = None

        if env.stripe.enabled:
            if not subscription.subscription_id:
                return JSONResponse(
                    status_code=status.HTTP_404_NOT_FOUND,
                    content={
                        "status": "error",
                        "message": "Subscription (Agenta) not found",
                    },
                )

            try:
                _subscription = stripe.Subscription.retrieve(
                    id=subscription.subscription_id,
                )
            except Exception:
                return JSONResponse(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    content={
                        "status": "error",
                        "message": "Subscription (Stripe) not found",
                    },
                )

        if _subscription:
            # Get period dates from the first subscription item
            items = _stripe_get(_subscription, "items")
            data = _stripe_get(items, "data") or []

            if len(data) > 0:
                item = data[0]
                period_start = _stripe_get(item, "current_period_start")
                period_end = _stripe_get(item, "current_period_end")

                if period_start is not None:
                    _status["period_start"] = int(period_start)

                if period_end is not None:
                    _status["period_end"] = int(period_end)

            _status["free_trial"] = _stripe_get(_subscription, "status") == "trialing"

            return _status

        if not anchor or anchor < 1 or anchor > 31:
            anchor = now.day

        last_day_this_month = (
            datetime(
                now.year,
                now.month,
                1,
                tzinfo=timezone.utc,
            )
            + relativedelta(
                months=+1,
                days=-1,
            )
        ).day

        day_this_month = min(anchor, last_day_this_month)

        if now.day < anchor:
            prev_month = now + relativedelta(
                months=-1,
            )

            last_day_prev_month = (
                datetime(
                    prev_month.year,
                    prev_month.month,
                    1,
                    tzinfo=timezone.utc,
                )
                + relativedelta(
                    months=+1,
                    days=-1,
                )
            ).day

            day_prev_month = min(anchor, last_day_prev_month)

            period_start = datetime(
                year=prev_month.year,
                month=prev_month.month,
                day=day_prev_month,
                tzinfo=timezone.utc,
            )
            period_end = datetime(
                year=now.year,
                month=now.month,
                day=day_this_month,
                tzinfo=timezone.utc,
            )
        else:
            period_start = datetime(
                year=now.year,
                month=now.month,
                day=day_this_month,
                tzinfo=timezone.utc,
            )

            next_month = now + relativedelta(
                months=+1,
            )

            last_day_next_month = (
                datetime(
                    next_month.year,
                    next_month.month,
                    1,
                    tzinfo=timezone.utc,
                )
                + relativedelta(
                    months=+1,
                    days=-1,
                )
            ).day

            day_next_month = min(anchor, last_day_next_month)

            period_end = datetime(
                year=next_month.year,
                month=next_month.month,
                day=day_next_month,
                tzinfo=timezone.utc,
            )

        _status["period_start"] = int(period_start.timestamp())
        _status["period_end"] = int(period_end.timestamp())
        _status["free_trial"] = False
        _status["type"] = "custom"

        return _status

    async def cancel_subscription(
        self,
        organization_id: str,
    ):
        subscription = await self.subscription_service.read(
            organization_id=organization_id,
        )

        if not subscription:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Subscription (Agenta) not found",
            )

        if not subscription.subscription_id:
            if subscription.plan == get_free_plan():
                return JSONResponse(
                    status_code=status.HTTP_200_OK,
                    content={"status": "success"},
                )

            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Subscription (Stripe) not found",
            )

        try:
            stripe_subscription = stripe.Subscription.retrieve(
                subscription.subscription_id
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not fetch subscription. Please try again or contact support.",
            ) from e

        if _stripe_get(stripe_subscription, "status") != "canceled":
            try:
                stripe.Subscription.cancel(subscription.subscription_id)
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Could not cancel subscription. Please try again or contact support.",
                ) from e

        try:
            await self.subscription_service.process_event(
                organization_id=organization_id,
                event=Event.SUBSCRIPTION_CANCELLED,
            )
        except EventException as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(e),
            ) from e

        await self._reset_organization_flags(organization_id)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"status": "success"},
        )

    async def fetch_usage(self):
        # Identity comes from the ambient AuthScope (set by the auth
        # middleware). The route wrapper has already done permission
        # checks; no path/query params for tenant identity — that would
        # introduce a path-param-vs-ambient mismatch surface.
        organization_id = str(get_auth_scope().organization_id)

        subscription = await self.subscription_service.read(
            organization_id=organization_id,
        )

        if not subscription:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"status": "error", "message": "Subscription not found"},
            )

        plan = subscription.plan

        if not plan:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"status": "error", "message": "Plan not found"},
            )

        entitlements = get_plan_entitlements(plan)

        # `None` means the plan is unknown — 404 the request. `{}` means the
        # plan exists but defines no enforced trackers (description-only,
        # display-only plan). In that case we return an empty usage map.
        if entitlements is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"status": "error", "message": "Entitlements not found"},
            )

        usage = {}

        # Per-caller usage: read the single meter row matching the
        # caller's ambient scope projected to the granularity each quota
        # declares (`scope_from(scope=quota.scope)` mirrors the helper
        # `check_entitlements` uses, so numerator and denominator stay
        # at the same scope). Avoids the previous bug where a per-user
        # DAILY counter was summed across users but reported against a
        # per-user `limit`.
        for tracker in [Tracker.COUNTERS, Tracker.GAUGES]:
            tracker_entries = entitlements.get(tracker) or {}
            for key in list(tracker_entries.keys()):
                quota: Quota = tracker_entries[key]

                _scope = scope_from(scope=quota.scope)

                if quota.period is None:
                    _period = MeterPeriod()
                elif quota.period == Period.MONTHLY:
                    _period = period_from(
                        period=Period.MONTHLY,
                        anchor=subscription.anchor,
                    )
                else:
                    _period = period_from(period=quota.period)

                # Some entitlement counters are retention-only and have no
                # corresponding `Meters` row (e.g. `Counter.EVENTS_INGESTED`
                # exists for retention enforcement but is never written as a
                # meter). Treat those as zero-usage rather than crashing.
                try:
                    meter_key = Meters[key.name]
                except KeyError:
                    rows = []
                else:
                    rows = await self.meters_service.fetch(
                        scope=_scope,
                        key=meter_key,
                        period=_period,
                    )
                value = (rows[0].value if rows else 0) or 0

                usage[key] = {
                    "value": value,
                    "limit": quota.limit,
                    "free": quota.free,
                    "period": quota.period.value if quota.period else None,
                    "scope": (
                        quota.scope.value
                        if quota.scope is not None
                        else Scope.ORGANIZATION.value
                    ),
                    "strict": quota.strict is True,
                }

        return usage

    async def fetch_catalog(self) -> list[Dict[str, Any]]:
        """Return the effective billing catalog with pricing merged in.

        Each entry carries `title`, `description`, `plan`, `type`, `features`,
        and (when configured) a `price` block sourced from the matching
        `AGENTA_BILLING_PRICING` entry. Pre-joining avoids a client-side
        catalog × pricing merge by slug.
        """
        merged: list[Dict[str, Any]] = []
        for entry in get_catalog():
            item = dict(entry)
            price = get_pricing_plan(entry.get("plan"))
            if price is not None:
                item["price"] = price
            merged.append(item)
        return merged

    async def fetch_pricing(self) -> Dict[str, Dict[str, Any]]:
        """Return the effective pricing map: plan slug -> normalized pricing.

        Includes backend-resolved free/trial fallback markers so clients do
        not need to duplicate billing default rules.
        """
        return get_effective_pricing()

    @intercept_exceptions()
    async def report_usage(
        self,
    ):
        log.info("[report] [endpoint] Trigger")

        LOCK_TTL = 3600  # 1 hour

        try:
            lock_owner = await acquire_lock(
                namespace="meters:report",
                key={},
                ttl=LOCK_TTL,
                strict=True,
            )

            if not lock_owner:
                log.info("[report] [endpoint] Skipped (ongoing)")
                return JSONResponse(
                    status_code=status.HTTP_200_OK,
                    content={"status": "skipped"},
                )

            log.info("[report] [endpoint] Lock acquired")

            async def _renew_lock():
                return await renew_lock(
                    namespace="meters:report",
                    key={},
                    ttl=LOCK_TTL,
                    owner=lock_owner,
                )

            try:
                log.info("[report] [endpoint] Reporting usage started")
                await self.meters_service.report(renew=_renew_lock)
                log.info("[report] [endpoint] Reporting usage completed")

                return JSONResponse(
                    status_code=status.HTTP_200_OK,
                    content={"status": "success"},
                )

            except Exception:
                log.error(
                    "[report] [endpoint] Report failed:",
                    exc_info=True,
                )
                return JSONResponse(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    content={"status": "error", "message": "Report failed"},
                )

            finally:
                released = await release_lock(
                    namespace="meters:report",
                    key={},
                    owner=lock_owner,
                )
                if released:
                    log.info("[report] [endpoint] Lock released")
                else:
                    log.warn("[report] [endpoint] Lock release skipped (expired/lost)")

        except Exception:
            # Catch-all for any errors, including cache errors
            log.error(
                "[report] [endpoint] Fatal error:",
                exc_info=True,
            )
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"status": "error", "message": "Fatal error"},
            )

    @intercept_exceptions()
    async def unlock_report_usage(
        self,
    ):
        log.warn("[report] [unlock] Trigger")

        try:
            released = await release_lock(
                namespace="meters:report",
                key={},
                strict=True,
            )
        except Exception:
            log.error("[report] [unlock] Failed to release lock", exc_info=True)
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"status": "error", "message": "Lock backend error"},
            )

        if released:
            log.warn("[report] [unlock] Lock force-released")
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={"status": "success", "released": True},
            )

        log.info("[report] [unlock] No lock found")
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"status": "noop", "released": False},
        )

    # ROUTES

    @intercept_exceptions()
    async def create_portal_user_route(
        self,
        request: Request,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_BILLING,
            ):
                return FORBIDDEN_RESPONSE

        return await self.create_portal(
            organization_id=request.state.organization_id,
        )

    @intercept_exceptions()
    async def create_portal_admin_route(
        self,
        organization_id: str = Query(...),
    ):
        return await self.create_portal(
            organization_id=organization_id,
        )

    @intercept_exceptions()
    async def create_checkout_user_route(
        self,
        request: Request,
        plan: str = Query(...),
        success_url: str = Query(...),  # find a way to make this optional or moot
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_BILLING,
            ):
                return FORBIDDEN_RESPONSE

        return await self.create_checkout(
            organization_id=request.state.organization_id,
            plan=plan,
            success_url=success_url,
        )

    @intercept_exceptions()
    async def create_checkout_admin_route(
        self,
        organization_id: str = Query(...),
        plan: str = Query(...),
        success_url: str = Query(...),  # find a way to make this optional or moot
    ):
        return await self.create_checkout(
            organization_id=organization_id,
            plan=plan,
            success_url=success_url,
        )

    @intercept_exceptions()
    async def fetch_plan_user_route(
        self,
        request: Request,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_BILLING,
            ):
                return FORBIDDEN_RESPONSE

        return await self.fetch_plans(
            organization_id=request.state.organization_id,
        )

    @intercept_exceptions()
    async def switch_plans_user_route(
        self,
        request: Request,
        plan: str = Query(...),
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_BILLING,
            ):
                return FORBIDDEN_RESPONSE

        return await self.switch_plans(
            organization_id=request.state.organization_id,
            plan=plan,
        )

    @intercept_exceptions()
    async def switch_plans_admin_route(
        self,
        organization_id: str = Query(...),
        plan: str = Query(...),
    ):
        return await self.switch_plans(
            organization_id=organization_id,
            plan=plan,
        )

    @intercept_exceptions()
    async def fetch_subscription_user_route(
        self,
        request: Request,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_BILLING,
            ):
                return FORBIDDEN_RESPONSE

        return await self.fetch_subscription(
            organization_id=request.state.organization_id,
        )

    @intercept_exceptions()
    async def cancel_subscription_user_route(
        self,
        request: Request,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_BILLING,
            ):
                return FORBIDDEN_RESPONSE

        return await self.cancel_subscription(
            organization_id=request.state.organization_id,
        )

    @intercept_exceptions()
    async def cancel_subscription_admin_route(
        self,
        organization_id: str = Query(...),
    ):
        return await self.cancel_subscription(
            organization_id=organization_id,
        )

    @intercept_exceptions()
    async def fetch_usage_user_route(
        self,
        request: Request,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_BILLING,
            ):
                return FORBIDDEN_RESPONSE

        return await self.fetch_usage()
