from typing import List

import docker
from agenta_backend.config import settings
from agenta_backend.models.api.api_models import AppVariant, Image, URI
import logging

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
        Image(docker_id=image.id, tags=image.tags[0]) for image in all_images if len(image.tags) > 0 and image.tags[0].startswith(settings.registry)]
    return registry_images


def start_container(image_name, app_name, variant_name) -> URI:
    image = client.images.get(f"{image_name}")

    labels = {
        f"traefik.http.routers.{app_name}-{variant_name}.rule": f"PathPrefix(`/{app_name}/{variant_name}`)",
        f"traefik.http.routers.{app_name}-{variant_name}.entrypoints": "web",
        f"traefik.http.services.{app_name}-{variant_name}.loadbalancer.server.port": "80",
        f"traefik.http.middlewares.{app_name}-{variant_name}-strip-prefix.stripprefix.prefixes": f"/{app_name}/{variant_name}",
        f"traefik.http.routers.{app_name}-{variant_name}.middlewares": f"{app_name}-{variant_name}-strip-prefix",
        # this line connects the router to the service
        # f"traefik.http.middlewares.{app_name}-{variant_name}-openapi.redirectregex.regex": "^/openapi.json$",
        # f"traefik.http.middlewares.{app_name}-{variant_name}-openapi.redirectregex.replacement": f"/{app_name}/openapi.json",
        # f"traefik.http.middlewares.{app_name}-{variant_name}-openapi.redirectregex.permanent": "true",
        # f"traefik.http.routers.{app_name}-{variant_name}-openapi.rule": "Path(`/openapi.json`)",
        # f"traefik.http.routers.{app_name}-{variant_name}-openapi.middlewares": f"{app_name}-{variant_name}-openapi",
        f"traefik.http.routers.{app_name}-{variant_name}.service": f"{app_name}-{variant_name}",
    }
    container = client.containers.run(
        image, detach=True, labels=labels, network="agenta-network", name=f"{app_name}-{variant_name}")
    return URI(uri=f"http://localhost/{app_name}/{variant_name}")


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
                logger.info(f'Stopped container with id: {container.id}')
            except docker.errors.APIError as ex:
                logger.error(f'Error stopping container with id: {container.id}. Error: {str(ex)}')
                raise RuntimeError(f'Error stopping container with id: {container.id}') from ex
    return stopped_container_ids


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
        logger.info(f'Deleted container with id: {container.id}')
    except docker.errors.APIError as ex:
        logger.error(f'Error deleting container with id: {container.id}. Error: {str(ex)}')
        raise RuntimeError(f'Error deleting container with id: {container.id}') from ex


def delete_image(image: Image):
    """Delete an image based on its id

    Arguments:
        image -- _description_

    Raises:
        RuntimeError: _description_
    """
    try:
        client.images.remove(image.docker_id)
        logger.info(f'Deleted image with id: {image.docker_id}')
    except docker.errors.APIError as ex:
        logger.error(f'Error deleting image with id: {image.docker_id}. Error: {str(ex)}')
        raise RuntimeError(f'Error deleting image with id: {image.docker_id}') from ex
