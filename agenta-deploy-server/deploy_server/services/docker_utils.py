from typing import List

import docker
from deploy_server.config import settings
from deploy_server.models.api_models import AppVariant, Image

client = docker.from_env()


def list_images() -> List[Image]:
    """Lists all the images from our repository
    These are tagged with the registry name (config in both deploy_server and agenta-cli)

    Returns:
        List[Image]
    """
    all_images = client.images.list()
    registry_images = [
        Image(docker_id=image.id, tags=image.tags[0]) for image in all_images if len(image.tags) > 0 and image.tags[0].startswith(settings.registry)]
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


# def list_images():
#     images = client.images.list()
#     return images


# def pull_image(image_name, tag="latest"):
#     image = client.images.pull(
#         f"{settings.docker_registry_url}/{image_name}:{tag}")
#     return image


# def push_image(image_name, tag="latest"):
#     image = client.images.get(f"{image_name}:{tag}")
#     response = client.images.push(
#         f"{settings.docker_registry_url}/{image_name}", tag=tag)
#     return response


# def delete_image(image_name, tag="latest"):
#     image = client.images.get(f"{image_name}:{tag}")
#     response = client.images.remove(image.id)
#     return response
