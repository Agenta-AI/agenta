"""Main Business logic
"""
import logging
import os
from typing import List, Optional

from agenta_backend.config import settings
from agenta_backend.models.api.api_models import (
    URI,
    App,
    AppVariant,
    DockerEnvVars,
    Environment,
    Image,
    ImageExtended,
)
from agenta_backend.models.db_models import AppVariantDB, TestSetDB, EnvironmentDB
from agenta_backend.services import new_db_manager, docker_utils
from docker.errors import DockerException

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


async def start_variant(
    db_app_variant: AppVariantDB, env_vars: DockerEnvVars = None, **kwargs: dict
) -> URI:
    """
    Starts a Docker container for a given app variant.

    Fetches the associated image from the database and delegates to a Docker utility function
    to start the container. The URI of the started container is returned.

    Args:
        app_variant (AppVariant): The app variant for which a container is to be started.
        env_vars (DockerEnvVars): (optional) The environment variables to be passed to the container.

    Returns:
        URI: The URI of the started Docker container.

    Raises:
        ValueError: If the app variant does not have a corresponding image in the database.
        RuntimeError: If there is an error starting the Docker container.
    """
    try:

        logger.debug("Starting variant %s with image name %s and tags %s and app_name %s and organization %s", db_app_variant.variant_name,
                     db_app_variant.image_id.docker_id, db_app_variant.image_id.tags, db_app_variant.app_id.app_name, db_app_variant.organization_id)
        logger.debug("App name is %s", db_app_variant.app_id.app_name)
        uri: URI = docker_utils.start_container(
            image_name=db_app_variant.image_id.tags,
            app_name=db_app_variant.app_id.app_name,
            variant_name=db_app_variant.variant_name,
            env_vars=env_vars,
            organization_id=db_app_variant.organization_id.id,
        )
        logger.info(
            f"Started Docker container for app variant {db_app_variant.app_id.app_name}/{db_app_variant.variant_name} at URI {uri}"
        )
        # TODO: Save information to base
        # new_db_manager.register_base_container(db_app_variant, uri, f"{app_name}-{variant_name}-{organization_id}")
    except Exception as e:
        logger.error(
            f"Error starting Docker container for app variant {db_app_variant.app_id.app_name}/{db_app_variant.variant_name}: {str(e)}"
        )
        raise Exception(
            f"Failed to start Docker container for app variant {db_app_variant.app_id.app_name}/{db_app_variant.variant_name} \n {str(e)}"
        )

    return uri


async def remove_app_variant(app_variant_id: str, **kwargs: dict) -> None:
    """
    Removes app variant from the database. If it's the last one using an image, performs additional operations:
    - Deletes the image from the db.
    - Shuts down and deletes the container.
    - Removes the image from the registry.

    Args:
        variant_id (srt): The app variant to remove.

    Raises:
        ValueError: If the app variant is not found in the database.
        Exception: Any other exception raised during the operation.
    """
    app_variant_db = await new_db_manager.fetch_app_variant_by_id(app_variant_id)
    app_id = app_variant_db.app_id.id
    if app_variant_db is None:
        error_msg = f"Failed to delete app variant {app_variant_id}: Not found in DB."
        logger.error(error_msg)
        raise ValueError(error_msg)

    try:
        is_last_variant_for_image = await new_db_manager.check_is_last_variant_for_image(
            app_variant_db
        )

        if is_last_variant_for_image:
            image = app_variant_db.base_id.image_id

            if image:
                # TODO: This needs to change to use a db schema to save the container name
                await _stop_and_delete_app_container(app_variant_db, **kwargs)

                await new_db_manager.remove_app_variant(app_variant_db, **kwargs)  # TODO: Mahmoud not done

                await new_db_manager.remove_image(image, **kwargs)

                # Only delete the docker image for users that are running the oss version
                if os.environ["FEATURE_FLAG"] not in ["cloud", "ee", "demo"]:
                    _delete_docker_image(image)  # TODO: To implement in ee version
            else:
                logger.debug(
                    f"Image associated with app variant {app_variant_db.app_id.name}/{app_variant_db.variant_name} not found. Skipping deletion."
                )  # TODO: unfinished
        else:
            await new_db_manager.remove_app_variant(app_variant_db, **kwargs)

        app_variants = await new_db_manager.list_app_variants(
            app_id=app_id, **kwargs
        )  # TODO: unfinished
        if len(app_variants) == 0:  # this was the last variant for an app
            await remove_app_related_resources(app_id=app_id, **kwargs)  # TODO: unfinished
    except Exception as e:
        logger.error(
            f"An error occurred while deleting app variant {app_variant_db.app_id.name}/{app_variant_db.variant_name}: {str(e)}"
        )
        raise e from None


async def _stop_and_delete_app_container(
    app_variant: AppVariantDB, **kwargs: dict
) -> None:
    """
    Stops and deletes Docker container associated with a given app.

    Args:
        app_variant (AppVariant): The app variant whose associated container is to be stopped and deleted.

    Raises:
        Exception: Any exception raised during Docker operations.
    """
    try:
        container_id = f"{app_variant.app_id.app_name}-{app_variant.variant_name}-{str(app_variant.organization_id.id)}"
        docker_utils.stop_container(container_id)
        logger.info(f"Container {container_id} stopped")
        docker_utils.delete_container(container_id)
        logger.info(f"Container {container_id} deleted")
    except Exception as e:
        logger.error(f"Error stopping and deleting Docker container: {str(e)}")


async def remove_app_related_resources(app_id: str, **kwargs: dict):
    """Removes environments and testsets associated with an app after its deletion.

    When an app or its last variant is deleted, this function ensures that
    all related resources such as environments and testsets are also deleted.

    Args:
        app_name: The name of the app whose associated resources are to be removed.
    """
    try:
        # Delete associated environments
        environments: List[EnvironmentDB] = await new_db_manager.list_environments(
            app_id, **kwargs
        )
        for environment_db in environments:
            await new_db_manager.remove_environment(environment_db, **kwargs)
            logger.info(
                f"Successfully deleted environment {environment_db.name}."
            )
        # Delete associated testsets
        await remove_app_testsets(app_name, **kwargs)  # TODO: unfinished
        logger.info(f"Successfully deleted test sets associated with app {app_name}.")  # TODO: unfinished
    except Exception as e:
        logger.error(
            f"An error occurred while cleaning up resources for app {app_name}: {str(e)}"  # TODO: unfinished
        )
        raise e from None
