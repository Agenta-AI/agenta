import os
from contextlib import asynccontextmanager

from agenta_backend.config import settings
from agenta_backend.routers import (
    app_router,
    container_router,
    environment_router,
    evaluation_router,
    observability_router,
    organization_router,
    testset_router,
    user_profile,
    variants_router,
    bases_router,
    configs_router,
)

if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    from agenta_backend.ee.services import templates_manager
else:
    from agenta_backend.services import templates_manager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://0.0.0.0:3000",
    "http://0.0.0.0:3001",
]


@asynccontextmanager
async def lifespan(application: FastAPI, cache=True):
    """

    Args:
        application: FastAPI application.
        cache: A boolean value that indicates whether to use the cached data or not.
    """
    await templates_manager.update_and_sync_templates(cache=cache)
    yield


app = FastAPI(lifespan=lifespan)

allow_headers = ["Content-Type"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=allow_headers,
)

if os.environ["FEATURE_FLAG"] not in ["cloud", "ee", "demo"]:
    from agenta_backend.services.auth_helper import authentication_middleware

    app.middleware("http")(authentication_middleware)

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    import agenta_backend.ee.main as ee

    app, allow_headers = ee.extend_main(app)

app.include_router(user_profile.router, prefix="/api/profile")
app.include_router(app_router.router, prefix="/api/apps")
app.include_router(variants_router.router, prefix="/api/variants")
app.include_router(evaluation_router.router, prefix="/api/evaluations")
app.include_router(testset_router.router, prefix="/api/testsets")
app.include_router(container_router.router, prefix="/api/containers")
app.include_router(environment_router.router, prefix="/api/environments")
app.include_router(observability_router.router, prefix="/api/observability")
app.include_router(organization_router.router, prefix="/api/organizations")
app.include_router(bases_router.router, prefix="/api/bases")
app.include_router(configs_router.router, prefix="/api/configs")
