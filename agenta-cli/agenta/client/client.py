import os
from typing import List

import requests
from agenta.client.api_models import AppVariant, Image
from docker.models.images import Image as DockerImage

BACKEND_URL = os.environ["BACKEND_ENDPOINT"]


class APIRequestError(Exception):
    """Exception to be raised when an API request fails."""


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
    response = requests.post(f"{BACKEND_URL}/app_variant/add/from_image/",
                             json={"app_variant": app_variant.dict(), "image": image.dict()}, timeout=600)
    if response.status_code != 200:
        error_message = response.text
        raise APIRequestError(
            f"Request to app_variant endpoint failed with status code {response.status_code} and error message: {error_message}.")


def start_variant(app_name: str, variant_name: str) -> str:
    """Starts a container with the variant an expose its endpoint

    Arguments:
        app_name -- 
        variant_name -- _description_

    Returns:
        The endpoint of the container
    """
    response = requests.post(f"{BACKEND_URL}/app_variant/start/",
                             json={"app_name": app_name, "variant_name": variant_name}, timeout=600)
    if response.status_code != 200:
        error_message = response.text
        raise APIRequestError(
            f"Request to start variant endpoint failed with status code {response.status_code} and error message: {error_message}.")
    return response.json()['uri']


def list_variants(app_name: str) -> List[AppVariant]:
    """Lists all the variants registered in the backend for an app

    Arguments:
        app_name -- the app name to which to return all the variants

    Returns:
        a list of the variants using the pydantic model
    """
    response = requests.get(f"{BACKEND_URL}/app_variant/list_variants/?app_name={app_name}", timeout=600)

    # Check for successful request
    if response.status_code != 200:
        error_message = response.text
        raise APIRequestError(
            f"Request to list_variants endpoint failed with status code {response.status_code} and error message: {error_message}.")
    app_variants = response.json()
    return [AppVariant(**variant) for variant in app_variants]
