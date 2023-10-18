import os
from contextlib import asynccontextmanager

from agenta_backend.config import settings
from agenta_backend.routers import (
    app_router,
    user_profile,
    container_router,
    environment_router,
    evaluation_router,
    observability_router,
    testset_router,
    organization_router,
    variants_router,
)
from agenta_backend.services.cache_manager import (
    retrieve_templates_info_from_s3,
)
from agenta_backend.services.container_manager import pull_docker_image
from agenta_backend.services.db_manager import (
    add_template,
    remove_old_template_from_db,
)

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

    if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
        from agenta_backend.ee.services.cache_manager import (
            retrieve_templates_from_ecr_cached,
        )

        templates = await retrieve_templates_from_ecr_cached(cache)

    else:
        from agenta_backend.services.cache_manager import (
            retrieve_templates_from_dockerhub_cached,
        )

        templates = await retrieve_templates_from_dockerhub_cached(cache)

    templates_ids = []
    templates_info = await retrieve_templates_info_from_s3(cache)
    for temp in templates:
        # Append the template id in the list of templates_ids
        # We do this to remove old templates from database
        templates_ids.append(int(temp["tag_id"]))
        for temp_info_key in templates_info:
            temp_info = templates_info[temp_info_key]
            if str(temp["name"]).startswith(temp_info_key):
                await add_template(
                    **{
                        "tag_id": int(temp["tag_id"]),
                        "name": temp["name"],
                        "repo_name": temp.get("last_updater_username", "repo_name"),
                        "title": temp_info["name"],
                        "description": temp_info["description"],
                        "size": (
                            temp["images"][0]["size"]
                            if not temp.get("size", None)
                            else temp["size"]
                        ),
                        "digest": temp["digest"],
                        "last_pushed": (
                            temp["images"][0]["last_pushed"]
                            if not temp.get("last_pushed", None)
                            else temp["last_pushed"]
                        ),
                    }
                )
                print(f"Template {temp['tag_id']} added to the database.")

                if os.environ["FEATURE_FLAG"] == "oss":
                    # Get docker hub config
                    repo_owner = settings.docker_hub_repo_owner
                    repo_name = settings.docker_hub_repo_name

                    # Pull image from DockerHub
                    image_res = await pull_docker_image(
                        repo_name=f"{repo_owner}/{repo_name}", tag=temp["name"]
                    )
                    print(f"Template Image {image_res[0]['id']} pulled from DockerHub.")

    # Remove old templates from database
    await remove_old_template_from_db(templates_ids)
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

app.include_router(user_profile.router, prefix="/profile")
app.include_router(app_router.router, prefix="/apps")
app.include_router(variants_router.router, prefix="/variants")
app.include_router(evaluation_router.router, prefix="/evaluations")
app.include_router(testset_router.router, prefix="/testsets")
app.include_router(container_router.router, prefix="/containers")
app.include_router(environment_router.router, prefix="/environments")
app.include_router(observability_router.router, prefix="/observability")
app.include_router(organization_router.router, prefix="/organizations")
