from typing import List

import docker
from deploy_server.config import settings
from deploy_server.models.api.api_models import AppVariant, Image, URI


client = docker.from_env()


def port_generator(start_port=9000):
    port = start_port
    while True:
        yield port
        port += 1


ports = port_generator()


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
        image, detach=True, labels=labels, network="agenta-network")
    return URI(uri=f"http://localhost/{app_name}/{variant_name}")


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
