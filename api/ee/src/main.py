from fastapi import FastAPI

from oss.src.utils.logging import get_module_logger

from ee.src.routers import (
    workspace_router,
    organization_router,
    evaluation_router,
    human_evaluation_router,
)

from ee.src.dbs.postgres.meters.dao import MetersDAO
from ee.src.dbs.postgres.subscriptions.dao import SubscriptionsDAO

from ee.src.core.meters.service import MetersService
from ee.src.core.subscriptions.service import SubscriptionsService

from ee.src.apis.fastapi.billing.router import SubscriptionsRouter

# DBS --------------------------------------------------------------------------

meters_dao = MetersDAO()

subscriptions_dao = SubscriptionsDAO()

# CORE -------------------------------------------------------------------------

meters_service = MetersService(
    meters_dao=meters_dao,
)

subscription_service = SubscriptionsService(
    subscriptions_dao=subscriptions_dao,
    meters_service=meters_service,
)

# APIS -------------------------------------------------------------------------

subscriptions_router = SubscriptionsRouter(
    subscription_service=subscription_service,
)


log = get_module_logger(__name__)


def extend_main(app: FastAPI):
    # ROUTES -------------------------------------------------------------------

    app.include_router(
        router=subscriptions_router.router,
        prefix="/billing",
        tags=["Billing"],
    )

    app.include_router(
        router=subscriptions_router.admin_router,
        prefix="/admin/billing",
        tags=["Admin", "Billing"],
    )

    # ROUTES (more) ------------------------------------------------------------

    app.include_router(
        organization_router.router,
        prefix="/organizations",
    )

    app.include_router(
        workspace_router.router,
        prefix="/workspaces",
    )

    app.include_router(
        evaluation_router.router,
        prefix="/evaluations",
        tags=["Evaluations"],
    )

    app.include_router(
        human_evaluation_router.router,
        prefix="/human-evaluations",
        tags=["Human-Evaluations"],
    )

    # --------------------------------------------------------------------------

    return app


def load_tasks():
    import ee.src.tasks.evaluations.live
    import ee.src.tasks.evaluations.legacy
    import ee.src.tasks.evaluations.batch


def extend_app_schema(app: FastAPI):
    app.openapi()["info"]["title"] = "Agenta API"
    app.openapi()["info"]["description"] = "Agenta API"
    app.openapi()["info"]["contact"] = {
        "name": "Agenta",
        "url": "https://agenta.ai",
        "email": "team@agenta.ai",
    }
    app.openapi()["components"]["securitySchemes"] = {
        "APIKeyHeader": {
            "type": "apiKey",
            "name": "Authorization",
            "in": "header",
        }
    }
    app.openapi()["security"] = [
        {
            "APIKeyHeader": [],
        },
    ]
    app.openapi()["servers"] = [
        {
            "url": "https://cloud.agenta.ai/api",
        },
    ]

    return app
