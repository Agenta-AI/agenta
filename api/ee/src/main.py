from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.events.dao import EventsDAO
from oss.src.core.events.service import EventsService

from ee.src.routers import (
    workspace_router,
    organization_router as _organization_router,
)

from ee.src.dbs.postgres.meters.dao import MetersDAO
from ee.src.dbs.postgres.tracing.dao import TracingRetentionDAO
from ee.src.dbs.postgres.subscriptions.dao import SubscriptionsDAO
from ee.src.dbs.postgres.events.dao import EventsRetentionDAO

from ee.src.core.meters.service import MetersService
from ee.src.core.tracing.service import TracingRetentionService
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.core.events.service import EventsRetentionService

from ee.src.apis.fastapi.access.router import AccessRouter
from ee.src.apis.fastapi.billing.router import BillingRouter
from ee.src.apis.fastapi.spans.router import SpansRetentionRouter
from ee.src.apis.fastapi.events.router import EventsRouter, EventsRetentionRouter
from ee.src.apis.fastapi.organizations.router import (
    router as organization_router,
)
from ee.src.utils.entitlements import bootstrap_entitlements_services

# DBS --------------------------------------------------------------------------

meters_dao = MetersDAO()

tracing_retention_dao = TracingRetentionDAO()

subscriptions_dao = SubscriptionsDAO()

events_retention_dao = EventsRetentionDAO()
query_events_dao = EventsDAO()

# CORE -------------------------------------------------------------------------

meters_service = MetersService(
    meters_dao=meters_dao,
)

tracing_retention_service = TracingRetentionService(
    tracing_retention_dao=tracing_retention_dao,
)

events_retention_service = EventsRetentionService(
    events_retention_dao=events_retention_dao,
)
query_events_service = EventsService(
    events_dao=query_events_dao,
)

subscription_service = SubscriptionsService(
    subscriptions_dao=subscriptions_dao,
    meters_service=meters_service,
)

# Wire entitlements module against the freshly-built services so the
# `BillingRouter` and the entitlements helper share one instance each.
bootstrap_entitlements_services(
    meters_service=meters_service,
    subscriptions_service=subscription_service,
)

# APIS -------------------------------------------------------------------------

access_router = AccessRouter()

billing_router = BillingRouter(
    subscription_service=subscription_service,
    meters_service=meters_service,
)

spans_retention_router = SpansRetentionRouter(
    tracing_retention_service=tracing_retention_service,
)

events_router = EventsRouter(
    events_service=query_events_service,
)

events_retention_router = EventsRetentionRouter(
    events_retention_service=events_retention_service,
)


log = get_module_logger(__name__)


def extend_main(app: FastAPI):
    # ROUTES -------------------------------------------------------------------

    app.include_router(
        router=access_router.router,
        prefix="/access",
        tags=["Access"],
    )

    app.include_router(
        router=billing_router.router,
        prefix="/billing",
        tags=["Billing"],
    )

    app.include_router(
        router=billing_router.admin_router,
        prefix="/admin/billing",
        tags=["Admin"],
        include_in_schema=False,
    )

    app.include_router(
        router=spans_retention_router.admin_router,
        prefix="/admin/spans",
        tags=["Admin"],
        include_in_schema=False,
    )

    app.include_router(
        router=events_retention_router.admin_router,
        prefix="/admin/events",
        tags=["Admin"],
        include_in_schema=False,
    )

    app.include_router(
        router=events_router.router,
        prefix="/events",
        tags=["Events"],
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

    # --------------------------------------------------------------------------

    return app


def extend_app_schema(app: FastAPI):
    def custom_openapi():
        """
        EE-aware OpenAPI schema generator, replaces FastAPI's default.

        Extends the OSS schema with:
        - APIKeyHeader security scheme and global security requirement
        - Server URL pinned from config

        Result is cached on app.openapi_schema and built only once per lifetime.
        """
        if app.openapi_schema:
            return app.openapi_schema

        oss_tags = list(app.openapi_tags or [])
        # Insert Access then Billing right before the Admin tag so the final
        # order is: ...domain tags..., Access, Billing, Admin, Deprecated.
        admin_idx = next(
            (i for i, t in enumerate(oss_tags) if t.get("name") == "Admin"),
            len(oss_tags),
        )
        oss_tags.insert(
            admin_idx,
            {
                "name": "Access",
                "description": "Authentication discovery, organization access checks, and SSO callback endpoints.",
            },
        )
        oss_tags.insert(
            admin_idx + 1,
            {
                "name": "Billing",
                "description": "Subscription, plan, and usage endpoints for workspace billing.",
            },
        )

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
