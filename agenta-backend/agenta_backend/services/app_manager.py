"""Main Business logic
"""

import logging

from agenta_backend.config import settings
from agenta_backend.services.db_mongo import testsets
from agenta_backend.models.api.api_models import URI, App, AppVariant, Image, DockerEnvVars
from agenta_backend.services import db_manager, docker_utils
from docker.errors import DockerException

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def remove_app_variant(app_variant: AppVariant):
    """Removes appvariant from db, if it is the last one using an image, then
    deletes the image from the db, shutdowns the container, deletes it and remove
    the image from the registry

    Arguments:
        app_variant -- the app variant to remove
    """
    # checks if it is the last app variant using its image
    try:
        app_variant_db = db_manager.get_variant_from_db(app_variant)
    except Exception as e:
        logger.error(f"Error fetching app variant from the database: {str(e)}")
        raise

    if app_variant_db is None:
        msg = f"App variant {app_variant.app_name}/{app_variant.variant_name} not found in DB"
        logger.error(msg)
        raise ValueError(msg)
    else:
        try:
            if db_manager.check_is_last_variant(app_variant_db):
                image: Image = db_manager.get_image(app_variant)
                try:
                    container_ids = docker_utils.stop_containers_based_on_image(image)
                    logger.info(f"Containers {container_ids} stopped")
                    for container_id in container_ids:
                        docker_utils.delete_container(container_id)
                        logger.info(f"Container {container_id} deleted")
                except Exception as e:
                    logger.error(f"Error managing Docker resources: {str(e)}")
                    raise
                try:
                    docker_utils.delete_image(image)
                    logger.info(f"Image {image.tags} deleted")
                except:
                    logger.warning(
                        f"Warning: Error deleting image {image.tags}. Probably multiple variants using it."
                    )
                db_manager.remove_image(image)
            db_manager.remove_app_variant(app_variant)
        except Exception as e:
            logger.error(f"Error deleting app variant: {str(e)}")
            raise


async def remove_app(app: App):
    """Removes all app variants from db, if it is the last one using an image, then
    deletes the image from the db, shutdowns the container, deletes it and remove
    the image from the registry

    Arguments:
        app_name -- the app name to remove
    """
    # checks if it is the last app variant using its image
    app_name = app.app_name
    if app_name not in [app.app_name for app in db_manager.list_apps()]:
        msg = f"App {app_name} not found in DB"
        logger.error(msg)
        raise ValueError(msg)
    try:
        app_variants = db_manager.list_app_variants(
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
                remove_app_variant(app_variant)
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
    cursor = testsets.find({"app_name": app_name})
    documents = await cursor.to_list(length=100)

    # Prepare a list of ObjectIds for bulk deletion
    testset_ids = [document["_id"] for document in documents]

    # Perform bulk deletion if there are testsets to delete
    if testset_ids:
        result = await testsets.delete_many({"_id": {"$in": testset_ids}})
        deleted_count = result.deleted_count
        logger.info(f"{deleted_count} testset(s) deleted for app {app_name}")
        return deleted_count
    else:
        logger.info(f"No testsets found for app {app_name}")
        return 0


def start_variant(app_variant: AppVariant, env_vars: DockerEnvVars = None) -> URI:
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
        image: Image = db_manager.get_image(app_variant)
    except Exception as e:
        logger.error(
            f"Error fetching image for app variant {app_variant.app_name}/{app_variant.variant_name} from database: {str(e)}"
        )
        raise ValueError(
            f"Image for app variant {app_variant.app_name}/{app_variant.variant_name} not found in database"
        ) from e

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
        raise RuntimeError(
            f"Failed to start Docker container for app variant {app_variant.app_name}/{app_variant.variant_name}"
        ) from e

    return uri


def update_variant_parameters(app_variant: AppVariant):
    """Updates the parameters for app variant in the database.

    Arguments:
        app_variant -- the app variant to update
    """
    if app_variant.app_name in ["", None] or app_variant.variant_name == ["", None]:
        msg = f"App name and variant name cannot be empty"
        logger.error(msg)
        raise ValueError(msg)
    if app_variant.parameters is None:
        msg = f"Parameters cannot be empty when updating app variant"
        logger.error(msg)
        raise ValueError(msg)
    try:
        db_manager.update_variant_parameters(app_variant, app_variant.parameters)
    except:
        logger.error(
            f"Error updating app variant {app_variant.app_name}/{app_variant.variant_name}"
        )
        raise


def update_variant_image(app_variant: AppVariant, image: Image):
    """Updates the image for app variant in the database.

    Arguments:
        app_variant -- the app variant to update
        image -- the image to update
    """
    if app_variant.app_name in ["", None] or app_variant.variant_name == ["", None]:
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

    if db_manager.get_variant_from_db(app_variant) is None:
        msg = f"App variant {app_variant.app_name}/{app_variant.variant_name} not found in DB"
        logger.error(msg)
        raise ValueError(msg)
    try:
        old_variant = db_manager.get_variant_from_db(app_variant)
        old_image = db_manager.get_image(old_variant)
        container_ids = docker_utils.stop_containers_based_on_image(old_image)
        logger.info(f"Containers {container_ids} stopped")
        for container_id in container_ids:
            docker_utils.delete_container(container_id)
            logger.info(f"Container {container_id} deleted")
        db_manager.remove_app_variant(old_variant)
    except Exception as e:
        logger.error(f"Error removing old variant: {str(e)}")
        logger.error(
            f"Error removing and shutting down containers for old app variant {app_variant.app_name}/{app_variant.variant_name}"
        )
        logger.error("Previous variant removed but new variant not added. Rolling back")
        db_manager.add_variant_based_on_image(old_variant, old_image)
        raise
    try:
        logger.info(
            f"Updating variant {app_variant.app_name}/{app_variant.variant_name}"
        )
        db_manager.add_variant_based_on_image(app_variant, image)
        logger.info(
            f"Starting variant {app_variant.app_name}/{app_variant.variant_name}"
        )
        start_variant(app_variant)
    except:
        raise
