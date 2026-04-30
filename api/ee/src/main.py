from fastapi import FastAPI

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from ee.src.routers import (
    workspace_router,
    organization_router as _organization_router,
)

from ee.src.dbs.postgres.meters.dao import MetersDAO
from ee.src.dbs.postgres.tracing.dao import TracingDAO
from ee.src.dbs.postgres.subscriptions.dao import SubscriptionsDAO

from ee.src.core.meters.service import MetersService
from ee.src.core.tracing.service import TracingService
from ee.src.core.subscriptions.service import SubscriptionsService

from ee.src.apis.fastapi.billing.router import BillingRouter
from ee.src.apis.fastapi.organizations.router import (
    router as organization_router,
)
from oss.src.apis.fastapi.auth.router import auth_router

# DBS --------------------------------------------------------------------------

meters_dao = MetersDAO()

tracing_dao = TracingDAO()

subscriptions_dao = SubscriptionsDAO()

# CORE -------------------------------------------------------------------------

meters_service = MetersService(
    meters_dao=meters_dao,
)

tracing_service = TracingService(
    tracing_dao=tracing_dao,
)

subscription_service = SubscriptionsService(
    subscriptions_dao=subscriptions_dao,
    meters_service=meters_service,
)

# APIS -------------------------------------------------------------------------

billing_router = BillingRouter(
    subscription_service=subscription_service,
    meters_service=meters_service,
    tracing_service=tracing_service,
)


log = get_module_logger(__name__)


def extend_main(app: FastAPI):
    # ROUTES -------------------------------------------------------------------

    app.include_router(
        router=billing_router.router,
        prefix="/billing",
        tags=["Billing"],
    )

    app.include_router(
        router=billing_router.admin_router,
        prefix="/admin/billing",
        tags=["Admin", "Billing"],
    )

    # ROUTES (more) ------------------------------------------------------------

    app.include_router(
        organization_router,
        prefix="/organizations",
        tags=["Organizations"],
    )

    app.include_router(
        _organization_router.router,
        prefix="/organizations",
        tags=["Organizations"],
    )

    app.include_router(
        workspace_router.router,
        prefix="/workspaces",
        tags=["Workspaces"],
    )

    # Auth router at root level (no /api prefix) for OAuth callbacks
    app.include_router(
        auth_router,
        prefix="/auth",
        tags=["Auth"],
        include_in_schema=False,
    )

    # --------------------------------------------------------------------------

    return app


def extend_app_schema(app: FastAPI):
    from fastapi.openapi.utils import get_openapi

    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema

        billing_tag = {
            "name": "Billing",
            "description": "Subscription management, plans, usage, and Stripe billing (EE only).",
        }

        oss_tags = list(app.openapi_tags or [])
        admin_index = next(
            (i for i, t in enumerate(oss_tags) if t.get("name") == "Admin"),
            len(oss_tags),
        )
        oss_tags.insert(admin_index, billing_tag)

        schema = get_openapi(
            title="Agenta API",
            version=app.version,
            description="Agenta API",
            contact={
                "name": "Agenta",
                "url": "https://agenta.ai",
                "email": "team@agenta.ai",
            },
            routes=app.routes,
            tags=oss_tags,
        )
        schema.setdefault("components", {})
        schema["components"]["securitySchemes"] = {
            "APIKeyHeader": {
                "type": "apiKey",
                "name": "Authorization",
                "in": "header",
            }
        }
        schema["security"] = [{"APIKeyHeader": []}]
        schema["servers"] = [{"url": env.agenta.api_url}]

        app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = custom_openapi  # type: ignore
    return app
