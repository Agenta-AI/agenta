import logging
import os
from typing import Dict

from agenta_backend.utils.common import isCloudEE
from agenta_backend.models.api.api_models import Image
from agenta_backend.models.db_models import AppVariantDB, DeploymentDB
from agenta_backend.services import db_manager, docker_utils
from docker.errors import DockerException

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


agenta_registry_repo = os.getenv("REGISTRY_REPO_NAME")


async def start_service(
    app_variant_db: AppVariantDB, env_vars: Dict[str, str]
) -> DeploymentDB:
    """
    Start a service.

    Args:
        app_variant_db (AppVariantDB): The app variant to start.
        env_vars (Dict[str, str]): The environment variables to pass to the container.

    Returns:
        True if successful, False otherwise.
    """

    if isCloudEE():
        uri_path = f"{app_variant_db.organization.id}/{app_variant_db.app.app_name}/{app_variant_db.base_name}"
        container_name = f"{app_variant_db.app.app_name}-{app_variant_db.base_name}-{app_variant_db.organization.id}"
    else:
        uri_path = f"{app_variant_db.user.id}/{app_variant_db.app.app_name}/{app_variant_db.base_name}"
        container_name = f"{app_variant_db.app.app_name}-{app_variant_db.base_name}-{app_variant_db.user.id}"
    logger.debug("Starting service with the following parameters:")
    logger.debug(f"image_name: {app_variant_db.image.tags}")
    logger.debug(f"uri_path: {uri_path}")
    logger.debug(f"container_name: {container_name}")
    logger.debug(f"env_vars: {env_vars}")

    results = docker_utils.start_container(
        image_name=app_variant_db.image.tags,
        uri_path=uri_path,
        container_name=container_name,
        env_vars=env_vars,
    )

    uri = results["uri"]
    container_id = results["container_id"]
    container_name = results["container_name"]

    logger.info(
        f"Started Docker container for app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name} at URI {uri}"
    )

    deployment = await db_manager.create_deployment(
        app=app_variant_db.app,
        user=app_variant_db.user,
        container_name=container_name,
        container_id=container_id,
        uri=uri,
        status="running",
        organization=app_variant_db.organization if isCloudEE() else None,
        workspace=app_variant_db.workspace if isCloudEE() else None,
    )
    return deployment


async def remove_image(image: Image):
    """
    Remove a Docker image from the system.

    Args:
        image (Image): The Docker image to remove.

    Returns:
        None
    """
    try:
        if not isCloudEE() and image.deletable:
            docker_utils.delete_image(image.docker_id)
        logger.info(f"Image {image.docker_id} deleted")
    except RuntimeError as e:
        logger.error(f"Error deleting image {image.docker_id}: {e}")
        raise e


async def stop_service(deployment: DeploymentDB):
    """
    Stops the Docker container associated with the given deployment.

    Args:
        deployment (DeploymentDB): The deployment to stop.

    Returns:
        None
    """
    docker_utils.delete_container(deployment.container_id)
    logger.info(f"Container {deployment.container_id} deleted")


async def stop_and_delete_service(deployment: DeploymentDB):
    """
    Stop and delete a Docker container associated with a deployment.

    Args:
        deployment (DeploymentDB): The deployment object associated with the container.

    Returns:
        None
    """
    logger.debug(f"Stopping container {deployment.container_id}")
    container_id = deployment.container_id
    docker_utils.stop_container(container_id)
    logger.info(f"Container {container_id} stopped")
    docker_utils.delete_container(container_id)
    logger.info(f"Container {container_id} deleted")


async def validate_image(image: Image) -> bool:
    """
    Validates the given image by checking if it has tags, if the tags start with the registry name, and if the image exists in the list of Docker images.

    Args:
        image (Image): The image to be validated.

    Raises:
        ValueError: If the image tags are empty or do not start with the registry name.
        DockerException: If the image does not exist in the list of Docker images.
    """
    if image.tags in ["", None]:
        msg = "Image tags cannot be empty"
        logger.error(msg)
        raise ValueError(msg)
    if not image.tags.startswith(agenta_registry_repo):
        raise ValueError(
            f"Image should have a tag starting with the registry name ({agenta_registry_repo})\n Image Tags: {image.tags}"
        )
    if image not in docker_utils.list_images():
        raise DockerException(
            f"Image {image.docker_id} with tags {image.tags} not found"
        )
    return True


def get_deployment_uri(deployment: DeploymentDB) -> str:
    """
    Builds a URI allowing the backend to access a given deployment.
    In the case of a self-hosted setup, we bypass traefik and use the docker generated dns entry instead. 

    Args:
        deployment (DeploymentDB): The deployment to reach.

    Returns:
        str: URI leading to the deployment 
    """
    if "localhost" in deployment.uri:
        # the DNS entry automatically created by docker for the container are the first 12 characters of the container's id
        return "http://"+deployment.container_id[:12]
    return deployment.uri
