from typing import List

import docker
from deploy_server.config import settings
from deploy_server.models.container import Container
from deploy_server.models.image import Image

client = docker.from_env()


def list_images() -> List[Image]:
    """Lists all the images from our repository
    These are tagged with the registry name (config in both deploy_server and agenta-cli)

    Returns:
        List[Image]
    """
    all_images = client.images.list()
    registry_images = [
        Image(id=image.id, tags=image.tags) for image in all_images if len(image.tags) > 0 and image.tags[0].startswith(settings.registry)]
    return registry_images


def start_container(image_name, tag="latest"):
    image = client.images.get(
        f"{settings.docker_registry_url}/{image_name}:{tag}")
    container = client.containers.run(image, detach=True)
    return Container(id=container.id, image=container.image, status=container.status, name=container.name)


def stop_container(container_id):
    container = client.containers.get(container_id)
    response = container.stop()
    return response


def delete_container(container_id):
    container = client.containers.get(container_id)
    response = container.remove()
    return response
