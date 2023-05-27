from agenta.client.api_models import AppVariant, Image
from docker.models.images import Image as DockerImage
import requests


def add_variant_to_server(app_name: str, variant_name: str, docker_image: DockerImage):
    """Adds a variant to the server.

    Arguments:
        app_name -- Name of the app
        variant_name -- Name of the variant
        image_name -- Name of the image
    """
    image: Image = Image(docker_id=docker_image.id,
                         tags=f"{docker_image.tags[0]}")
    app_variant: AppVariant = AppVariant(
        app_name=app_name, variant_name=variant_name)
    # TODO: save uri as a config
    response = requests.post("http://localhost/api/app_variant/add/from_image/",
                             json={"app_variant": app_variant.dict(), "image": image.dict()})
    if response.status_code != 200:
        raise Exception(
            f"Request to add variant failed with status code {response.status_code}. Response: {response.text}")


def start_variant(app_name: str, variant_name: str) -> str:
    """Starts a container with the variant an expose its endpoint

    Arguments:
        app_name -- 
        variant_name -- _description_

    Returns:
        The endpoint of the container
    """
    response = requests.post("http://localhost/api/app_variant/start/",
                             json={"app_name": app_name, "variant_name": variant_name})
    assert response.status_code == 200
    return response.json()['uri']
