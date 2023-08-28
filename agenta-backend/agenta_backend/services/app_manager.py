"""Main Business logic
"""

import logging
from typing import Optional
from agenta_backend.config import settings
from agenta_backend.models.api.api_models import (
    URI,
    App,
    AppVariant,
    Image,
    DockerEnvVars,
)
from agenta_backend.models.db_models import AppVariantDB, TestSetDB
from agenta_backend.services import db_manager, docker_utils
from docker.errors import DockerException


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _fetch_app_variant_from_db(
    app_variant: AppVariant,
) -> Optional[AppVariantDB]:
    """
    Fetches an app variant from the database.

    Args:
        app_variant (AppVariant): The app variant to be fetched.

    Returns:
        Optional[AppVariant]: The fetched app variant or None if not found.

    Raises:
        Exception: Any exception raised by the db_manager while fetching.
    """
    try:
        app_var = await db_manager.get_variant_from_db(app_variant)
        return app_var
    except Exception as e:
        logger.error(f"Error fetching app variant from the database: {str(e)}")
        raise


async def _fetch_image_from_db(app_variant: AppVariant) -> Optional[Image]:
    """
    Fetches an image associated with an app variant from the database.

    Args:
        app_variant (AppVariant): The app variant whose associated image is to be fetched.

    Returns:
        Optional[Image]: The fetched image or None if not found.

    Raises:
        Exception: Any exception raised by the db_manager while fetching.
    """
    try:
        return await db_manager.get_image(app_variant)
    except Exception as e:
        logger.error(f"Error fetching image from the database: {str(e)}")
        return None


def _stop_and_delete_containers(image: Image) -> None:
    """
    Stops and deletes Docker containers associated with a given image.

    Args:
        image (Image): The Docker image whose associated containers are to be stopped and deleted.

    Raises:
        Exception: Any exception raised during Docker operations.
    """
    try:
        container_ids = docker_utils.stop_containers_based_on_image(image)
        logger.info(f"Containers {container_ids} stopped")
        for container_id in container_ids:
            docker_utils.delete_container(container_id)
            logger.info(f"Container {container_id} deleted")
    except Exception as e:
        logger.error(f"Error stopping and deleting Docker containers: {str(e)}")


def _delete_docker_image(image: Image) -> None:
    """
    Deletes a Docker image.

    Args:
        image (Image): The Docker image to be deleted.

    Raises:
        Exception: Any exception raised during Docker operations.
    """
    try:
        docker_utils.delete_image(image)
        logger.info(f"Image {image.tags} deleted")
    except Exception as e:
        logger.warning(
            f"Warning: Error deleting image {image.tags}. Probably multiple variants using it."
        )


async def remove_app_variant(app_variant: AppVariant) -> None:
    """
    Removes app variant from the database. If it's the last one using an image, performs additional operations:
    - Deletes the image from the db.
    - Shuts down and deletes the container.
    - Removes the image from the registry.

    Args:
        app_variant (AppVariant): The app variant to remove.

    Raises:
        ValueError: If the app variant is not found in the database.
        Exception: Any other exception raised during the operation.
    """

    app_variant_db = await _fetch_app_variant_from_db(app_variant)

    if app_variant_db is None:
        msg = f"App variant {app_variant.app_name}/{app_variant.variant_name} not found in DB"
        logger.error(msg)
        raise ValueError(msg)

    try:
        is_last_variant = await db_manager.check_is_last_variant(app_variant_db)
        if is_last_variant:
            image = await _fetch_image_from_db(app_variant)
            print("we reached here")
            if image:
                _stop_and_delete_containers(image)
                _delete_docker_image(image)
                await db_manager.remove_app_variant(app_variant)
                await db_manager.remove_image(image)
        else:
            await db_manager.remove_app_variant(app_variant)

    except Exception as e:
        logger.error(f"Error deleting app variant: {str(e)}")
        raise


async def remove_app(app: App, **kwargs: dict):
    """Removes all app variants from db, if it is the last one using an image, then
    deletes the image from the db, shutdowns the container, deletes it and remove
    the image from the registry

    Arguments:
        app_name -- the app name to remove
    """
    # checks if it is the last app variant using its image
    app_name = app.app_name
    apps = await db_manager.list_apps(**kwargs)
    if app_name not in [app.app_name for app in apps]:
        msg = f"App {app_name} not found in DB"
        logger.error(msg)
        raise ValueError(msg)
    try:
        app_variants = await db_manager.list_app_variants(
            app_name=app_name, show_soft_deleted=True
        )
    except Exception as e:
        logger.error(f"Error fetching app variants from the database: {str(e)}")
        raise

    if app_variants is None:
        msg = f"App {app_name} not found in DB"
        logger.error(msg)
        raise ValueError(msg)
    else:
        try:
            for app_variant in app_variants:
                await remove_app_variant(app_variant)
                logger.info(
                    f"App variant {app_variant.app_name}/{app_variant.variant_name} deleted"
                )

            await remove_app_testsets(app_name)
            logger.info(f"Tatasets for {app_name} app deleted")
        except Exception as e:
            logger.error(f"Error deleting app variants: {str(e)}")
            raise


async def remove_app_testsets(app_name: str):
    """Returns a list of testsets owned by an app.

    Args:
        app_name (str): The name of the app

    Returns:
        int: The number of testsets deleted
    """

    # Find testsets owned by the app
    deleted_count: int = 0
    testsets = await db_manager.engine.find_one(
        TestSetDB, TestSetDB.app_name == app_name
    )

    # Perform deletion if there are testsets to delete
    if testsets is not None:
        for testset in testsets:
            await db_manager.engine.delete(testset)
            deleted_count += 1
            logger.info(f"{deleted_count} testset(s) deleted for app {app_name}")
            return deleted_count

    logger.info(f"No testsets found for app {app_name}")
    return 0


async def start_variant(app_variant: AppVariant, env_vars: DockerEnvVars = None) -> URI:
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
        image: Image = await db_manager.get_image(app_variant)
    except Exception as e:
        logger.error(
            f"Error fetching image for app variant {app_variant.app_name}/{app_variant.variant_name} from database: {str(e)}"
        )
        raise Exception(
            f"Image for app variant {app_variant.app_name}/{app_variant.variant_name} not found in database \n {str(e)}"
        )

    try:
        uri: URI = docker_utils.start_container(
            image_name=image.tags,
            app_name=app_variant.app_name,
            variant_name=app_variant.variant_name,
            env_vars=env_vars,
        )
        logger.info(
            f"Started Docker container for app variant {app_variant.app_name}/{app_variant.variant_name} at URI {uri}"
        )
    except Exception as e:
        logger.error(
            f"Error starting Docker container for app variant {app_variant.app_name}/{app_variant.variant_name}: {str(e)}"
        )
        raise Exception(
            f"Failed to start Docker container for app variant {app_variant.app_name}/{app_variant.variant_name} \n {str(e)}"
        )

    return uri


async def update_variant_parameters(app_variant: AppVariant):
    """Updates the parameters for app variant in the database.

    Arguments:
        app_variant -- the app variant to update
    """
    if app_variant.app_name in ["", None] or app_variant.variant_name == [
        "",
        None,
    ]:
        msg = f"App name and variant name cannot be empty"
        logger.error(msg)
        raise ValueError(msg)
    if app_variant.parameters is None:
        msg = f"Parameters cannot be empty when updating app variant"
        logger.error(msg)
        raise ValueError(msg)
    try:
        await db_manager.update_variant_parameters(app_variant, app_variant.parameters)
    except:
        logger.error(
            f"Error updating app variant {app_variant.app_name}/{app_variant.variant_name}"
        )
        raise


async def update_variant_image(app_variant: AppVariant, image: Image, **kwargs: dict):
    """Updates the image for app variant in the database.

    Arguments:
        app_variant -- the app variant to update
        image -- the image to update
    """
    if app_variant.app_name in ["", None] or app_variant.variant_name == [
        "",
        None,
    ]:
        msg = "App name and variant name cannot be empty"
        logger.error(msg)
        raise ValueError(msg)
    if image.tags in ["", None]:
        msg = "Image tags cannot be empty"
        logger.error(msg)
        raise ValueError(msg)
    if not image.tags.startswith(settings.registry):
        raise ValueError(
            "Image should have a tag starting with the registry name (agenta-server)"
        )
    if image not in docker_utils.list_images():
        raise DockerException(
            f"Image {image.docker_id} with tags {image.tags} not found"
        )

    variant_exist = await db_manager.get_variant_from_db(app_variant)
    if variant_exist is None:
        msg = f"App variant {app_variant.app_name}/{app_variant.variant_name} not found in DB"
        logger.error(msg)
        raise ValueError(msg)
    try:
        old_variant = await db_manager.get_variant_from_db(app_variant)
        old_image = await db_manager.get_image(old_variant)
        container_ids = docker_utils.stop_containers_based_on_image(old_image)
        logger.info(f"Containers {container_ids} stopped")
        for container_id in container_ids:
            docker_utils.delete_container(container_id)
            logger.info(f"Container {container_id} deleted")
        await db_manager.remove_app_variant(old_variant)
    except Exception as e:
        logger.error(f"Error removing old variant: {str(e)}")
        logger.error(
            f"Error removing and shutting down containers for old app variant {app_variant.app_name}/{app_variant.variant_name}"
        )
        logger.error("Previous variant removed but new variant not added. Rolling back")
        await db_manager.add_variant_based_on_image(old_variant, old_image, **kwargs)
        raise
    try:
        logger.info(
            f"Updating variant {app_variant.app_name}/{app_variant.variant_name}"
        )
        await db_manager.add_variant_based_on_image(app_variant, image, **kwargs)
        logger.info(
            f"Starting variant {app_variant.app_name}/{app_variant.variant_name}"
        )
        await start_variant(app_variant)
    except:
        raise
