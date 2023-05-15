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
                         tags=docker_image.tags[0])

    app_variant: AppVariant = AppVariant(
        app_name=app_name, variant_name=variant_name)
    # TODO: save uri as a config
    response = requests.post("http://localhost/api/app_variant/add/",
                             json={"app_variant": app_variant.dict(), "image": image.dict()})
    assert response.status_code == 200
