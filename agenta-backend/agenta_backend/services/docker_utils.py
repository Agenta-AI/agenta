import logging
import os
from time import sleep
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
    image_name, app_name, variant_name, env_vars: DockerEnvVars, user_id: str
) -> URI:
    try:

        image = client.images.get(f"{image_name}")

        # Set user backend url path and container name
        user_backend_url_path = f"{user_id}/{app_name}/{variant_name}"
        user_backend_container_name = f"{app_name}-{variant_name}-{user_id}"

        # Default labels
        labels = {
            f"traefik.http.services.{user_backend_container_name}.loadbalancer.server.port": "80",
            f"traefik.http.middlewares.{user_backend_container_name}-strip-prefix.stripprefix.prefixes": f"/{user_backend_url_path}",
            f"traefik.http.routers.{user_backend_container_name}.middlewares": f"{user_backend_container_name}-strip-prefix",
            f"traefik.http.routers.{user_backend_container_name}.service": f"{user_backend_container_name}",
        }

        # Merge the default labels with environment-specific labels
        if os.environ["ENVIRONMENT"] == "production":
            # Production specific labels
            production_labels = {
                f"traefik.http.routers.{user_backend_container_name}.rule": f"Host(`{os.environ['BARE_DOMAIN_NAME']}`) && PathPrefix(`/{user_backend_url_path}`)",
            }
            labels.update(production_labels)

            if "https" in os.environ["DOMAIN_NAME"]:
                # SSL specific labels
                ssl_labels = {
                    f"traefik.http.routers.{user_backend_container_name}.entrypoints": "web-secure",
                    f"traefik.http.routers.{user_backend_container_name}.tls": "true",
                    f"traefik.http.routers.{user_backend_container_name}.tls.certresolver": "myResolver",
                }
                labels.update(ssl_labels)
        else:
            # Development specific labels
            development_labels = {
                f"traefik.http.routers.{user_backend_container_name}.rule": f"PathPrefix(`/{user_backend_url_path}`)",
                f"traefik.http.routers.{user_backend_container_name}.entrypoints": "web",
            }

            labels.update(development_labels)

        env_vars = {} if env_vars is None else env_vars
        container = client.containers.run(
            image,
            detach=True,
            labels=labels,
            network="agenta-network",
            name=user_backend_container_name,
            environment=env_vars,
        )
        # Check the container's status
        sleep(0.5)
        container.reload()  # Refresh container data
        if container.status == "exited":
            logs = container.logs().decode("utf-8")
            raise Exception(f"Container exited immediately. Docker Logs: {logs}")
        return URI(
            uri=f"http://{os.environ['BARE_DOMAIN_NAME']}/{user_backend_url_path}"
        )
    except docker.errors.APIError as error:
        # Container failed to run, get the logs
        try:
            failed_container = client.containers.get(user_backend_container_name)
            logs = failed_container.logs().decode("utf-8")
            raise Exception(f"Docker Logs: {logs}") from error
        except Exception as e:
            return f"Failed to fetch logs: {str(e)} \n Exception Error: {str(error)}"


def restart_container(container_id: str):
    """Restarts a container based on its id

    Arguments:
        container_id -- the docker container id
    """
    try:
        logger.info(f"Restarting container with id: {container_id}")

        # Find the container and network by name and id
        container = client.containers.get(container_id)
        network = client.networks.get("agenta-network")

        # Connect and restart container
        network.connect(container)
        container.restart()

        logger.info(f"Restarted container with id: {container_id}")
    except (docker.errors.APIError, Exception) as ex:
        print("Err type ---> ", ex)
        logger.error(
            f"Error restarting container with id: {container.id}. Error: {str(ex)}"
        )
        raise RuntimeError(f"Error starting container with id: {container.id}") from ex


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
        raise RuntimeError(f"Error stopping container with id: {container.id}") from ex


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
        raise RuntimeError(f"Error deleting container with id: {container.id}") from ex


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
        raise RuntimeError(f"Error deleting image with id: {image.docker_id}") from ex


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
        raise RuntimeError(f"An error occurred while pulling the image: {str(e)}")


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
