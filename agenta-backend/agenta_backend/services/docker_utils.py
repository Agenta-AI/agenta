import logging
import os
from typing import List

import docker
from agenta_backend.config import settings
from agenta_backend.models.api.api_models import (
    URI,
    AppVariant,
    Image,
    DockerEnvVars,
)

client = docker.from_env()

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def port_generator(start_port=9000):
    port = start_port
    while True:
        yield port
        port += 1


ports = port_generator()


def list_images() -> List[Image]:
    """Lists all the images from our repository
    These are tagged with the registry name (config in both agenta_backend and agenta-cli)

    Returns:
        List[Image]
    """
    all_images = client.images.list()
    registry_images = [
        Image(docker_id=image.id, tags=image.tags[0])
        for image in all_images
        if len(image.tags) > 0 and image.tags[0].startswith(settings.registry)
    ]
    return registry_images


def start_container(
    image_name: str, app_name: str, variant_name: str, env_vars: DockerEnvVars
) -> URI:
    """Starts the container for an app using local docker. Injects the env vars and sets up traefik
    for reverse proxying.

    Args:
        image_name: image name to start
        app_name: app name to start
        variant_name: variant name to start
        env_vars:  env vars to inject

    Returns:
        URI -- The URI of the container
    """
    image = client.images.get(f"{image_name}")

    labels = {
        f"traefik.http.routers.{app_name}-{variant_name}.entrypoints": "web",
        f"traefik.http.services.{app_name}-{variant_name}.loadbalancer.server.port": "80",
        f"traefik.http.middlewares.{app_name}-{variant_name}-strip-prefix.stripprefix.prefixes": f"/{app_name}/{variant_name}",
        f"traefik.http.routers.{app_name}-{variant_name}.middlewares": f"{app_name}-{variant_name}-strip-prefix",
        f"traefik.http.routers.{app_name}-{variant_name}.service": f"{app_name}-{variant_name}",
    }

    rules = {
        "development": f"PathPrefix(`/{app_name}/{variant_name}`)",
        "production": f"Host(`{os.environ['BARE_DOMAIN_NAME']}`) && PathPrefix(`/{app_name}/{variant_name}`)",
    }

    labels.update(
        {
            f"traefik.http.routers.{app_name}-{variant_name}.rule": rules[
                os.environ["ENVIRONMENT"]
            ]
        }
    )
    env_vars = {} if env_vars is None else env_vars
    client.containers.run(
        image,
        detach=True,
        labels=labels,
        network="agenta-network",
        name=f"{app_name}-{variant_name}",
        environment=env_vars,
    )
    return URI(
        uri=f"http://{os.environ['BARE_DOMAIN_NAME']}/{app_name}/{variant_name}"
    )


def stop_containers_based_on_image(image: Image) -> List[str]:
    """Stops all the containers that use a certain image

    Arguments:
        image -- Image containing the docker id

    Raises:
        RuntimeError: _description_

    Returns:
        The container ids of the stopped containers
    """
    stopped_container_ids = []
    for container in client.containers.list(all=True):
        if container.image.id == image.docker_id:
            try:
                container.stop()
                stopped_container_ids.append(container.id)
                logger.info(f"Stopped container with id: {container.id}")
            except docker.errors.APIError as ex:
                logger.error(
                    f"Error stopping container with id: {container.id}. Error: {str(ex)}"
                )
                raise RuntimeError(
                    f"Error stopping container with id: {container.id}"
                ) from ex
    return stopped_container_ids


def stop_container(container_id: str):
    """Stop a container based on its id
    Arguments:
        container_id -- _description_

    Raises:
        RuntimeError: _description_
    """
    try:
        container = client.containers.get(container_id)
        container.stop()
        logger.info(f"Stopped container with id: {container.id}")
    except docker.errors.APIError as ex:
        logger.error(
            f"Error stopping container with id: {container.id}. Error: {str(ex)}"
        )
        raise RuntimeError(
            f"Error stopping container with id: {container.id}"
        ) from ex


def delete_container(container_id: str):
    """Delete a container based on its id

    Arguments:
        container_id -- _description_

    Raises:
        RuntimeError: _description_
    """
    try:
        container = client.containers.get(container_id)
        container.remove()
        logger.info(f"Deleted container with id: {container.id}")
    except docker.errors.APIError as ex:
        logger.error(
            f"Error deleting container with id: {container.id}. Error: {str(ex)}"
        )
        raise RuntimeError(
            f"Error deleting container with id: {container.id}"
        ) from ex


def delete_image(image: Image):
    """Delete an image based on its id

    Arguments:
        image -- _description_

    Raises:
        RuntimeError: _description_
    """
    try:
        client.images.remove(image.docker_id)
        logger.info(f"Deleted image with id: {image.docker_id}")
    except docker.errors.APIError as ex:
        logger.error(
            f"Error deleting image with id: {image.docker_id}. Error: {str(ex)}"
        )
        raise RuntimeError(
            f"Error deleting image with id: {image.docker_id}"
        ) from ex


def experimental_pull_image(image_name: str):
    """
    Pulls an image from the Docker registry.

    Args:
        image_name (str): The name of the Docker image to pull.

    Returns:
        image: The Docker image that was pulled.

    Raises:
        RuntimeError: If there was an error while pulling the image.
    """
    try:
        image = client.images.pull(image_name)
        return image
    except docker.errors.APIError as e:
        raise RuntimeError(
            f"An error occurred while pulling the image: {str(e)}"
        )


def experimental_is_image_pulled(image_name: str) -> bool:
    """
    Pulls the specified Docker image from the Docker registry.

    Args:
        image_name (str): The name of the Docker image to pull. This
        string should include the tag if needed (e.g., 'my_image:latest').

    Returns:
        docker.models.images.Image: The Docker image that was pulled.
    Raises:
        RuntimeError: If there was an error while pulling the image.
    """
    images = client.images.list()

    for image in images:
        if image_name in image.tags:
            return True

    return False
