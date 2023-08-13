from fastapi import FastAPI

from agenta_backend.routers import app_variant
from agenta_backend.routers import testset_router
from fastapi.middleware.cors import CORSMiddleware
from agenta_backend.routers import container_router
from agenta_backend.routers import evaluation_router
from agenta_backend.services.db_manager import add_template
from agenta_backend.services.container_manager import (
    retrieve_templates_from_dockerhub_cached,
)


from contextlib import asynccontextmanager


origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://0.0.0.0:3000",
    "http://0.0.0.0:3001",
]


@asynccontextmanager
async def lifespan(application: FastAPI):
    tags_data = await retrieve_templates_from_dockerhub_cached()
    for tag in tags_data:
        add_template(
            **{
                "template_id": tag["id"],
                "name": tag["name"],
                "size": tag["images"][0]["size"],
                "digest": tag["digest"],
                "status": tag["images"][0]["status"],
                "last_pushed": tag["images"][0]["last_pushed"],
                "repo_name": tag["last_updater_username"],
                "media_type": tag["media_type"],
            }
        )
        print(f"Template {tag['id']} added to the database.")

    yield


# this is the prefix in which we are reverse proxying the api
app = FastAPI(lifespan=lifespan)
app.include_router(app_variant.router, prefix="/app_variant")
app.include_router(evaluation_router.router, prefix="/evaluations")
app.include_router(testset_router.router, prefix="/testsets")
app.include_router(container_router.router, prefix="/containers")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
