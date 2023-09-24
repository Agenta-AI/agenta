import os
import json
from fastapi import FastAPI

from agenta_backend.config import settings
from agenta_backend.routers import app_variant
from agenta_backend.routers import testset_router
from fastapi.middleware.cors import CORSMiddleware
from agenta_backend.routers import container_router
from agenta_backend.routers import evaluation_router
from agenta_backend.routers import observability_router
from agenta_backend.services.db_manager import (
    add_template,
    remove_old_template_from_db,
)
from agenta_backend.services.container_manager import (
    pull_image_from_docker_hub,
)
from agenta_backend.services.cache_manager import (
    retrieve_templates_from_dockerhub_cached,
    retrieve_templates_info_from_dockerhub_cached,
)

from contextlib import asynccontextmanager
from agenta_backend.config import settings


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
    # Get docker hub config
    repo_owner = settings.docker_hub_repo_owner
    repo_name = settings.docker_hub_repo_name

    tags_data = await retrieve_templates_from_dockerhub_cached(cache=cache)
    templates_info_string = await retrieve_templates_info_from_dockerhub_cached(
        cache=cache
    )
    templates_info = json.loads(templates_info_string)

    templates_in_hub = []
    for tag in tags_data:
        # Append the template id in the list of templates_in_hub
        # We do this to remove old templates from database
        templates_in_hub.append(tag["id"])
        for temp_info_key in templates_info:
            temp_info = templates_info[temp_info_key]
            if str(tag["name"]).startswith(temp_info_key):
                await add_template(
                    **{
                        "template_id": tag["id"],
                        "name": tag["name"],
                        "size": tag["images"][0]["size"],
                        "architecture": tag["images"][0]["architecture"],
                        "title": temp_info["name"],
                        "description": temp_info["description"],
                        "digest": tag["digest"],
                        "status": tag["images"][0]["status"],
                        "last_pushed": tag["images"][0]["last_pushed"],
                        "repo_name": tag["last_updater_username"],
                        "media_type": tag["media_type"],
                    }
                )
                image_res = await pull_image_from_docker_hub(
                    f"{repo_owner}/{repo_name}", tag["name"]
                )
                print(f"Template {tag['id']} added to the database.")
                print(f"Template Image {image_res[0]['id']} pulled from DockerHub.")

    # Remove old templates from database
    await remove_old_template_from_db(templates_in_hub)
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(app_variant.router, prefix="/app_variant")
app.include_router(evaluation_router.router, prefix="/evaluations")
app.include_router(testset_router.router, prefix="/testsets")
app.include_router(container_router.router, prefix="/containers")
app.include_router(observability_router.router, prefix="/observability")

allow_headers = ["Content-Type"]

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    import agenta_backend.ee.main as ee

    app, allow_headers = ee.extend_main(app)
# this is the prefix in which we are reverse proxying the api
#
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=allow_headers,
)
