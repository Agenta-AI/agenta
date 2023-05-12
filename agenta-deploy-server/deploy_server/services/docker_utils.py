from deploy_server.models.image import Image
from deploy_server.models.container import Container
from typing import List
import docker
from deploy_server.config import settings

client = docker.from_env()


def start_registry():
    container_name = settings.registry
    try:
        container = client.containers.get(container_name)
    except docker.errors.NotFound:
        container = None

    if container and container.status != "running":
        container.start()
    elif not container:
        container = client.containers.run(
            "registry:2",
            detach=True,
            name=container_name,
            ports={"5000/tcp": ("127.0.0.1", 5000)}
        )


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
