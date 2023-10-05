from typing import List, Dict, Union
from agenta_backend.services import db_manager, docker_utils
from agenta_backend.models.db_models import AppVariantDB, DeploymentDB
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


async def start_service(
        app_variant_db: AppVariantDB,
        env_vars: Dict[str, str]) -> DeploymentDB:
    """
    Start a service.

    Args:
        image_name: List of image tags.
        app_name: Name of the app.
        base_name: Base name for the container.
        env_vars: Environment variables.
        organization_id: ID of the organization.

    Returns:
        True if successful, False otherwise.
    """

    uri_path = f"{app_variant_db.organization.id}/{app_variant_db.app.app_name}/{app_variant_db.base_name}"
    container_name = f"{app_variant_db.app.app_name}-{app_variant_db.base_name}-{app_variant_db.organization.id}"

    results = docker_utils.start_container(
        image_name=app_variant_db.image.tags,
        uri_path=uri_path,
        container_name=container_name,
        env_vars=env_vars,
    )
    uri = results["uri"]
    uri_path = results["uri_path"]
    container_id = results["container_id"]
    container_name = results["container_name"]

    logger.info(
        f"Started Docker container for app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name} at URI {uri}"
    )

    deployment = await db_manager.create_deployment(
        app=app_variant_db.app,
        organization=app_variant_db.organization,
        user=app_variant_db.user,
        container_name=container_name,
        container_id=container_id,
        uri=uri,
        uri_path=uri_path,
        status="running",
    )
    return deployment


# def find_image(image: Image) -> Union[str, None]:
#     """
#     Find an image by its Docker ID.

#     Args:
#         docker_id: The Docker ID of the image.

#     Returns:
#         The image if found, otherwise None.
#     """
#     return docker_utils.find_image_by_docker_id(docker_id)


def restart_deployment(self, container_id: str) -> bool:
    """
    Restart a deployment.

    Args:
        container_id: The ID of the container to restart.

    Returns:
        True if successful, False otherwise.
    """
    return docker_utils.restart_container(container_id)


def stop_service(self, image: str, image_docker_id: str) -> bool:
    """
    Stop a service.

    Args:
        image: The image name.
        image_docker_id: The Docker ID of the image.

    Returns:
        True if successful, False otherwise.
    """
    if image not in docker_utils.list_images():
        raise Exception(f"Image {image} not found")

    docker_utils.stop_containers_based_on_image_id(image_docker_id)
    docker_utils.delete_image(image_docker_id)
    return True


def terminate_and_remove_service(self, docker_id: str, container_id: str) -> bool:
    """
    Terminate and remove a service.

    Args:
        docker_id: The Docker ID of the image.
        container_id: The ID of the container.

    Returns:
        True if successful, False otherwise.
    """
    docker_utils.delete_image(docker_id)
    docker_utils.stop_container(container_id)
    docker_utils.delete_container(container_id)
    return True
