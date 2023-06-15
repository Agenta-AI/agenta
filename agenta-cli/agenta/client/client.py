import os
from pathlib import Path
from typing import List

import agenta.config
import requests
from agenta.client.api_models import AppVariant, Image
from docker.models.images import Image as DockerImage

BACKEND_URL = os.environ["BACKEND_ENDPOINT"]


class APIRequestError(Exception):
    """Exception to be raised when an API request fails."""


def add_variant_to_server(app_name: str, variant_name: str, image: Image):
    """Adds a variant to the server.

    Arguments:
        app_name -- Name of the app
        variant_name -- Name of the variant
        image_name -- Name of the image
    """
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


def remove_variant(app_name: str, variant_name: str):
    """Removes a variant from the backend

    Arguments:
        app_name -- the app name
        variant_name -- the variant name
    """
    app_variant = AppVariant(app_name=app_name, variant_name=variant_name)
    app_variant_json = app_variant.json()
    response = requests.delete(f"{BACKEND_URL}/app_variant/remove_variant/",
                               data=app_variant_json, headers={'Content-Type': 'application/json'}, timeout=600)

    # Check for successful request
    if response.status_code != 200:
        error_message = response.text
        raise APIRequestError(
            f"Request to remove_variant endpoint failed with status code {response.status_code} and error message: {error_message}")


def update_variant_image(app_name: str, variant_name: str, image: Image):
    """Adds a variant to the server.

    Arguments:
        app_name -- Name of the app
        variant_name -- Name of the variant
        image_name -- Name of the image
    """
    app_variant: AppVariant = AppVariant(
        app_name=app_name, variant_name=variant_name)
    response = requests.put(f"{BACKEND_URL}/app_variant/update_variant_image/",
                            json={"app_variant": app_variant.dict(), "image": image.dict()}, timeout=600)
    if response.status_code != 200:
        error_message = response.text
        raise APIRequestError(
            f"Request to update app_variant failed with status code {response.status_code} and error message: {error_message}.")


def send_docker_tar(app_name: str, variant_name: str, tar_path: Path) -> Image:
    with tar_path.open('rb') as tar_file:
        response = requests.post(
            f"{BACKEND_URL}/containers/build_image/?app_name={app_name}&variant_name={variant_name}",
            files={
                'tar_file': tar_file,
            },
            timeout=1200
        )

    response.raise_for_status()
    image = Image.parse_obj(response.json())
    return image
