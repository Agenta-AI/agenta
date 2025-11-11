from fastapi import FastAPI

from oss.src.utils.logging import get_module_logger

from ee.src.routers import (  # type: ignore
    admin_router,
    workspace_router,
    organization_router,
    evaluation_router,
    human_evaluation_router,
)

from ee.src.dbs.postgres.subscriptions.dao import SubscriptionsDAO
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.apis.fastapi.billing.router import SubscriptionsRouter
from ee.src.dbs.postgres.meters.dao import MetersDAO
from ee.src.core.meters.service import MetersService

log = get_module_logger(__file__)


def extend_main(app: FastAPI):
    app.include_router(admin_router.router, prefix="/admin", tags=["Admin"])
    app.include_router(organization_router.router, prefix="/organizations")
    app.include_router(workspace_router.router, prefix="/workspaces")
    app.include_router(
        evaluation_router.router, prefix="/evaluations", tags=["Evaluations"]
    )
    app.include_router(
        human_evaluation_router.router,
        prefix="/human-evaluations",
        tags=["Human-Evaluations"],
    )

    subscriptions_router = SubscriptionsRouter(
        subscription_service=SubscriptionsService(
            subscriptions_dao=SubscriptionsDAO(),
            meters_service=MetersService(
                meters_dao=MetersDAO(),
            ),
        ),
    )

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

    return app


def extend_app_schema(app: FastAPI):
    app.openapi()["info"]["title"] = "Agenta Backend"
    app.openapi()["info"]["description"] = "Agenta Backend API"
    app.openapi()["info"]["contact"] = {
        "name": "Agenta",
        "url": "https://agenta.ai",
        "email": "team@agenta.ai",
    }

    APIKeyHeader = {"APIKeyHeader": []}  # type: ignore

    app.openapi()["components"]["securitySchemes"] = {
        "APIKeyHeader": {
            "type": "apiKey",
            "name": "Authorization",
            "in": "header",
        }
    }

    app.openapi()["security"] = [APIKeyHeader]
    app.openapi()["servers"] = [{"url": "https://cloud.agenta.ai/api"}]

    return app
