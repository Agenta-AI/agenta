import docker
from deploy_server.config import settings

client = docker.from_env()


def list_images():
    images = client.images.list()
    return images


def pull_image(image_name, tag="latest"):
    image = client.images.pull(
        f"{settings.docker_registry_url}/{image_name}:{tag}")
    return image


def push_image(image_name, tag="latest"):
    image = client.images.get(f"{image_name}:{tag}")
    response = client.images.push(
        f"{settings.docker_registry_url}/{image_name}", tag=tag)
    return response


def delete_image(image_name, tag="latest"):
    image = client.images.get(f"{image_name}:{tag}")
    response = client.images.remove(image.id)
    return response


client = docker.from_env()


def start_registry():
    container_name = "local_registry"
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
