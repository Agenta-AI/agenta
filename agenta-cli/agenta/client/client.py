import os
from pathlib import Path
from typing import List, Dict, Any

import agenta.config
import requests
from agenta.client.api_models import AppVariant, Image, VariantConfigPayload
from docker.models.images import Image as DockerImage
from requests.exceptions import RequestException

BACKEND_URL_SUFFIX = os.environ["BACKEND_URL_SUFFIX"]


class APIRequestError(Exception):
    """Exception to be raised when an API request fails."""


def add_variant_to_server(
    app_name: str,
    variant_name: str,
    base_name: str,
    config_name: str,
    image: Image,
    host: str,
):
    """Adds a variant to the server.

    Arguments:
        app_name -- Name of the app
        variant_name -- Name of the variant
        image_name -- Name of the image
    """
    app_variant: AppVariant = AppVariant(
        app_name=app_name,
        variant_name=variant_name,
        base_name=base_name,
        config_name=config_name,
    )
    response = requests.post(
        f"{host}/{BACKEND_URL_SUFFIX}/app_variant/add/from_image/",
        json={"app_variant": app_variant.dict(), "image": image.dict()},
        timeout=600,
    )
    if response.status_code != 200:
        error_message = response.json()
        raise APIRequestError(
            f"Request to app_variant endpoint failed with status code {response.status_code} and error message: {error_message}."
        )


def start_variant(
    app_name: str, variant_name: str, base_name: str, config_name: str, host: str
) -> str:
    """Starts a container with the variant an expose its endpoint

    Arguments:
        app_name --
        variant_name -- _description_

    Returns:
        The endpoint of the container
    """
    app_variant: AppVariant = AppVariant(
        app_name=app_name,
        variant_name=variant_name,
        base_name=base_name,
        config_name=config_name,
    )
    response = requests.post(
        f"{host}/{BACKEND_URL_SUFFIX}/app_variant/start/",
        json={"app_variant": app_variant.dict()},
        timeout=600,
    )

    if response.status_code != 200:
        error_message = response.json()
        raise APIRequestError(
            f"Request to start variant endpoint failed with status code {response.status_code} and error message: {error_message}."
        )
    return response.json()["uri"]


def list_variants(app_name: str, host: str) -> List[AppVariant]:
    """Lists all the variants registered in the backend for an app

    Arguments:
        app_name -- the app name to which to return all the variants

    Returns:
        a list of the variants using the pydantic model
    """
    response = requests.get(
        f"{host}/{BACKEND_URL_SUFFIX}/app_variant/list_variants/?app_name={app_name}",
        timeout=600,
    )

    # Check for successful request
    if response.status_code != 200:
        error_message = response.json()
        raise APIRequestError(
            f"Request to list_variants endpoint failed with status code {response.status_code} and error message: {error_message}."
        )
    app_variants = response.json()
    return [AppVariant(**variant) for variant in app_variants]


def get_variant_by_name(app_name: str, variant_name: str, host: str) -> AppVariant:
    """Gets a variant by name

    Arguments:
        app_name -- the app name
        variant_name -- the variant name

    Returns:
        the variant using the pydantic model
    """
    response = requests.get(
        f"{host}/{BACKEND_URL_SUFFIX}/app_variant/get_variant_by_name/?app_name={app_name}&variant_name={variant_name}",
        timeout=600,
    )

    # Check for successful request
    if response.status_code != 200:
        error_message = response.json()
        raise APIRequestError(
            f"Request to get_variant_by_name endpoint failed with status code {response.status_code} and error message: {error_message}."
        )


def remove_variant(app_name: str, variant_name: str, host: str):
    """Removes a variant from the backend

    Arguments:
        app_name -- the app name
        variant_name -- the variant name
    """
    app_variant = AppVariant(app_name=app_name, variant_name=variant_name)
    app_variant_json = app_variant.json()
    response = requests.delete(
        f"{host}/{BACKEND_URL_SUFFIX}/app_variant/remove_variant/",
        data=app_variant_json,
        headers={"Content-Type": "application/json"},
        timeout=600,
    )

    # Check for successful request
    if response.status_code != 200:
        error_message = response.json()
        raise APIRequestError(
            f"Request to remove_variant endpoint failed with status code {response.status_code} and error message: {error_message}"
        )


def update_variant_image(
    app_name: str,
    variant_name: str,
    base_name: str,
    config_name: str,
    image: Image,
    host: str,
):
    """Adds a variant to the server.

    Arguments:
        app_name -- Name of the app
        variant_name -- Name of the variant
        image_name -- Name of the image
    """
    app_variant: AppVariant = AppVariant(
        app_name=app_name,
        variant_name=variant_name,
        base_name=base_name,
        config_name=config_name,
    )
    response = requests.put(
        f"{host}/{BACKEND_URL_SUFFIX}/app_variant/update_variant_image/",
        json={"app_variant": app_variant.dict(), "image": image.dict()},
        timeout=600,
    )
    if response.status_code != 200:
        error_message = response.json()
        raise APIRequestError(
            f"Request to update app_variant failed with status code {response.status_code} and error message: {error_message}."
        )


def send_docker_tar(app_name: str, base_name: str, tar_path: Path, host: str) -> Image:
    with tar_path.open("rb") as tar_file:
        response = requests.post(
            f"{host}/{BACKEND_URL_SUFFIX}/containers/build_image/?app_name={app_name}&base_name={base_name}",
            files={
                "tar_file": tar_file,
            },
            timeout=1200,
        )

    if response.status_code == 500:
        response_error = response.json()
        error_msg = "Serving the variant failed.\n"
        error_msg += f"Log: {response_error}\n"
        error_msg += "Here's how you may be able to solve the issue:\n"
        error_msg += "- First, make sure that the requirements.txt file has all the dependencies that you need.\n"
        error_msg += "- Second, check the Docker logs for the backend image to see the error when running the Docker container."
        raise Exception(error_msg)

    response.raise_for_status()
    image = Image.parse_obj(response.json())
    return image


def save_variant_config(
    app_name: str,
    base_name: str,
    config_name: str,
    parameters: Dict[str, Any],
    overwrite: bool,
    host: str,
) -> None:
    """
    Save or update a variant configuration to the server.

    Args:
        variant_config (VariantConfigPayload): Pydantic model containing the variant configuration.
        host (str): The server host URL.
        session_token (str): The session token.

    Raises:
        APIRequestError: If the API request fails.
    """
    if host is None:
        raise ValueError("The 'host' is not specified in save_variant_config")

    headers = {
        "Content-Type": "application/json",
    }
    variant_config = VariantConfigPayload(
        app_name=app_name,
        base_name=base_name,
        config_name=config_name,
        parameters=parameters,
        overwrite=overwrite,
    )
    try:
        response = requests.post(
            f"{host}/{BACKEND_URL_SUFFIX}/app_variant/config/",
            json=variant_config.dict(),
            headers=headers,
            timeout=600,
        )
        request = f"POST {host}/{BACKEND_URL_SUFFIX}/app_variant/config/ {variant_config.dict()}"

        # Check for successful request
        if response.status_code != 200:
            error_message = response.json().get("detail", "Unknown error")
            raise APIRequestError(
                f"Request {request} to save_variant_config endpoint failed with status code {response.status_code}. Error message: {error_message}"
            )
    except RequestException as e:
        raise APIRequestError(f"Request failed: {str(e)}")


def fetch_variant_config(
    app_name: str,
    base_name: str,
    host: str,
    config_name: str = None,
    environment_name: str = None,
) -> Dict[str, Any]:
    """
    Fetch a variant configuration from the server.

    Args:
        app_name (str): Name of the app.
        variant_name (str): Name of the variant.
        base_name (str): Base name for the configuration.
        config_name (str): Configuration name.
        session_token (str): The session token.
        host (str): The server host URL.

    Raises:
        APIRequestError: If the API request fails.

    Returns:
        dict: The requested variant configuration.
    """

    if host is None:
        raise ValueError("The 'host' is not specified in fetch_variant_config")

    headers = {
        "Content-Type": "application/json",
    }

    try:
        response = requests.get(
            f"{host}/{BACKEND_URL_SUFFIX}/app_variant/config/",
            params={
                "app_name": app_name,
                "base_name": base_name,
                "config_name": config_name,
                "environment_name": environment_name,
            },
            headers=headers,
            timeout=600,
        )

        request = f"GET {host}/{BACKEND_URL_SUFFIX}/app_variant/config/ {app_name} {base_name} {config_name} {environment_name}"

        # Check for successful request
        if response.status_code != 200:
            error_message = response.json().get("detail", "Unknown error")
            raise APIRequestError(
                f"Request {request} to fetch_variant_config endpoint failed with status code {response.status_code}. Error message: {error_message}"
            )

        return response.json()

    except RequestException as e:
        raise APIRequestError(f"Request failed: {str(e)}")
