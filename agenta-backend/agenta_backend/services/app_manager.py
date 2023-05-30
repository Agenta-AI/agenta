"""Main Business logic
"""

from agenta_backend.services import (db_manager, docker_utils)
from agenta_backend.models.api.api_models import (AppVariant, Image, URI)
import logging

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
                    docker_utils.delete_image(image)
                    logger.info(f"Image {image.tags} deleted")
                    db_manager.remove_image(image)
                except Exception as e:
                    logger.error(f"Error managing Docker resources: {str(e)}")
                    raise
            db_manager.remove_app_variant(app_variant)
        except Exception as e:
            logger.error(f"Error deleting app variant: {str(e)}")
            raise


def start_variant(app_variant: AppVariant) -> URI:
    """
    Starts a Docker container for a given app variant.

    Fetches the associated image from the database and delegates to a Docker utility function
    to start the container. The URI of the started container is returned.

    Args:
        app_variant (AppVariant): The app variant for which a container is to be started.

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
            f"Error fetching image for app variant {app_variant.app_name}/{app_variant.variant_name} from database: {str(e)}")
        raise ValueError(
            f"Image for app variant {app_variant.app_name}/{app_variant.variant_name} not found in database") from e

    try:
        uri: URI = docker_utils.start_container(
            image_name=image.tags, app_name=app_variant.app_name, variant_name=app_variant.variant_name)
        logger.info(
            f"Started Docker container for app variant {app_variant.app_name}/{app_variant.variant_name} at URI {uri}")
    except Exception as e:
        logger.error(
            f"Error starting Docker container for app variant {app_variant.app_name}/{app_variant.variant_name}: {str(e)}")
        raise RuntimeError(
            f"Failed to start Docker container for app variant {app_variant.app_name}/{app_variant.variant_name}") from e

    return uri
