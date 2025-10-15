from typing import Any, Dict
from os import environ
from json import loads, decoder
from uuid import getnode
from datetime import datetime, timezone
from dateutil.relativedelta import relativedelta

from fastapi import APIRouter, Request, status, HTTPException, Query
from fastapi.responses import JSONResponse

import stripe

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from oss.src.services.db_manager import (
    get_user_with_id,
    get_organization_by_id,
)

from ee.src.utils.permissions import check_action_access
from ee.src.models.shared_models import Permission
from ee.src.core.entitlements.types import ENTITLEMENTS, CATALOG, Tracker, Quota
from ee.src.core.subscriptions.types import Event, Plan
from ee.src.core.subscriptions.service import (
    SubscriptionsService,
    SwitchException,
    EventException,
)


log = get_module_logger(__name__)

stripe.api_key = environ.get("STRIPE_API_KEY")

MAC_ADDRESS = ":".join(f"{(getnode() >> ele) & 0xff:02x}" for ele in range(40, -1, -8))
STRIPE_WEBHOOK_SECRET = environ.get("STRIPE_WEBHOOK_SECRET")
STRIPE_TARGET = environ.get("STRIPE_TARGET") or MAC_ADDRESS
AGENTA_PRICING = loads(environ.get("AGENTA_PRICING") or "{}")

FORBIDDEN_RESPONSE = JSONResponse(
    status_code=403,
    content={
        "detail": "You do not have access to perform this action. Please contact your organization admin.",
    },
)


class SubscriptionsRouter:
    def __init__(
        self,
        subscription_service: SubscriptionsService,
    ):
        self.subscription_service = subscription_service

        # ROUTER
        self.router = APIRouter()

        # USES 'STRIPE_WEBHOOK_SECRET', SHOULD BE IN A DIFFERENT ROUTER
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

        # ADMIN ROUTER
        self.admin_router = APIRouter()

        self.admin_router.add_api_route(
            "/stripe/portals/",
            self.create_portal_admin_route,
            methods=["POST"],
            operation_id="admin_create_portal",
        )

        self.admin_router.add_api_route(
            "/stripe/checkouts/",
            self.create_checkout_admin_route,
            methods=["POST"],
            operation_id="admin_create_checkout",
        )

        self.admin_router.add_api_route(
            "/plans/switch",
            self.switch_plans_admin_route,
            methods=["POST"],
            operation_id="admin_switch_plans",
        )

        self.admin_router.add_api_route(
            "/subscription/cancel",
            self.cancel_subscription_admin_route,
            methods=["POST"],
            operation_id="admin_cancel_subscription",
        )

        # DOESN'T REQUIRE 'organization_id'
        self.admin_router.add_api_route(
            "/usage/report",
            self.report_usage,
            methods=["POST"],
            operation_id="admin_report_usage",
        )

    # HANDLERS

    @intercept_exceptions()
    async def handle_events(
        self,
        request: Request,
    ):
        if not stripe.api_key:
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"status": "error", "message": "Missing Stripe API Key"},
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
            raise HTTPException(status_code=400, detail="Invalid payload") from e

        try:
            sig_header = request.headers.get("stripe-signature")

            if STRIPE_WEBHOOK_SECRET:
                stripe_event = stripe.Webhook.construct_event(
                    payload,
                    sig_header,
                    STRIPE_WEBHOOK_SECRET,
                )
        except stripe.error.SignatureVerificationError as e:
            log.error("Webhook signature verification failed: %s", e)
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"status": "error", "message": "Signature verification failed"},
            )

        metadata = None

        if not stripe_event.type.startswith("invoice"):
            if not hasattr(stripe_event.data.object, "metadata"):
                log.warn("Skipping stripe event: %s (no metadata)", stripe_event.type)
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={"status": "error", "message": "Metadata not found"},
                )
            else:
                metadata = stripe_event.data.object.metadata

        if stripe_event.type.startswith("invoice"):
            if not hasattr(
                stripe_event.data.object, "subscription_details"
            ) and not hasattr(
                stripe_event.data.object.subscription_details, "metadata"
            ):
                log.warn("Skipping stripe event: %s (no metadata)", stripe_event.type)

                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={"status": "error", "message": "Metadata not found"},
                )
            else:
                metadata = stripe_event.data.object.subscription_details.metadata

        if "target" not in metadata:
            log.warn("Skipping stripe event: %s (no target)", stripe_event.type)
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"status": "error", "message": "Target not found"},
            )

        target = metadata.get("target")

        if target != STRIPE_TARGET:
            log.warn(
                "Skipping stripe event: %s (wrong target: %s)",
                stripe_event.type,
                target,
            )
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"status": "error", "message": "Target mismatch"},
            )

        if "organization_id" not in metadata:
            log.warn("Skipping stripe event: %s (no organization)", stripe_event.type)
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"status": "error", "message": "Organization ID not found"},
            )

        organization_id = metadata.get("organization_id")

        log.info(
            "Stripe event:  %s | %s | %s",
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

                if "id" not in stripe_event.data.object:
                    log.warn(
                        "Skipping stripe event: %s (no subscription)",
                        stripe_event.type,
                    )
                    return JSONResponse(
                        status_code=status.HTTP_403_FORBIDDEN,
                        content={
                            "status": "error",
                            "message": "Subscription ID not found",
                        },
                    )

                subscription_id = stripe_event.data.object.id

                if "plan" not in metadata:
                    log.warn("Skipping stripe event: %s (no plan)", stripe_event.type)
                    return JSONResponse(
                        status_code=status.HTTP_403_FORBIDDEN,
                        content={
                            "status": "error",
                            "message": "Plan not found",
                        },
                    )

                plan = Plan(metadata.get("plan"))

                if "billing_cycle_anchor" not in stripe_event.data.object:
                    log.warn("Skipping stripe event: %s (no anchor)", stripe_event.type)
                    return JSONResponse(
                        status_code=status.HTTP_403_FORBIDDEN,
                        content={
                            "status": "error",
                            "message": "Anchor not found",
                        },
                    )

                anchor = datetime.fromtimestamp(
                    stripe_event.data.object.billing_cycle_anchor
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
        if not stripe.api_key:
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"status": "error", "message": "Missing Stripe API Key"},
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
        plan: Plan,
        success_url: str,
    ):
        if not stripe.api_key:
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"status": "error", "message": "Missing Stripe API Key"},
            )

        if plan.name not in Plan.__members__.keys():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid plan",
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
                user_id=organization.owner,
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
                    "target": STRIPE_TARGET,
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
            line_items=list(AGENTA_PRICING[plan].values()),
            #
            subscription_data={
                # "billing_cycle_anchor": anchor,
                "metadata": {
                    "organization_id": organization_id,
                    "plan": plan.value,
                    "target": STRIPE_TARGET,
                },
            },
            #
            ui_mode="hosted",
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
            key = subscription.plan.value

        for plan in CATALOG:
            if plan["type"] == "standard":
                plans.append(plan)
            elif plan["type"] == "custom" and plan["plan"] == key:
                plans.append(plan)

        return plans

    async def switch_plans(
        self,
        organization_id: str,
        plan: Plan,
        # force: bool,
    ):
        if plan.name not in Plan.__members__.keys():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid plan",
            )

        try:
            subscription = await self.subscription_service.process_event(
                organization_id=organization_id,
                event=Event.SUBSCRIPTION_SWITCHED,
                plan=plan.value,
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
            plan=plan.value,
            type="standard",
        )

        if plan == Plan.CLOUD_V0_HOBBY:
            return _status

        if not subscription.subscription_id:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "status": "error",
                    "message": "Subscription (Agenta) not found",
                },
            )

        if not stripe.api_key:
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={
                    "status": "error",
                    "message": "Missing Stripe API Key",
                },
            )

        try:
            _subscription = stripe.Subscription.retrieve(
                id=subscription.subscription_id,
            )
        except Exception:
            _subscription = None

        if _subscription:
            _status["period_start"] = int(_subscription.current_period_start)
            _status["period_end"] = int(_subscription.current_period_end)
            _status["free_trial"] = _subscription.status == "trialing"

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
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Subscription (Stripe) not found",
            )

        try:
            stripe.Subscription.cancel(subscription.subscription_id)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not cancel subscription. Please try again or contact support.",
            ) from e

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"status": "success"},
        )

    async def fetch_usage(
        self,
        organization_id: str,
    ):
        now = datetime.now(timezone.utc)

        subscription = await self.subscription_service.read(
            organization_id=organization_id,
        )

        if not subscription:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"status": "error", "message": "Subscription not found"},
            )

        plan = subscription.plan
        anchor_day = subscription.anchor
        anchor_month = (now.month + (1 if now.day >= anchor_day else 0)) % 12

        entitlements = ENTITLEMENTS.get(plan)

        if not entitlements:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"status": "error", "message": "Plan not found"},
            )

        meters = await self.subscription_service.meters_service.fetch(
            organization_id=organization_id,
        )

        usage = {}

        for tracker in [Tracker.COUNTERS, Tracker.GAUGES]:
            for key in list(entitlements[tracker].keys()):
                quota: Quota = entitlements[tracker][key]
                value = 0

                for meter in meters:
                    if meter.key == key:
                        if meter.month != 0 and meter.month != anchor_month:
                            continue

                        value = meter.value

                usage[key] = {
                    "value": value,
                    "limit": quota.limit,
                    "free": quota.free,
                    "monthly": quota.monthly is True,
                    "strict": quota.strict is True,
                }

        return usage

    @intercept_exceptions()
    async def report_usage(
        self,
    ):
        try:
            await self.subscription_service.meters_service.report()
        except Exception as e:
            raise HTTPException(status_code=500, detail="unexpected error") from e

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"status": "success"},
        )

    # ROUTES

    @intercept_exceptions()
    async def create_portal_user_route(
        self,
        request: Request,
    ):
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
        plan: Plan = Query(...),
        success_url: str = Query(...),  # find a way to make this optional or moot
    ):
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
        plan: Plan = Query(...),
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
        plan: Plan = Query(...),
    ):
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
        plan: Plan = Query(...),
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
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_BILLING,
        ):
            return FORBIDDEN_RESPONSE

        return await self.fetch_usage(
            organization_id=request.state.organization_id,
        )
